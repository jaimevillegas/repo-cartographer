import { ProviderError, type Message, type ModelProvider, type ToolResult } from "../providers/types";
import type { ArchitectureGraph } from "../schema/graph";
import { TOOL_NAMES, type ToolName } from "../schema/tools";
import type { LimitKind, TraceEvent } from "../schema/trace";
import type { ValidationIssue } from "../schema/validation";
import type { Snapshot } from "../snapshot/snapshot";
import { toolDefinitions } from "../tools/definitions";
import { isSnapshotTool, runSnapshotTool } from "../tools";
import { truncate } from "../tools/types";
import { validateGraph } from "../validator";
import {
  buildTaskMessage,
  buildWrapUpMessage,
  CUT_OFF_MESSAGE,
  NO_TOOL_CALL_MESSAGE,
  SYSTEM_PROMPT,
  type AgentLimits,
} from "./prompt";
import { buildRecon } from "./recon";

export type AgentConfig = AgentLimits & {
  maxDurationMs: number;
  /** How many graphs the model may submit before the run gives up. */
  maxSubmitAttempts: number;
  maxOutputTokens: number;
};

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  maxSteps: 30,
  maxFileReads: 40,
  maxTokens: 600_000,
  maxDurationMs: 180_000,
  maxSubmitAttempts: 4,
  maxOutputTokens: 16_000,
};

export type AgentOptions = {
  snapshot: Snapshot;
  provider: ModelProvider;
  config?: Partial<AgentConfig>;
  signal?: AbortSignal;
  /** Replaceable for tests. Returns epoch milliseconds. */
  now?: () => number;
};

/** Model calls allowed after a limit is hit: one to submit, and room to repair it. */
const MAX_WRAP_UP_STEPS = 3;
/** Consecutive replies without a tool call before the run is abandoned. */
const MAX_IDLE_REPLIES = 3;
/** A single tool result is cut here, so one huge read cannot fill the context. */
const MAX_RESULT_CHARS = 60_000;
const MAX_REPORTED_ISSUES = 30;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EventInput = DistributiveOmit<TraceEvent, "seq" | "ts">;

/** What one tool call gives back: the model's result, and the graph when a submission was accepted. */
type ToolStep = { result: ToolResult; accepted?: ArchitectureGraph };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** How a limit reads in a sentence: "The step limit has been reached". */
const LIMIT_LABELS: Record<LimitKind, string> = { steps: "step", file_reads: "file read", tokens: "token", time: "time" };

const isToolName = (name: string): name is ToolName => (TOOL_NAMES as readonly string[]).includes(name);

function describeIssues(issues: ValidationIssue[]): string {
  const lines = issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => `- [${issue.code}]${issue.path ? ` ${issue.path}:` : ""} ${issue.message}`);
  const more = issues.length > MAX_REPORTED_ISSUES ? `\n… and ${issues.length - MAX_REPORTED_ISSUES} more.` : "";
  return `The graph was not accepted. Fix these ${issues.length} problem${issues.length === 1 ? "" : "s"} and call submit_graph again:\n${lines.join("\n")}${more}`;
}

/** Every `submit_graph` call must say why, like any other tool call. */
function reasonIssues(input: Record<string, unknown>): ValidationIssue[] {
  const reason = input.reason;
  const valid = typeof reason === "string" && reason.trim().length > 0 && reason.length <= 300;
  return valid ? [] : [{ code: "schema", message: "reason is required: say in a sentence why you are submitting.", path: "reason" }];
}

/**
 * Runs the exploration loop and streams what happens as trace events. The stream always ends with
 * exactly one terminal event, `run_completed` or `run_failed`; nothing is thrown for failures of
 * the model, the tools or the graph.
 *
 * The loop only talks to the provider interface and the snapshot tools, so a scripted provider
 * and a real one are interchangeable.
 */
export async function* runAgent({
  snapshot,
  provider,
  config: overrides,
  signal,
  now = Date.now,
}: AgentOptions): AsyncGenerator<TraceEvent, void> {
  const config = { ...DEFAULT_AGENT_CONFIG, ...overrides };
  const startedAt = now();
  let seq = 0;
  const event = (input: EventInput): TraceEvent => ({ ...input, seq: seq++, ts: now() }) as TraceEvent;

  let steps = 0;
  let toolCalls = 0;
  let fileReads = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let submitAttempts = 0;
  let idleReplies = 0;
  let wrapUp: LimitKind | undefined;
  let wrapUpSteps = 0;

  const stats = () => ({ steps, toolCalls, durationMs: now() - startedAt, inputTokens, outputTokens });
  const failed = (code: Extract<TraceEvent, { type: "run_failed" }>["code"], message: string) =>
    event({ type: "run_failed", code, message: truncate(message, 500) });

  const reachedLimit = (): LimitKind | undefined => {
    if (steps >= config.maxSteps) return "steps";
    if (fileReads >= config.maxFileReads) return "file_reads";
    if (inputTokens + outputTokens >= config.maxTokens) return "tokens";
    if (now() - startedAt >= config.maxDurationMs) return "time";
    return undefined;
  };

  const everyTool = toolDefinitions(TOOL_NAMES);
  const submitOnly = toolDefinitions(["submit_graph"]);

  yield event({
    type: "run_started",
    repo: snapshot.ref,
    model: provider.info,
    limits: { maxSteps: config.maxSteps, maxFileReads: config.maxFileReads, maxTokens: config.maxTokens },
  });
  yield event({ type: "phase", phase: "recon" });
  const messages: Message[] = [{ role: "user", text: buildTaskMessage(snapshot.ref, config, buildRecon(snapshot)) }];
  yield event({ type: "phase", phase: "explore" });

  /** Runs one tool call. Yields its trace events and returns what the model gets back. */
  async function* handleToolUse(use: { id: string; name: string; input: unknown }): AsyncGenerator<TraceEvent, ToolStep> {
    const reply = (content: string, isError: boolean): ToolResult => ({
      toolUseId: use.id,
      content: truncate(content, MAX_RESULT_CHARS),
      isError,
    });

    if (!isToolName(use.name)) {
      const error = `"${truncate(use.name, 60)}" is not a tool. Available tools: ${TOOL_NAMES.join(", ")}.`;
      yield event({ type: "tool_result", callId: use.id, ok: false, summary: "Called a tool that does not exist", error });
      return { result: reply(error, true) };
    }

    const input = isRecord(use.input) ? use.input : {};
    toolCalls++;

    if (use.name === "submit_graph") {
      const graph = isRecord(input.graph) ? input.graph : undefined;
      const nodes = Array.isArray(graph?.nodes) ? graph.nodes.length : 0;
      const edges = Array.isArray(graph?.edges) ? graph.edges.length : 0;
      yield event({ type: "tool_call", callId: use.id, tool: "submit_graph", input: { reason: input.reason, nodes, edges } });

      submitAttempts++;
      yield event({ type: "phase", phase: submitAttempts === 1 ? "validate" : "repair" });
      const validation = validateGraph(input.graph, snapshot);
      const issues = [...reasonIssues(input), ...(validation.ok ? [] : validation.issues)];
      yield event({ type: "validation", attempt: submitAttempts, ok: issues.length === 0, issues });

      if (issues.length === 0 && validation.ok) {
        yield event({ type: "tool_result", callId: use.id, ok: true, summary: `Graph accepted: ${nodes} nodes, ${edges} edges` });
        return { result: reply("Graph accepted.", false), accepted: validation.graph };
      }
      yield event({ type: "tool_result", callId: use.id, ok: false, summary: `Graph rejected: ${issues.length} problem${issues.length === 1 ? "" : "s"}`, error: truncate(describeIssues(issues), 500) });
      return { result: reply(describeIssues(issues), true) };
    }

    yield event({ type: "tool_call", callId: use.id, tool: use.name, input });

    if (wrapUp !== undefined) {
      const error = "The exploration limit was reached. Only submit_graph is available now.";
      yield event({ type: "tool_result", callId: use.id, ok: false, summary: "Not run: limit reached", error });
      return { result: reply(error, true) };
    }
    if (use.name === "read_file" && fileReads >= config.maxFileReads) {
      const error = "The file read budget is used up. Call submit_graph with what you have.";
      yield event({ type: "tool_result", callId: use.id, ok: false, summary: "Not run: read budget used up", error });
      return { result: reply(error, true) };
    }

    const outcome = isSnapshotTool(use.name) ? runSnapshotTool(snapshot, use.name, input) : { ok: false as const, error: "Unsupported tool." };
    if (outcome.ok) {
      if (use.name === "read_file") fileReads++;
      yield event({ type: "tool_result", callId: use.id, ok: true, summary: truncate(outcome.summary, 500) });
      return { result: reply(outcome.content, false) };
    }
    yield event({ type: "tool_result", callId: use.id, ok: false, summary: "Call failed", error: truncate(outcome.error, 500) });
    return { result: reply(`Error: ${outcome.error}`, true) };
  }

  for (;;) {
    if (signal?.aborted) {
      yield failed("internal", "The run was cancelled.");
      return;
    }

    if (wrapUp === undefined) {
      const hit = reachedLimit();
      if (hit !== undefined) {
        wrapUp = hit;
        yield event({ type: "limit_reached", limit: hit });
        messages.push({ role: "user", text: buildWrapUpMessage(LIMIT_LABELS[hit]) });
      }
    }
    if (wrapUp !== undefined && wrapUpSteps >= MAX_WRAP_UP_STEPS) {
      yield failed("validation_failed", `The ${LIMIT_LABELS[wrapUp]} limit was reached and the model did not submit a valid graph.`);
      return;
    }

    let response;
    try {
      response = await provider.generate({
        system: SYSTEM_PROMPT,
        messages,
        tools: wrapUp === undefined ? everyTool : submitOnly,
        maxOutputTokens: config.maxOutputTokens,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) yield failed("internal", "The run was cancelled.");
      else if (error instanceof ProviderError) yield failed(error.code, error.message);
      else yield failed("model_error", "The model request failed.");
      return;
    }

    steps++;
    if (wrapUp !== undefined) wrapUpSteps++;
    inputTokens += response.usage.inputTokens;
    outputTokens += response.usage.outputTokens;
    yield event({ type: "model_usage", ...response.usage });
    messages.push(response.message);

    if (response.stopReason === "refusal") {
      const refusal = response.refusal ?? { category: null, message: "The model declined this request." };
      yield event({ type: "refusal", category: refusal.category, message: truncate(refusal.message, 500) });
      yield failed("refused", "The model declined to analyse this repository.");
      return;
    }

    const uses = response.message.toolUses;

    if (response.stopReason === "max_tokens") {
      // A cut-off reply may hold a half-written tool call, so none of it is run.
      if (++idleReplies > MAX_IDLE_REPLIES) {
        yield failed("model_error", "The model kept running out of output space.");
        return;
      }
      if (uses.length > 0) {
        messages.push({ role: "tool", results: uses.map((use) => ({ toolUseId: use.id, content: CUT_OFF_MESSAGE, isError: true })) });
      } else {
        messages.push({ role: "user", text: CUT_OFF_MESSAGE });
      }
      continue;
    }

    if (uses.length === 0) {
      if (++idleReplies > MAX_IDLE_REPLIES) {
        yield failed("model_error", "The model stopped calling tools without submitting a graph.");
        return;
      }
      messages.push({ role: "user", text: NO_TOOL_CALL_MESSAGE });
      continue;
    }
    idleReplies = 0;

    const results: ToolResult[] = [];
    for (const use of uses) {
      const { result, accepted } = yield* handleToolUse(use);
      results.push(result);
      if (accepted !== undefined) {
        yield event({ type: "run_completed", graph: accepted, partial: wrapUp !== undefined, cached: false, stats: stats() });
        return;
      }
    }
    messages.push({ role: "tool", results });

    if (submitAttempts >= config.maxSubmitAttempts) {
      yield failed("validation_failed", `The model did not produce a valid graph in ${submitAttempts} attempts.`);
      return;
    }
  }
}

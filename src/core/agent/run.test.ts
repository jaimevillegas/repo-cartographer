import { describe, expect, it } from "vitest";

import { buildDemoExploration } from "../providers/demo-graph";
import { ScriptedProvider, type Script, type ScriptedStep } from "../providers/scripted";
import type { ModelProvider, ModelRequest, Message } from "../providers/types";
import { ProviderError } from "../providers/types";
import { TraceEventSchema, isTerminalEvent, type TraceEvent } from "../schema/trace";
import { snapshotFromTexts } from "../snapshot/testing";
import { runAgent, type AgentConfig } from "./run";

const snapshot = snapshotFromTexts({
  "package.json": '{"name":"shop"}',
  "src/web/index.tsx": 'import { client } from "../api/client";\nexport {};\n',
  "src/api/client.ts": "export const client = 1;\n",
  "src/api/server.ts": "export {};\n",
});

const graph = buildDemoExploration(snapshot).graph;
const reason = "Because the test says so";

const step = {
  list: (): ScriptedStep => ({ toolUses: [{ name: "list_tree", input: { reason } }] }),
  read: (path = "package.json"): ScriptedStep => ({ toolUses: [{ name: "read_file", input: { reason, path } }] }),
  submit: (g: unknown = graph): ScriptedStep => ({ toolUses: [{ name: "submit_graph", input: { reason, graph: g } }] }),
};

async function run(script: Script | ModelProvider, config: Partial<AgentConfig> = {}, extra: { signal?: AbortSignal; now?: () => number } = {}) {
  const provider = "generate" in (script as object) ? (script as ModelProvider) : new ScriptedProvider(script as Script);
  const events: TraceEvent[] = [];
  for await (const event of runAgent({ snapshot, provider, config, ...extra })) events.push(event);
  return events;
}

const types = (events: TraceEvent[]) => events.map((event) => event.type);
const last = (events: TraceEvent[]) => events[events.length - 1];
const find = <T extends TraceEvent["type"]>(events: TraceEvent[], type: T) =>
  events.filter((event): event is Extract<TraceEvent, { type: T }> => event.type === type);

describe("runAgent: a normal run", () => {
  it("explores, submits a valid graph and completes", async () => {
    const events = await run([step.list(), step.read(), step.submit()]);
    expect(types(events)).toEqual([
      "run_started", "phase", "phase",
      "model_usage", "tool_call", "tool_result",
      "model_usage", "tool_call", "tool_result",
      "model_usage", "tool_call", "phase", "validation", "tool_result",
      "run_completed",
    ]);
    const done = last(events);
    expect(done).toMatchObject({ type: "run_completed", partial: false, cached: false, graph });
    expect(done.type === "run_completed" && done.stats).toMatchObject({ steps: 3, toolCalls: 3 });
  });

  it("emits only events the trace schema accepts, in order, ending with one terminal event", async () => {
    const events = await run([step.list(), { toolUses: [{ name: "nope", input: {} }] }, step.read("missing.ts"), step.submit({ nodes: [] }), step.submit()]);
    for (const event of events) expect(TraceEventSchema.safeParse(event).success).toBe(true);
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
    expect(events.filter(isTerminalEvent)).toHaveLength(1);
    expect(isTerminalEvent(last(events))).toBe(true);
  });

  it("starts by announcing the repository, the model and the limits", async () => {
    const [started] = await run([step.submit()], { maxSteps: 7, maxFileReads: 8, maxTokens: 9 });
    expect(started).toMatchObject({
      type: "run_started",
      repo: snapshot.ref,
      model: { provider: "scripted", name: "demo" },
      limits: { maxSteps: 7, maxFileReads: 8, maxTokens: 9 },
    });
  });

  it("pairs each tool call with its result and keeps the model's reason in the trace", async () => {
    const events = await run([step.list(), step.submit()]);
    const [call] = find(events, "tool_call");
    expect(call).toMatchObject({ callId: "call-0-0", tool: "list_tree", input: { reason } });
    expect(find(events, "tool_result")[0]).toMatchObject({ callId: "call-0-0", ok: true });
  });

  it("keeps the submitted graph out of the tool call, which only records its size", async () => {
    const events = await run([step.submit()]);
    const call = find(events, "tool_call")[0];
    expect(call.input).toEqual({ reason, nodes: graph.nodes.length, edges: graph.edges.length });
  });

  it("runs several tool calls from one reply, in order, and answers all of them together", async () => {
    const seen: Message[][] = [];
    const script: Script = (request, call) => {
      seen.push(structuredClone(request.messages) as Message[]);
      return call === 0
        ? { toolUses: [{ name: "list_tree", input: { reason } }, { name: "read_file", input: { reason, path: "package.json" } }] }
        : step.submit();
    };
    await run(script);
    const toolMessage = seen[1].at(-1);
    expect(toolMessage).toMatchObject({ role: "tool", results: [{ toolUseId: "call-0-0" }, { toolUseId: "call-0-1" }] });
  });

  it("never rewrites earlier messages: each request extends the previous one", async () => {
    const histories: Message[][] = [];
    await run((request, call) => {
      histories.push(structuredClone(request.messages) as Message[]);
      return [step.list(), step.read(), { text: "hmm" }, step.submit({ nodes: [] }), step.submit()][call];
    });
    for (let i = 1; i < histories.length; i++) {
      expect(histories[i].slice(0, histories[i - 1].length)).toEqual(histories[i - 1]);
      expect(histories[i].length).toBeGreaterThan(histories[i - 1].length);
    }
  });

  it("offers every tool while exploring, with a stable system prompt", async () => {
    const requests: ModelRequest[] = [];
    await run((request, call) => {
      requests.push({ ...request, messages: [] });
      return [step.list(), step.submit()][call];
    });
    expect(requests[0].tools.map((tool) => tool.name)).toEqual(["list_tree", "read_file", "search_code", "submit_graph"]);
    expect(requests[1].system).toBe(requests[0].system);
  });
});

describe("runAgent: tool problems", () => {
  const modelSees = async (steps: ScriptedStep[]) => {
    const tool: unknown[] = [];
    const events = await run((request, call) => {
      if (call > 0) tool.push(request.messages.at(-1));
      return steps[call] ?? step.submit();
    });
    return { events, tool };
  };

  it("rejects a tool that does not exist and tells the model which ones do", async () => {
    const { events, tool } = await modelSees([{ toolUses: [{ name: "run_shell", input: { command: "ls" } }] }]);
    expect(find(events, "tool_call")).toHaveLength(1);
    expect(find(events, "tool_result")[0]).toMatchObject({ ok: false, summary: "Called a tool that does not exist" });
    expect(tool[0]).toMatchObject({ results: [{ isError: true, content: expect.stringContaining("list_tree, read_file, search_code, submit_graph") }] });
    expect(last(events).type).toBe("run_completed");
  });

  it("returns a failed result for bad arguments and keeps going", async () => {
    const { events, tool } = await modelSees([{ toolUses: [{ name: "read_file", input: { path: "../../etc/passwd" } }] }]);
    expect(find(events, "tool_call")[0].tool).toBe("read_file");
    expect(find(events, "tool_result")[0]).toMatchObject({ ok: false, summary: "Call failed" });
    expect(tool[0]).toMatchObject({ results: [{ isError: true, content: expect.stringContaining("Invalid arguments") }] });
    expect(last(events).type).toBe("run_completed");
  });

  it("copes with a tool input that is not an object", async () => {
    const events = await run([{ toolUses: [{ name: "list_tree", input: "root" }] }, step.submit()]);
    expect(find(events, "tool_result")[0].ok).toBe(false);
    expect(last(events).type).toBe("run_completed");
  });
});

describe("runAgent: submitting the graph", () => {
  it("returns validation problems to the model, then accepts the repaired graph", async () => {
    const broken = structuredClone(graph);
    broken.nodes[0].evidence[0].path = "src/ghost.ts";
    const events = await run([step.submit(broken), step.submit()]);

    const validations = find(events, "validation");
    expect(validations.map((v) => [v.attempt, v.ok])).toEqual([[1, false], [2, true]]);
    expect(validations[0].issues[0]).toMatchObject({ code: "evidence_file_missing", path: "nodes[0].evidence[0]" });
    expect(find(events, "phase").map((p) => p.phase)).toEqual(["recon", "explore", "validate", "repair"]);
    expect(find(events, "tool_result")[0]).toMatchObject({ ok: false, summary: "Graph rejected: 1 problem" });
    expect(last(events)).toMatchObject({ type: "run_completed", partial: false });
  });

  it("puts the problems in the tool result the model reads", async () => {
    const broken = structuredClone(graph);
    broken.edges[0].target = "ghost";
    let reply: unknown;
    await run((request, call) => {
      if (call === 1) reply = request.messages.at(-1);
      return call === 0 ? step.submit(broken) : step.submit();
    });
    expect(reply).toMatchObject({ role: "tool", results: [{ isError: true, content: expect.stringContaining("[unknown_node] edges[0].target") }] });
  });

  it("requires a reason, like every other tool", async () => {
    const events = await run([{ toolUses: [{ name: "submit_graph", input: { graph } }] }, step.submit()]);
    expect(find(events, "validation")[0].issues).toEqual([expect.objectContaining({ code: "schema", path: "reason" })]);
    expect(last(events).type).toBe("run_completed");
  });

  it("gives up after the allowed number of invalid submissions", async () => {
    const events = await run([step.submit({ nodes: [] }), step.submit({ nodes: [] }), step.submit({ nodes: [] })], { maxSubmitAttempts: 2 });
    expect(find(events, "validation")).toHaveLength(2);
    expect(last(events)).toMatchObject({ type: "run_failed", code: "validation_failed" });
  });
});

describe("runAgent: limits", () => {
  it("asks for a submission when the step limit is reached, offering only submit_graph", async () => {
    const wrapRequests: ModelRequest[] = [];
    const events = await run((request) => {
      if (request.tools.length === 1) wrapRequests.push(structuredClone(request));
      return request.tools.length === 1 ? step.submit() : step.list();
    }, { maxSteps: 2 });

    expect(find(events, "limit_reached")).toEqual([expect.objectContaining({ limit: "steps" })]);
    expect(wrapRequests).toHaveLength(1);
    expect(wrapRequests[0].tools.map((tool) => tool.name)).toEqual(["submit_graph"]);
    expect(wrapRequests[0].messages.at(-1)).toMatchObject({ role: "user", text: expect.stringContaining("step limit has been reached") });
    expect(last(events)).toMatchObject({ type: "run_completed", partial: true });
  });

  it("does not run exploration tools once a limit was reached", async () => {
    const events = await run((request) => (request.tools.length === 1 ? { toolUses: [{ name: "list_tree", input: { reason } }] } : step.list()), { maxSteps: 1 });
    const refused = find(events, "tool_result").filter((result) => result.summary === "Not run: limit reached");
    expect(refused.length).toBeGreaterThan(0);
  });

  it("fails when the model still has not submitted after the wrap-up steps", async () => {
    const events = await run(() => step.list(), { maxSteps: 2 });
    expect(last(events)).toMatchObject({ type: "run_failed", code: "validation_failed" });
    expect(find(events, "limit_reached")).toHaveLength(1);
  });

  it("limits file reads: extra reads in the same reply are refused, then it wraps up", async () => {
    const events = await run((request, call) => {
      if (request.tools.length === 1) return step.submit();
      return call === 0 ? { toolUses: [{ name: "read_file", input: { reason, path: "package.json" } }, { name: "read_file", input: { reason, path: "src/api/server.ts" } }] } : step.list();
    }, { maxFileReads: 1 });

    const results = find(events, "tool_result");
    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, summary: "Not run: read budget used up" });
    expect(find(events, "limit_reached")).toEqual([expect.objectContaining({ limit: "file_reads" })]);
    expect(last(events)).toMatchObject({ type: "run_completed", partial: true });
  });

  it("limits tokens using the usage the model reports", async () => {
    const events = await run((request) => (request.tools.length === 1 ? step.submit() : { ...step.list(), usage: { inputTokens: 900, outputTokens: 200 } }), { maxTokens: 1000 });
    expect(find(events, "limit_reached")).toEqual([expect.objectContaining({ limit: "tokens" })]);
    expect(last(events)).toMatchObject({ type: "run_completed", partial: true });
  });

  it("limits wall-clock time", async () => {
    let clock = 0;
    const events = await run((request) => (request.tools.length === 1 ? step.submit() : step.list()), { maxDurationMs: 1000 }, { now: () => (clock += 400) });
    expect(find(events, "limit_reached")).toEqual([expect.objectContaining({ limit: "time" })]);
    expect(last(events)).toMatchObject({ type: "run_completed", partial: true });
  });

  it("adds up token usage in the final stats", async () => {
    const events = await run([{ ...step.list(), usage: { inputTokens: 100, outputTokens: 10 } }, { ...step.submit(), usage: { inputTokens: 200, outputTokens: 20 } }]);
    expect(last(events)).toMatchObject({ type: "run_completed", stats: { inputTokens: 300, outputTokens: 30 } });
    expect(find(events, "model_usage")).toHaveLength(2);
  });
});

describe("runAgent: the model misbehaving", () => {
  it("handles a refusal", async () => {
    const events = await run([{ refusal: { category: "policy", message: "I can't help with this." } }]);
    expect(types(events).slice(-2)).toEqual(["refusal", "run_failed"]);
    expect(find(events, "refusal")[0]).toMatchObject({ category: "policy", message: "I can't help with this." });
    expect(last(events)).toMatchObject({ code: "refused" });
  });

  it("nudges a model that replies without a tool call, and recovers", async () => {
    let nudge: unknown;
    const events = await run((request, call) => {
      if (call === 1) nudge = request.messages.at(-1);
      return call === 0 ? { text: "I think it is a web app." } : step.submit();
    });
    expect(nudge).toMatchObject({ role: "user", text: expect.stringContaining("without calling a tool") });
    expect(last(events).type).toBe("run_completed");
  });

  it("gives up on a model that never calls a tool", async () => {
    const events = await run(() => ({ text: "Still thinking." }));
    expect(last(events)).toMatchObject({ type: "run_failed", code: "model_error" });
    expect(find(events, "model_usage")).toHaveLength(4);
  });

  it("does not run tool calls from a reply that was cut off", async () => {
    let reply: unknown;
    const events = await run((request, call) => {
      if (call === 1) reply = request.messages.at(-1);
      return call === 0 ? { ...step.read(), stopReason: "max_tokens" } : step.submit();
    });
    expect(find(events, "tool_call").map((c) => c.tool)).toEqual(["submit_graph"]);
    expect(reply).toMatchObject({ role: "tool", results: [{ isError: true, content: expect.stringContaining("cut off") }] });
    expect(last(events).type).toBe("run_completed");
  });

  it("answers a cut-off reply that has no tool calls with a user message", async () => {
    let reply: unknown;
    await run((request, call) => {
      if (call === 1) reply = request.messages.at(-1);
      return call === 0 ? { text: "Let me think about", stopReason: "max_tokens" } : step.submit();
    });
    expect(reply).toMatchObject({ role: "user", text: expect.stringContaining("cut off") });
  });
});

describe("runAgent: failures outside the model's control", () => {
  it("reports a rate limit from the provider", async () => {
    const events = await run([step.list(), { error: { code: "rate_limited", message: "The model is busy." } }]);
    expect(last(events)).toMatchObject({ type: "run_failed", code: "rate_limited", message: "The model is busy." });
  });

  it("reports other provider errors as model errors", async () => {
    const events = await run([{ error: { code: "model_error", message: "Upstream 500." } }]);
    expect(last(events)).toMatchObject({ type: "run_failed", code: "model_error" });
  });

  it("does not leak the details of an unexpected exception", async () => {
    const provider: ModelProvider = {
      info: { provider: "broken", name: "x" },
      generate: async () => {
        throw new Error("secret-token=abc123 at /srv/app/provider.ts");
      },
    };
    const events = await run(provider);
    expect(last(events)).toMatchObject({ type: "run_failed", code: "model_error", message: "The model request failed." });
    expect(JSON.stringify(events)).not.toContain("abc123");
  });

  it("stops when the run is cancelled, before and during a model call", async () => {
    const early = new AbortController();
    early.abort();
    expect(last(await run([step.submit()], {}, { signal: early.signal }))).toMatchObject({ type: "run_failed", code: "internal", message: "The run was cancelled." });

    const late = new AbortController();
    const provider: ModelProvider = {
      info: { provider: "slow", name: "x" },
      generate: async () => {
        late.abort();
        throw new ProviderError("model_error", "aborted");
      },
    };
    expect(last(await run(provider, {}, { signal: late.signal }))).toMatchObject({ code: "internal" });
  });
});

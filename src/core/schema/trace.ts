import { z } from "zod";

import { ArchitectureGraphSchema } from "./graph";
import { RepoRefSchema } from "./repo";
import { TOOL_NAMES } from "./tools";
import { ValidationIssueSchema } from "./validation";

export const RUN_PHASES = [
  "resolve",
  "snapshot",
  "recon",
  "plan",
  "explore",
  "validate",
  "repair",
] as const;

export const LIMIT_KINDS = ["steps", "file_reads", "tokens", "time"] as const;

export const RUN_FAILURE_CODES = [
  "invalid_url",
  "repo_not_found",
  "repo_too_large",
  "rate_limited",
  "github_unavailable",
  "model_error",
  "refused",
  "validation_failed",
  "internal",
] as const;

const nonNegativeInt = z.number().int().min(0);

/** Fields every event carries. `seq` orders events within a run; `ts` is epoch milliseconds. */
const base = { seq: nonNegativeInt, ts: nonNegativeInt };

const runStarted = z.strictObject({
  ...base,
  type: z.literal("run_started"),
  repo: RepoRefSchema,
  model: z.strictObject({ provider: z.string().min(1), name: z.string().min(1) }),
  limits: z.strictObject({
    maxSteps: nonNegativeInt,
    maxFileReads: nonNegativeInt,
    maxTokens: nonNegativeInt,
  }),
});

const phaseChanged = z.strictObject({
  ...base,
  type: z.literal("phase"),
  phase: z.enum(RUN_PHASES),
});

/**
 * `input` is deliberately loose. The agent validates it against the tool's schema afterwards, and a
 * call whose arguments are invalid still has to appear in the trace, followed by a failed result.
 */
const toolCall = z.strictObject({
  ...base,
  type: z.literal("tool_call"),
  callId: z.string().min(1),
  tool: z.enum(TOOL_NAMES),
  input: z.record(z.string(), z.unknown()),
});

const toolResult = z.strictObject({
  ...base,
  type: z.literal("tool_result"),
  callId: z.string().min(1),
  ok: z.boolean(),
  /** A short description of what came back, for the trace panel. Never the full file content. */
  summary: z.string().max(500),
  error: z.string().max(500).optional(),
});

/** Token usage of one model request. */
const modelUsage = z.strictObject({
  ...base,
  type: z.literal("model_usage"),
  inputTokens: nonNegativeInt,
  outputTokens: nonNegativeInt,
  cachedInputTokens: nonNegativeInt,
});

const validation = z.strictObject({
  ...base,
  type: z.literal("validation"),
  /** 1 for the first submitted graph, 2 for the first repair, and so on. */
  attempt: z.number().int().min(1),
  ok: z.boolean(),
  issues: z.array(ValidationIssueSchema),
});

const refusal = z.strictObject({
  ...base,
  type: z.literal("refusal"),
  category: z.string().nullable(),
  message: z.string().max(500),
});

const limitReached = z.strictObject({
  ...base,
  type: z.literal("limit_reached"),
  limit: z.enum(LIMIT_KINDS),
});

const runCompleted = z.strictObject({
  ...base,
  type: z.literal("run_completed"),
  graph: ArchitectureGraphSchema,
  /** True when a limit stopped the run before the graph passed validation cleanly. */
  partial: z.boolean(),
  /** True when the result was served from the cache without calling the model. */
  cached: z.boolean(),
  stats: z.strictObject({
    steps: nonNegativeInt,
    toolCalls: nonNegativeInt,
    durationMs: nonNegativeInt,
    inputTokens: nonNegativeInt,
    outputTokens: nonNegativeInt,
  }),
});

const runFailed = z.strictObject({
  ...base,
  type: z.literal("run_failed"),
  code: z.enum(RUN_FAILURE_CODES),
  message: z.string().max(500),
});

export const TraceEventSchema = z.discriminatedUnion("type", [
  runStarted,
  phaseChanged,
  toolCall,
  toolResult,
  modelUsage,
  validation,
  refusal,
  limitReached,
  runCompleted,
  runFailed,
]);

export type TraceEvent = z.infer<typeof TraceEventSchema>;
export type TraceEventType = TraceEvent["type"];
export type RunPhase = (typeof RUN_PHASES)[number];
export type LimitKind = (typeof LIMIT_KINDS)[number];
export type RunFailureCode = (typeof RUN_FAILURE_CODES)[number];

/** The last event of a run: after it, the stream ends. */
export function isTerminalEvent(event: TraceEvent): boolean {
  return event.type === "run_completed" || event.type === "run_failed";
}

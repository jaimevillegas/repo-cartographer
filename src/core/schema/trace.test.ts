import { describe, expect, it } from "vitest";

import { minimalGraph } from "./fixtures";
import { isTerminalEvent, TraceEventSchema, type TraceEvent } from "./trace";

const meta = { seq: 0, ts: 1_700_000_000_000 };
const repo = { owner: "vercel", repo: "next.js", sha: "a".repeat(40) };

const events: TraceEvent[] = [
  {
    ...meta,
    type: "run_started",
    repo,
    model: { provider: "scripted", name: "demo" },
    limits: { maxSteps: 25, maxFileReads: 40, maxTokens: 200_000 },
  },
  { ...meta, type: "phase", phase: "explore" },
  {
    ...meta,
    type: "tool_call",
    callId: "call-1",
    tool: "read_file",
    input: { reason: "Read the entry point", path: "src/index.ts" },
  },
  { ...meta, type: "tool_result", callId: "call-1", ok: true, summary: "Read 42 lines of src/index.ts" },
  { ...meta, type: "model_usage", inputTokens: 1200, outputTokens: 150, cachedInputTokens: 900 },
  {
    ...meta,
    type: "validation",
    attempt: 1,
    ok: false,
    issues: [{ code: "unknown_node", message: 'Edge target "ghost" does not match any node id.', path: "edges[0].target" }],
  },
  { ...meta, type: "refusal", category: null, message: "The model declined this request." },
  { ...meta, type: "limit_reached", limit: "steps" },
  {
    ...meta,
    type: "run_completed",
    graph: minimalGraph,
    partial: false,
    cached: false,
    stats: { steps: 12, toolCalls: 11, durationMs: 41_000, inputTokens: 90_000, outputTokens: 6_000 },
  },
  { ...meta, type: "run_failed", code: "rate_limited", message: "GitHub rate limit reached." },
];

describe("TraceEventSchema", () => {
  it.each(events.map((event) => [event.type, event] as const))("accepts a %s event", (_type, event) => {
    expect(TraceEventSchema.safeParse(event).success).toBe(true);
  });

  it("round-trips through JSON, as it does when streamed", () => {
    for (const event of events) {
      expect(TraceEventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
    }
  });

  it("rejects an unknown event type", () => {
    expect(TraceEventSchema.safeParse({ ...meta, type: "thought", text: "hmm" }).success).toBe(false);
  });

  it("rejects a tool call for a tool that does not exist", () => {
    expect(
      TraceEventSchema.safeParse({ ...meta, type: "tool_call", callId: "c", tool: "run_shell", input: {} })
        .success,
    ).toBe(false);
  });

  it("keeps a tool call with invalid arguments, so failed calls can be traced", () => {
    expect(
      TraceEventSchema.safeParse({ ...meta, type: "tool_call", callId: "c", tool: "read_file", input: { path: 7 } })
        .success,
    ).toBe(true);
  });

  it("rejects a completed run whose graph is invalid", () => {
    const completed = events.find((event) => event.type === "run_completed")!;
    expect(
      TraceEventSchema.safeParse({ ...completed, graph: { nodes: [], edges: [] } }).success,
    ).toBe(false);
  });

  it("rejects negative counters and missing ordering fields", () => {
    expect(
      TraceEventSchema.safeParse({ ...meta, type: "model_usage", inputTokens: -1, outputTokens: 0, cachedInputTokens: 0 })
        .success,
    ).toBe(false);
    expect(TraceEventSchema.safeParse({ type: "phase", phase: "plan" }).success).toBe(false);
  });
});

describe("isTerminalEvent", () => {
  it("is true only for run_completed and run_failed", () => {
    const terminal = events.filter(isTerminalEvent).map((event) => event.type);
    expect(terminal).toEqual(["run_completed", "run_failed"]);
  });
});

import { describe, expect, it, vi } from "vitest";

import { buildScenario, SCENARIO_DESCRIPTIONS, SCENARIO_NAMES, type ScenarioName } from "../providers/scenarios";
import { ScriptedProvider } from "../providers/scripted";
import { TraceEventSchema, type TraceEvent } from "../schema/trace";
import type { Snapshot } from "../snapshot/snapshot";
import { snapshotFromTexts } from "../snapshot/testing";
import { runAgent, type AgentConfig } from "./run";

const repo = snapshotFromTexts({
  "package.json": '{"name":"shop","dependencies":{"next":"1"}}',
  "src/web/index.tsx": 'import { client } from "../api/client";\nexport {};\n',
  "src/web/page.tsx": "export {};\n",
  "src/api/client.ts": "export const client = 1;\n",
  "src/api/server.ts": 'import { pool } from "../database/pool";\nexport {};\n',
  "src/database/pool.ts": "export const pool = 1;\n",
  "src/worker/jobs.ts": "export {};\n",
});

async function play(name: ScenarioName, snapshot: Snapshot = repo, config: Partial<AgentConfig> = {}) {
  const provider = new ScriptedProvider(buildScenario(name, snapshot));
  const events: TraceEvent[] = [];
  for await (const event of runAgent({ snapshot, provider, config })) events.push(event);
  return events;
}

const last = (events: TraceEvent[]) => events[events.length - 1];
const only = <T extends TraceEvent["type"]>(events: TraceEvent[], type: T) =>
  events.filter((event): event is Extract<TraceEvent, { type: T }> => event.type === type);

describe("scenarios", () => {
  it("has a description for every scenario", () => {
    expect(Object.keys(SCENARIO_DESCRIPTIONS).sort()).toEqual([...SCENARIO_NAMES].sort());
  });

  it.each(SCENARIO_NAMES)("%s produces a trace the schema accepts and ends with one terminal event", async (name) => {
    const events = await play(name, repo, { maxSteps: 5 });
    for (const event of events) expect(TraceEventSchema.safeParse(event).success).toBe(true);
    expect(events.filter((e) => e.type === "run_completed" || e.type === "run_failed")).toHaveLength(1);
  });

  it("success: reads the code, finds the components and completes", async () => {
    const events = await play("success");
    expect(last(events)).toMatchObject({ type: "run_completed", partial: false });
    const tools = only(events, "tool_call").map((call) => call.tool);
    expect(tools[0]).toBe("list_tree");
    expect(tools).toContain("read_file");
    expect(tools.at(-1)).toBe("submit_graph");
    expect(only(events, "tool_result").every((result) => result.ok)).toBe(true);
    const done = last(events);
    expect(done.type === "run_completed" && done.graph.nodes.length).toBe(4);
  });

  it("repair: the validator's feedback turns a bad first graph into a good one", async () => {
    const events = await play("repair");
    const validations = only(events, "validation");
    expect(validations.map((v) => v.ok)).toEqual([false, true]);
    expect(validations[0].issues.map((issue) => issue.code).sort()).toEqual(["evidence_file_missing", "unknown_node"]);
    expect(last(events)).toMatchObject({ type: "run_completed", partial: false });
  });

  it("repair: still works on a repository whose graph has no edges", async () => {
    const flat = snapshotFromTexts({ "main.py": "print(1)\n" });
    const events = await play("repair", flat);
    expect(only(events, "validation").map((v) => v.ok)).toEqual([false, true]);
    expect(last(events).type).toBe("run_completed");
  });

  it("step_limit: hits the limit, submits what it has, and the result is marked partial", async () => {
    const events = await play("step_limit", repo, { maxSteps: 4 });
    expect(only(events, "limit_reached")).toEqual([expect.objectContaining({ limit: "steps" })]);
    expect(last(events)).toMatchObject({ type: "run_completed", partial: true });
  });

  it("refusal: ends with a refusal event and a refused failure", async () => {
    const events = await play("refusal");
    expect(only(events, "refusal")).toHaveLength(1);
    expect(last(events)).toMatchObject({ type: "run_failed", code: "refused" });
  });

  it("rate_limit: fails with rate_limited after some exploration", async () => {
    const events = await play("rate_limit");
    expect(only(events, "tool_call").length).toBeGreaterThan(0);
    expect(last(events)).toMatchObject({ type: "run_failed", code: "rate_limited" });
  });

  it("injection_attempt: the call to a tool that does not exist is refused and the run still succeeds", async () => {
    const events = await play("injection_attempt");
    const refused = only(events, "tool_result").filter((result) => result.summary === "Called a tool that does not exist");
    expect(refused).toHaveLength(1);
    expect(only(events, "tool_call").map((call) => call.tool)).not.toContain("run_shell");
    expect(last(events)).toMatchObject({ type: "run_completed", partial: false });
  });

  it("works on a repository with a different shape", async () => {
    const other = snapshotFromTexts({
      "apps/dashboard/main.ts": "export {};\n",
      "apps/billing/main.ts": "export {};\n",
      "packages/shared/index.ts": "export {};\n",
    });
    for (const name of ["success", "repair"] as const) {
      expect(last(await play(name, other)).type).toBe("run_completed");
    }
  });

  it("adds simulated latency to every turn when asked", async () => {
    const sleep = vi.fn(async () => undefined);
    const provider = new ScriptedProvider(buildScenario("success", repo, { latencyMs: 400 }), { sleep });
    for await (const event of runAgent({ snapshot: repo, provider })) void event;
    expect(sleep).toHaveBeenCalledTimes(provider.callCount);
    expect(sleep).toHaveBeenCalledWith(400, undefined);
  });
});

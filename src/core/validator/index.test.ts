import { describe, expect, it } from "vitest";

import { minimalGraph } from "../schema/fixtures";
import { ValidationIssueSchema } from "../schema/validation";
import { snapshotFromTexts } from "../snapshot/testing";
import { validateGraph } from "./index";

const body = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n");
const snapshot = snapshotFromTexts({
  "src/app/page.tsx": body,
  "src/app/api/analyze/route.ts": body,
  "src/server/cache.ts": body,
});

describe("validateGraph", () => {
  it("returns the parsed graph when every layer passes", () => {
    expect(validateGraph(minimalGraph, snapshot)).toEqual({ ok: true, graph: minimalGraph });
  });

  it("reports schema problems with readable paths and stops there", () => {
    const graph = structuredClone(minimalGraph) as unknown as { nodes: Array<Record<string, unknown>> };
    graph.nodes[1].type = "microservice";
    delete graph.nodes[2].evidence;
    const result = validateGraph(graph, snapshot);
    if (result.ok) throw new Error("expected issues");
    expect(result.issues.every((issue) => issue.code === "schema")).toBe(true);
    expect(result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(["nodes[1].type", "nodes[2].evidence"]),
    );
  });

  it("reports integrity and evidence problems together", () => {
    const graph = structuredClone(minimalGraph);
    graph.edges[0].target = "ghost";
    graph.nodes[0].evidence[0].path = "src/missing.tsx";
    const result = validateGraph(graph, snapshot);
    if (result.ok) throw new Error("expected issues");
    expect(result.issues.map((issue) => issue.code).sort()).toEqual(["evidence_file_missing", "unknown_node"]);
  });

  it("rejects input that is not even an object", () => {
    for (const input of [null, undefined, "graph", 42, []]) {
      expect(validateGraph(input, snapshot).ok).toBe(false);
    }
  });

  it("produces issues the trace schema accepts, whatever the model sent", () => {
    const graph = structuredClone(minimalGraph) as unknown as Record<string, unknown>;
    graph.nodes = "not an array";
    graph.extra = "x".repeat(10_000);
    const result = validateGraph(graph, snapshot);
    if (result.ok) throw new Error("expected issues");
    for (const issue of result.issues) expect(ValidationIssueSchema.safeParse(issue).success).toBe(true);
  });

  it("caps the number of schema issues", () => {
    const graph = { nodes: Array.from({ length: 30 }, () => ({})), edges: [] };
    const result = validateGraph(graph, snapshot);
    if (result.ok) throw new Error("expected issues");
    expect(result.issues.length).toBeLessThanOrEqual(25);
  });
});

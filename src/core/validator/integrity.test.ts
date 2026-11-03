import { describe, expect, it } from "vitest";

import { minimalGraph } from "../schema/fixtures";
import type { ArchitectureGraph } from "../schema/graph";
import { checkGraphIntegrity } from "./integrity";

const clone = () => structuredClone(minimalGraph);
const codes = (graph: ArchitectureGraph) => checkGraphIntegrity(graph).map((issue) => issue.code);

describe("checkGraphIntegrity", () => {
  it("returns no issues for a consistent graph", () => {
    expect(checkGraphIntegrity(minimalGraph)).toEqual([]);
  });

  it("reports duplicate node ids", () => {
    const graph = clone();
    graph.nodes[1].id = "web";
    expect(codes(graph)).toContain("duplicate_node_id");
  });

  it("reports edges that point at missing nodes, with the offending path", () => {
    const graph = clone();
    graph.edges[0].target = "ghost";
    expect(checkGraphIntegrity(graph)).toEqual([
      expect.objectContaining({ code: "unknown_node", path: "edges[0].target" }),
    ]);
  });

  it("reports self-loops", () => {
    const graph = clone();
    graph.edges[0].target = "web";
    expect(codes(graph)).toEqual(["self_loop"]);
  });

  it("reports duplicate edges but allows the same pair with different relations", () => {
    const graph = clone();
    graph.edges.push({ ...graph.edges[0] });
    expect(codes(graph)).toEqual(["duplicate_edge"]);

    const distinct = clone();
    distinct.edges.push({ ...distinct.edges[0], relation: "depends_on" });
    expect(codes(distinct)).toEqual([]);
  });

  it("reports parents that do not exist or point at the node itself", () => {
    const missing = clone();
    missing.nodes[0].parent = "ghost";
    expect(codes(missing)).toEqual(["invalid_parent"]);

    const self = clone();
    self.nodes[0].parent = "web";
    expect(codes(self)).toEqual(["invalid_parent"]);
  });

  it("accepts a valid parent", () => {
    const graph = clone();
    graph.nodes[0].parent = "api";
    expect(codes(graph)).toEqual([]);
  });

  it("reports a parent cycle once", () => {
    const graph = clone();
    graph.nodes[0].parent = "api";
    graph.nodes[1].parent = "cache";
    graph.nodes[2].parent = "web";
    const issues = checkGraphIntegrity(graph);
    expect(issues.map((issue) => issue.code)).toEqual(["parent_cycle"]);
    expect(issues[0].message).toContain("web -> api -> cache -> web");
  });

  it("reports a cycle reached from a node outside it, exactly once", () => {
    const graph = clone();
    // web -> api -> cache -> api: web is not part of the cycle, api and cache are.
    graph.nodes[0].parent = "api";
    graph.nodes[1].parent = "cache";
    graph.nodes[2].parent = "api";
    expect(codes(graph)).toEqual(["parent_cycle"]);
  });
});

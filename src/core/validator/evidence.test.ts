import { describe, expect, it } from "vitest";

import { minimalGraph } from "../schema/fixtures";
import type { ArchitectureGraph } from "../schema/graph";
import { SnapshotBuilder } from "../snapshot/snapshot";
import { snapshotFromTexts, testRef } from "../snapshot/testing";
import { checkEvidence } from "./evidence";

const clone = () => structuredClone(minimalGraph);

/** A snapshot with every file the fixture graph cites, long enough to hold its ranges. */
function snapshotCiting(graph: ArchitectureGraph, lines = 500) {
  const body = Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join("\n");
  const paths = new Set([
    ...graph.nodes.flatMap((node) => node.evidence.map((e) => e.path)),
    ...graph.edges.flatMap((edge) => edge.evidence.map((e) => e.path)),
  ]);
  return snapshotFromTexts(Object.fromEntries([...paths].map((path) => [path, body])));
}

describe("checkEvidence", () => {
  it("accepts a graph whose evidence points at real lines", () => {
    expect(checkEvidence(minimalGraph, snapshotCiting(minimalGraph))).toEqual([]);
  });

  it("reports a file that does not exist, with the path of the offending evidence", () => {
    const graph = clone();
    graph.nodes[1].evidence[0].path = "src/ghost.ts";
    const issues = checkEvidence(graph, snapshotCiting(minimalGraph));
    expect(issues).toEqual([
      expect.objectContaining({ code: "evidence_file_missing", path: "nodes[1].evidence[0]" }),
    ]);
    expect(issues[0].message).toContain("src/ghost.ts");
  });

  it("checks edge evidence as well as node evidence", () => {
    const graph = clone();
    graph.edges[0].evidence[0].path = "nowhere.ts";
    expect(checkEvidence(graph, snapshotCiting(minimalGraph))).toEqual([
      expect.objectContaining({ code: "evidence_file_missing", path: "edges[0].evidence[0]" }),
    ]);
  });

  it("suggests files with the same name when the directory is wrong", () => {
    const graph = clone();
    const cited = graph.nodes[0].evidence[0].path;
    graph.nodes[0].evidence[0].path = `wrong/dir/${cited.split("/").pop()}`;
    const [issue] = checkEvidence(graph, snapshotCiting(minimalGraph));
    expect(issue.message).toContain("Did you mean");
    expect(issue.message).toContain(`"${cited}"`);
  });

  it("reports a range that runs past the end of the file, naming the real length", () => {
    const issues = checkEvidence(minimalGraph, snapshotCiting(minimalGraph, 3));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.code === "evidence_out_of_range")).toBe(true);
    expect(issues[0].message).toContain("has 3 lines");
  });

  it("accepts a range ending exactly on the last line and rejects one line further", () => {
    const graph = clone();
    const evidence = graph.nodes[0].evidence[0];
    evidence.startLine = 1;
    evidence.endLine = 10;
    const only = (lines: number) => checkEvidence({ nodes: [graph.nodes[0]], edges: [] }, snapshotFromTexts({
      [evidence.path]: Array.from({ length: lines }, () => "x").join("\n"),
    }));
    expect(only(10)).toEqual([]);
    expect(only(9)).toEqual([expect.objectContaining({ code: "evidence_out_of_range" })]);
  });

  it("rejects citations into empty, binary and oversized files", () => {
    const graph = clone();
    const [web, api, cache] = graph.nodes;
    web.evidence[0].path = "empty.ts";
    api.evidence[0].path = "logo.png";
    cache.evidence[0].path = "dump.sql";

    const builder = new SnapshotBuilder();
    builder.add({ path: "empty.ts", size: 0, text: "" });
    builder.add({ path: "logo.png", size: 10, text: null, omitted: "binary" });
    builder.add({ path: "dump.sql", size: 9_000_000, text: null, omitted: "too_large" });
    for (const edge of graph.edges) for (const e of edge.evidence) builder.add({ path: e.path, size: 1, text: "x\n".repeat(500) });

    const issues = checkEvidence(graph, builder.build(testRef));
    expect(issues.map((issue) => issue.message)).toEqual([
      expect.stringContaining("is empty"),
      expect.stringContaining("binary"),
      expect.stringContaining("too large"),
    ]);
  });
});

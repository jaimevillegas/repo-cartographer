import { describe, expect, it } from "vitest";

import { EvidenceSchema, RepoPathSchema } from "./evidence";
import { minimalGraph } from "./fixtures";
import { ArchitectureGraphSchema, MAX_NODES } from "./graph";
import { RepoRefSchema } from "./repo";

describe("RepoPathSchema", () => {
  it.each(["README.md", "src/app/page.tsx", "apps/api/src/index.ts"])("accepts %s", (path) => {
    expect(RepoPathSchema.safeParse(path).success).toBe(true);
  });

  it.each(["/etc/passwd", "../secrets", "src/../../x", "src//a", "./a", "a\\b", "a\0b", ""])(
    "rejects %j",
    (path) => {
      expect(RepoPathSchema.safeParse(path).success).toBe(false);
    },
  );
});

describe("EvidenceSchema", () => {
  it("accepts a valid range", () => {
    expect(EvidenceSchema.safeParse({ path: "a.ts", startLine: 3, endLine: 9 }).success).toBe(true);
  });

  it("rejects an inverted range", () => {
    expect(EvidenceSchema.safeParse({ path: "a.ts", startLine: 9, endLine: 3 }).success).toBe(false);
  });

  it("rejects a range longer than 200 lines", () => {
    expect(EvidenceSchema.safeParse({ path: "a.ts", startLine: 1, endLine: 201 }).success).toBe(false);
    expect(EvidenceSchema.safeParse({ path: "a.ts", startLine: 1, endLine: 200 }).success).toBe(true);
  });

  it("rejects line 0 and unknown keys", () => {
    expect(EvidenceSchema.safeParse({ path: "a.ts", startLine: 0, endLine: 1 }).success).toBe(false);
    expect(
      EvidenceSchema.safeParse({ path: "a.ts", startLine: 1, endLine: 1, extra: true }).success,
    ).toBe(false);
  });
});

describe("ArchitectureGraphSchema", () => {
  it("accepts the minimal graph", () => {
    expect(ArchitectureGraphSchema.safeParse(minimalGraph).success).toBe(true);
  });

  it("rejects a node without evidence", () => {
    const graph = structuredClone(minimalGraph);
    graph.nodes[0].evidence = [];
    expect(ArchitectureGraphSchema.safeParse(graph).success).toBe(false);
  });

  it("rejects an edge without evidence", () => {
    const graph = structuredClone(minimalGraph);
    graph.edges[0].evidence = [];
    expect(ArchitectureGraphSchema.safeParse(graph).success).toBe(false);
  });

  it("rejects an unknown node type or relation", () => {
    const badType = structuredClone(minimalGraph) as unknown as { nodes: { type: string }[] };
    badType.nodes[0].type = "microservice";
    expect(ArchitectureGraphSchema.safeParse(badType).success).toBe(false);

    const badRelation = structuredClone(minimalGraph) as unknown as { edges: { relation: string }[] };
    badRelation.edges[0].relation = "likes";
    expect(ArchitectureGraphSchema.safeParse(badRelation).success).toBe(false);
  });

  it("rejects ids that are not slugs", () => {
    const graph = structuredClone(minimalGraph);
    graph.nodes[0].id = "Web App";
    expect(ArchitectureGraphSchema.safeParse(graph).success).toBe(false);
  });

  it("rejects an empty graph and more than the node limit", () => {
    expect(ArchitectureGraphSchema.safeParse({ nodes: [], edges: [] }).success).toBe(false);
    const nodes = Array.from({ length: MAX_NODES + 1 }, (_, index) => ({
      ...minimalGraph.nodes[0],
      id: `node-${index}`,
    }));
    expect(ArchitectureGraphSchema.safeParse({ nodes, edges: [] }).success).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(ArchitectureGraphSchema.safeParse({ ...minimalGraph, title: "x" }).success).toBe(false);
  });
});

describe("RepoRefSchema", () => {
  const sha = "a".repeat(40);

  it("accepts a pinned repository", () => {
    expect(RepoRefSchema.safeParse({ owner: "vercel", repo: "next.js", sha }).success).toBe(true);
  });

  it("rejects a short sha and an owner with a slash", () => {
    expect(RepoRefSchema.safeParse({ owner: "vercel", repo: "next.js", sha: "abc123" }).success).toBe(false);
    expect(RepoRefSchema.safeParse({ owner: "a/b", repo: "next.js", sha }).success).toBe(false);
  });
});

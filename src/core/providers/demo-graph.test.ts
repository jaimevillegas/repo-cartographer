import { describe, expect, it } from "vitest";

import { ArchitectureGraphSchema } from "../schema/graph";
import { SnapshotBuilder } from "../snapshot/snapshot";
import { snapshotFromTexts, testRef } from "../snapshot/testing";
import { checkGraphIntegrity } from "../validator/integrity";
import { validateGraph } from "../validator";
import { buildDemoExploration } from "./demo-graph";

const repo = snapshotFromTexts({
  "package.json": '{"name":"shop"}',
  "README.md": "# Shop\n",
  "docs/guide.md": "docs",
  "src/web/index.tsx": 'import { client } from "../api/client";\nexport {};\n',
  "src/web/page.tsx": "export {};\n",
  "src/api/client.ts": "export const client = 1;\n",
  "src/api/server.ts": 'import { pool } from "../database/pool";\nexport {};\n',
  "src/database/pool.ts": "export const pool = 1;\n",
  "src/database/schema.ts": "export {};\n",
  "node_modules/dep/index.js": "x",
});

describe("buildDemoExploration", () => {
  const exploration = buildDemoExploration(repo);

  it("produces a graph that passes every validation layer", () => {
    expect(ArchitectureGraphSchema.safeParse(exploration.graph).success).toBe(true);
    expect(checkGraphIntegrity(exploration.graph)).toEqual([]);
    expect(validateGraph(exploration.graph, repo)).toEqual({ ok: true, graph: exploration.graph });
  });

  it("makes one component per area under src, ignoring docs and dependencies", () => {
    expect(exploration.graph.nodes.map((node) => node.id)).toEqual(["src-api", "src-database", "src-web"]);
    expect(exploration.graph.nodes.map((node) => node.type)).toEqual(["service", "database", "frontend"]);
  });

  it("adds an edge where one area imports from another, citing that very line", () => {
    expect(exploration.graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["src-api", "src-database"],
      ["src-web", "src-api"],
    ]);
    const [apiToDb] = exploration.graph.edges;
    expect(apiToDb.evidence).toEqual([{ path: "src/api/server.ts", startLine: 1, endLine: 1 }]);
  });

  it("names the build file to open first, apart from the reads that cover the evidence", () => {
    expect(exploration.manifest).toEqual({ path: "package.json", startLine: 1, endLine: 60 });
    expect(exploration.reads.map((read) => read.path)).not.toContain("package.json");
    const read = (path: string, line: number) =>
      exploration.reads.some((r) => r.path === path && (r.startLine ?? 1) <= line && line <= (r.endLine ?? Infinity));
    for (const item of [...exploration.graph.nodes, ...exploration.graph.edges]) {
      for (const evidence of item.evidence) expect(read(evidence.path, evidence.startLine)).toBe(true);
    }
  });

  it("suggests a search term and is deterministic", () => {
    expect(exploration.searchTerm).toBe("api");
    expect(buildDemoExploration(repo)).toEqual(exploration);
  });

  it("describes a flat repository as one component", () => {
    const flat = snapshotFromTexts({ "main.py": "print(1)\n", "util.py": "x = 1\n" });
    const { graph } = buildDemoExploration(flat);
    expect(graph.nodes).toHaveLength(1);
    expect(validateGraph(graph, flat).ok).toBe(true);
  });

  it("refuses a repository with nothing readable", () => {
    const builder = new SnapshotBuilder();
    builder.add({ path: "logo.png", size: 5, text: null, omitted: "binary" });
    expect(() => buildDemoExploration(builder.build(testRef))).toThrow("no readable files");
  });

  it("limits the number of components", () => {
    const many = snapshotFromTexts(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`pkg${i}/index.ts`, "export {};\n"])));
    expect(buildDemoExploration(many).graph.nodes).toHaveLength(8);
  });
});

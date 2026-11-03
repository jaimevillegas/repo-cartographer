import type { Evidence } from "../schema/evidence";
import type { ArchitectureGraph, GraphEdge, GraphNode, NodeType } from "../schema/graph";
import type { Snapshot, SnapshotFile } from "../snapshot/snapshot";

/** Directories that rarely hold architecture. */
const NOISE = new Set([
  "node_modules", "dist", "build", "out", "coverage", "docs", "doc", "test", "tests", "__tests__",
  "e2e", "fixtures", "examples", "example", "public", "assets", "static", "scripts", "vendor", "target",
]);
/** Directories that group components: their children are the candidates. */
const CONTAINERS = new Set(["src", "packages", "apps", "services", "libs", "modules", "crates", "cmd", "internal", "pkg", "lib"]);
const MANIFESTS = ["package.json", "pyproject.toml", "go.mod", "Cargo.toml", "pom.xml"];
const ENTRY_NAME = /^(index|main|app|server|mod|lib|__init__|page|route)\./;
const MAX_AREAS = 8;
const MAX_EDGES = 12;
const MAX_FILES_SCANNED = 150;
const EVIDENCE_LINES = 30;
const MANIFEST_LINES = 60;

export type DemoRead = { path: string; startLine?: number; endLine?: number };

export type DemoExploration = {
  graph: ArchitectureGraph;
  /** The build file a person would open first, when the repository has one. */
  manifest?: DemoRead;
  /** The reads that justify the evidence in the graph, in the order a person would do them. */
  reads: DemoRead[];
  /** A word worth searching for, taken from the first component. */
  searchTerm?: string;
};

type Area = { dir: string; files: SnapshotFile[] };

const segmentOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const isReadable = (file: SnapshotFile): file is SnapshotFile & { text: string } => file.text !== null && file.text.length > 0;

function findAreas(snapshot: Snapshot): Area[] {
  const candidates: string[] = [];
  for (const entry of snapshot.list("", 1) ?? []) {
    if (entry.type !== "dir" || NOISE.has(entry.path) || entry.path.startsWith(".")) continue;
    const children = CONTAINERS.has(entry.path)
      ? (snapshot.list(entry.path, 1) ?? []).filter((child) => child.type === "dir" && !NOISE.has(segmentOf(child.path)))
      : [];
    if (children.length > 0) candidates.push(...children.map((child) => child.path));
    else candidates.push(entry.path);
  }

  const files = snapshot.files().filter(isReadable);
  return candidates
    .map((dir) => ({ dir, files: files.filter((file) => file.path.startsWith(`${dir}/`)) }))
    .filter((area) => area.files.length > 0)
    .sort((a, b) => b.files.length - a.files.length || (a.dir < b.dir ? -1 : 1))
    .slice(0, MAX_AREAS)
    .sort((a, b) => (a.dir < b.dir ? -1 : 1));
}

function nodeType(dir: string): NodeType {
  const name = segmentOf(dir).toLowerCase();
  if (/(web|ui|frontend|client|site|app)$/.test(name)) return "frontend";
  if (/(api|server|service|backend|gateway)/.test(name)) return "service";
  if (/(db|database|prisma|migrations|store)/.test(name)) return "database";
  if (/(queue|worker|jobs|tasks)/.test(name)) return "queue";
  if (/(infra|deploy|docker|terraform|k8s)/.test(name)) return "infrastructure";
  return "module";
}

function uniqueId(dir: string, taken: Set<string>): string {
  const base = dir.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "component";
  let id = /^[a-z0-9]/.test(base) ? base : `c-${base}`;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

function bestFile(files: Array<SnapshotFile & { text: string }>): SnapshotFile & { text: string } {
  const depth = (file: SnapshotFile) => file.path.split("/").length;
  const rank = (file: SnapshotFile) => {
    const name = segmentOf(file.path);
    if (/\.(test|spec)\./.test(name)) return 2;
    return ENTRY_NAME.test(name) ? 0 : 1;
  };
  return [...files].sort((a, b) => rank(a) - rank(b) || depth(a) - depth(b) || (a.path < b.path ? -1 : 1))[0];
}

const evidenceFor = (snapshot: Snapshot, file: SnapshotFile): Evidence => ({
  path: file.path,
  startLine: 1,
  endLine: Math.max(1, Math.min(snapshot.lines(file.path)?.length ?? 1, EVIDENCE_LINES)),
});

/** Does this line import something from a directory named `segment`? */
function importsFrom(line: string, segment: string): boolean {
  if (!/\b(import|from|require|use)\b/.test(line)) return false;
  return [`/${segment}/`, `/${segment}"`, `/${segment}'`, `"${segment}/`, `'${segment}/`].some((needle) => line.includes(needle));
}

/**
 * Builds a plausible architecture graph for any repository without a model: one component per
 * top-level area, and a `depends_on` edge wherever one area imports from another. Every piece of
 * evidence is a real line of a real file, so the graph passes the real validator. It exists to drive
 * the demo mode and the tests, not to be a good analysis.
 */
export function buildDemoExploration(snapshot: Snapshot): DemoExploration {
  const reads: DemoRead[] = [];
  const manifest = MANIFESTS.find((name) => isReadable(snapshot.file(name) ?? { path: name, size: 0, text: null, omitted: "binary" }));

  let areas = findAreas(snapshot);
  if (areas.length === 0) {
    const files = snapshot.files().filter(isReadable);
    if (files.length === 0) throw new Error("The snapshot has no readable files to describe.");
    areas = [{ dir: "", files }];
  }

  const taken = new Set<string>();
  const nodes: GraphNode[] = areas.map((area) => {
    const file = bestFile(area.files as Array<SnapshotFile & { text: string }>);
    const evidence = evidenceFor(snapshot, file);
    reads.push({ path: evidence.path, startLine: evidence.startLine, endLine: evidence.endLine });
    const label = area.dir === "" ? "Repository" : area.dir;
    return {
      id: uniqueId(area.dir || "repository", taken),
      name: label.slice(0, 80),
      type: area.dir === "" ? "module" : nodeType(area.dir),
      description: `Code under ${label}${area.dir === "" ? "" : "/"} (${area.files.length} file${area.files.length === 1 ? "" : "s"}).`,
      evidence: [evidence],
    };
  });

  const edges: GraphEdge[] = [];
  for (const [fromIndex, from] of areas.entries()) {
    for (const [toIndex, to] of areas.entries()) {
      if (fromIndex === toIndex || to.dir === "" || edges.length >= MAX_EDGES) continue;
      const segment = segmentOf(to.dir);
      if (segment.length < 3) continue;
      if (edges.some((edge) => edge.source === nodes[fromIndex].id && edge.target === nodes[toIndex].id)) continue;

      for (const file of from.files.slice(0, MAX_FILES_SCANNED)) {
        const lines = snapshot.lines(file.path) ?? [];
        const index = lines.findIndex((line) => importsFrom(line, segment));
        if (index === -1) continue;
        edges.push({
          source: nodes[fromIndex].id,
          target: nodes[toIndex].id,
          relation: "depends_on",
          certainty: "inferred",
          description: `${from.dir} imports from ${to.dir}.`.slice(0, 200),
          evidence: [{ path: file.path, startLine: index + 1, endLine: index + 1 }],
        });
        reads.push({ path: file.path, startLine: Math.max(1, index - 2), endLine: Math.min(lines.length, index + 4) });
        break;
      }
    }
  }

  return {
    graph: { nodes, edges },
    manifest: manifest ? { path: manifest, startLine: 1, endLine: MANIFEST_LINES } : undefined,
    reads, searchTerm: areas[0].dir === "" ? undefined : segmentOf(areas[0].dir),
  };
}

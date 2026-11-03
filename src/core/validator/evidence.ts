import type { Evidence } from "../schema/evidence";
import type { ArchitectureGraph } from "../schema/graph";
import type { ValidationIssue } from "../schema/validation";
import type { Snapshot } from "../snapshot/snapshot";

const MAX_SUGGESTIONS = 3;

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Files elsewhere in the repo with the same name, to help the model fix a wrong directory. */
function similarPaths(snapshot: Snapshot, path: string): string[] {
  const name = basename(path);
  return snapshot
    .files()
    .filter((file) => basename(file.path) === name)
    .slice(0, MAX_SUGGESTIONS)
    .map((file) => file.path);
}

function checkOne(snapshot: Snapshot, evidence: Evidence, path: string): ValidationIssue | undefined {
  const file = snapshot.file(evidence.path);
  if (file === undefined) {
    const suggestions = similarPaths(snapshot, evidence.path);
    const hint = suggestions.length > 0 ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(" or ")}?` : "";
    return {
      code: "evidence_file_missing",
      message: `"${evidence.path}" does not exist at the analysed commit.${hint}`,
      path,
    };
  }

  if (file.text === null) {
    const reason = file.omitted === "binary" ? "is a binary file" : "is too large to read";
    return {
      code: "evidence_out_of_range",
      message: `"${evidence.path}" ${reason}, so its lines cannot be cited. Cite a text file instead.`,
      path,
    };
  }

  const lineCount = snapshot.lines(evidence.path)?.length ?? 0;
  if (evidence.endLine > lineCount) {
    return {
      code: "evidence_out_of_range",
      message:
        lineCount === 0
          ? `"${evidence.path}" is empty, so it has no lines to cite.`
          : `"${evidence.path}" has ${lineCount} lines, but the evidence cites lines ${evidence.startLine}-${evidence.endLine}.`,
      path,
    };
  }
  return undefined;
}

/**
 * Checks every piece of evidence against the snapshot: the file must exist at the pinned commit
 * and the cited lines must fall inside it. This proves the citation points at real lines. Whether
 * the lines support the claim is a separate question, answered by the evals.
 */
export function checkEvidence(graph: ArchitectureGraph, snapshot: Snapshot): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const check = (list: readonly Evidence[], owner: string) => {
    list.forEach((evidence, index) => {
      const issue = checkOne(snapshot, evidence, `${owner}.evidence[${index}]`);
      if (issue !== undefined) issues.push(issue);
    });
  };

  graph.nodes.forEach((node, index) => check(node.evidence, `nodes[${index}]`));
  graph.edges.forEach((edge, index) => check(edge.evidence, `edges[${index}]`));
  return issues;
}

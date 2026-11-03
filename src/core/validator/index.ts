import type { ZodError } from "zod";

import { ArchitectureGraphSchema, type ArchitectureGraph } from "../schema/graph";
import type { ValidationIssue } from "../schema/validation";
import type { Snapshot } from "../snapshot/snapshot";
import { checkEvidence } from "./evidence";
import { checkGraphIntegrity } from "./integrity";

export { checkEvidence } from "./evidence";
export { checkGraphIntegrity } from "./integrity";

/** Enough to repair a graph without flooding the model's context with a long error list. */
const MAX_SCHEMA_ISSUES = 25;

export type GraphValidation =
  | { ok: true; graph: ArchitectureGraph }
  | { ok: false; issues: ValidationIssue[] };

/** `["nodes", 2, "evidence", 0]` becomes `nodes[2].evidence[0]`. */
function formatPath(segments: readonly PropertyKey[]): string {
  return segments.reduce<string>((path, segment) => {
    if (typeof segment === "number") return `${path}[${segment}]`;
    return path === "" ? String(segment) : `${path}.${String(segment)}`;
  }, "");
}

function schemaIssues(error: ZodError): ValidationIssue[] {
  return error.issues.slice(0, MAX_SCHEMA_ISSUES).map((issue) => ({
    code: "schema",
    message: issue.message.slice(0, 500),
    path: formatPath(issue.path).slice(0, 200) || undefined,
  }));
}

/**
 * Runs every validation layer on a graph proposed by the model: schema first, since the later
 * layers need a well-formed graph, then integrity and evidence together so one round of feedback
 * reports everything that is wrong.
 */
export function validateGraph(input: unknown, snapshot: Snapshot): GraphValidation {
  const parsed = ArchitectureGraphSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: schemaIssues(parsed.error) };

  const issues = [...checkGraphIntegrity(parsed.data), ...checkEvidence(parsed.data, snapshot)];
  return issues.length === 0 ? { ok: true, graph: parsed.data } : { ok: false, issues };
}

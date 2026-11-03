import { z } from "zod";

export const VALIDATION_ISSUE_CODES = [
  "schema",
  "duplicate_node_id",
  "unknown_node",
  "self_loop",
  "duplicate_edge",
  "invalid_parent",
  "parent_cycle",
  "evidence_file_missing",
  "evidence_out_of_range",
] as const;

/**
 * A problem found while validating a submitted graph. Issues are returned to the model as the
 * `submit_graph` tool result so it can repair the graph, and they are recorded in the trace.
 *
 * `evidence_file_missing` and `evidence_out_of_range` come from the snapshot-based validator.
 * The other codes come from the schema and from `checkGraphIntegrity`.
 */
export const ValidationIssueSchema = z.strictObject({
  code: z.enum(VALIDATION_ISSUE_CODES),
  message: z.string().min(1).max(500),
  /** Where the problem is, for example `nodes[2].evidence[0]` or `edges[4]`. */
  path: z.string().max(200).optional(),
});

export type ValidationIssueCode = (typeof VALIDATION_ISSUE_CODES)[number];
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

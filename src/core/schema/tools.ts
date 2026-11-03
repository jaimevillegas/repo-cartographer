import { z } from "zod";

import { RepoPathSchema } from "./evidence";
import { ArchitectureGraphSchema } from "./graph";

export const TOOL_NAMES = ["list_tree", "read_file", "search_code", "submit_graph"] as const;

export const MAX_TREE_DEPTH = 6;
export const MAX_READ_LINES = 400;
export const MAX_SEARCH_RESULTS = 50;
export const MAX_SEARCH_QUERY_LENGTH = 200;

/** Why the agent makes this call. It is required on every tool and shown in the trace. */
const ReasonSchema = z.string().trim().min(1).max(300);

// None of the tools takes a repository: every run is pinned to one snapshot, so the model cannot
// be pointed at a different repository or commit.

export const ListTreeInputSchema = z.strictObject({
  reason: ReasonSchema,
  /** Directory to list. Omit it to list the repository root. */
  path: RepoPathSchema.optional(),
  depth: z.number().int().min(1).max(MAX_TREE_DEPTH).optional(),
});

export const ReadFileInputSchema = z
  .strictObject({
    reason: ReasonSchema,
    path: RepoPathSchema,
    /** Defaults to line 1. */
    startLine: z.number().int().min(1).optional(),
    /** Defaults to `startLine` plus the read limit. */
    endLine: z.number().int().min(1).optional(),
  })
  .refine(
    ({ startLine, endLine }) => startLine === undefined || endLine === undefined || endLine >= startLine,
    { message: "endLine must be greater than or equal to startLine", path: ["endLine"] },
  )
  .refine(
    ({ startLine, endLine }) =>
      startLine === undefined || endLine === undefined || endLine - startLine + 1 <= MAX_READ_LINES,
    { message: `A single read can span at most ${MAX_READ_LINES} lines`, path: ["endLine"] },
  );

/**
 * `query` is a literal string, not a regular expression. Running a pattern chosen by the model over
 * untrusted repository content would expose the server to catastrophic backtracking.
 */
export const SearchCodeInputSchema = z.strictObject({
  reason: ReasonSchema,
  query: z.string().min(1).max(MAX_SEARCH_QUERY_LENGTH),
  /** Restrict the search to a directory or a single file. */
  path: RepoPathSchema.optional(),
  caseSensitive: z.boolean().optional(),
  maxResults: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional(),
});

/** The terminal tool: calling it ends the exploration and submits the graph for validation. */
export const SubmitGraphInputSchema = z.strictObject({
  reason: ReasonSchema,
  graph: ArchitectureGraphSchema,
});

export const TOOL_INPUT_SCHEMAS = {
  list_tree: ListTreeInputSchema,
  read_file: ReadFileInputSchema,
  search_code: SearchCodeInputSchema,
  submit_graph: SubmitGraphInputSchema,
} as const;

export type ToolName = (typeof TOOL_NAMES)[number];
export type ToolInput<Name extends ToolName> = z.infer<(typeof TOOL_INPUT_SCHEMAS)[Name]>;

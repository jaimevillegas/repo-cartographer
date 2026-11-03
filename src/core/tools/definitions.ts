import { z } from "zod";

import type { ToolDefinition } from "../providers/types";
import { MAX_READ_LINES, MAX_SEARCH_RESULTS, TOOL_INPUT_SCHEMAS, type ToolName } from "../schema/tools";
import { MAX_EDGES, MAX_NODES } from "../schema/graph";

const DESCRIPTIONS: Record<ToolName, string> = {
  list_tree:
    "List the files and directories under a path of the repository, a few levels deep. Start with the root to see the layout, then list the directories that look like components.",
  read_file: `Read a file with numbered lines, at most ${MAX_READ_LINES} per call. Use startLine and endLine to read a range. The line numbers shown are the ones to cite as evidence.`,
  search_code: `Find lines that contain a literal string (not a pattern), at most ${MAX_SEARCH_RESULTS} results. Use it to locate where something is used, such as a package, an environment variable or a URL.`,
  submit_graph: `Submit the final architecture graph, with at most ${MAX_NODES} nodes and ${MAX_EDGES} edges. Every node and edge needs evidence: a file path and line range you have read. If the graph is invalid, the problems come back as the result and you can submit a corrected one.`,
};

/** Removes noise that JSON Schema generation adds but a model does not need. */
function clean(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(clean);
  if (typeof schema !== "object" || schema === null) return schema;
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key, value]) => key !== "$schema" && !(key === "maximum" && value === Number.MAX_SAFE_INTEGER))
      .map(([key, value]) => [key, clean(value)]),
  );
}

export function toolDefinition(name: ToolName): ToolDefinition {
  const schema = z.toJSONSchema(TOOL_INPUT_SCHEMAS[name], { io: "input" });
  return { name, description: DESCRIPTIONS[name], inputSchema: clean(schema) as Record<string, unknown> };
}

/** Definitions in a fixed order, so the request prefix stays stable across steps. */
export function toolDefinitions(names: readonly ToolName[]): ToolDefinition[] {
  return names.map(toolDefinition);
}

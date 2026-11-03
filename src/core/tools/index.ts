import type { ToolName } from "../schema/tools";
import type { Snapshot } from "../snapshot/snapshot";
import { listTree } from "./list-tree";
import { readFile } from "./read-file";
import { searchCode } from "./search-code";
import { fail, type ToolOutcome } from "./types";

export type { ToolOutcome } from "./types";

/** Tools that read the snapshot. `submit_graph` is handled by the agent loop, not here. */
export const SNAPSHOT_TOOLS = {
  list_tree: listTree,
  read_file: readFile,
  search_code: searchCode,
} as const;

export type SnapshotToolName = keyof typeof SNAPSHOT_TOOLS;

export const isSnapshotTool = (name: string): name is SnapshotToolName =>
  Object.hasOwn(SNAPSHOT_TOOLS, name);

/**
 * Runs one tool call against the snapshot. The input comes from the model, so it is validated
 * here; a bad call produces a failed outcome the model can read, never an exception.
 */
export function runSnapshotTool(snapshot: Snapshot, name: ToolName | string, input: unknown): ToolOutcome {
  if (!isSnapshotTool(name)) return fail(`"${name}" is not a tool that reads the repository.`);
  return SNAPSHOT_TOOLS[name](snapshot, input);
}

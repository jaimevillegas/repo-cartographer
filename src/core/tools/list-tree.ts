import { ListTreeInputSchema } from "../schema/tools";
import type { Snapshot } from "../snapshot/snapshot";
import { describeInputError, fail, formatBytes, type ToolOutcome } from "./types";

export const DEFAULT_TREE_DEPTH = 2;
export const MAX_TREE_ENTRIES = 300;

/** Lists a directory of the snapshot, a few levels deep. */
export function listTree(snapshot: Snapshot, rawInput: unknown): ToolOutcome {
  const parsed = ListTreeInputSchema.safeParse(rawInput);
  if (!parsed.success) return fail(describeInputError(parsed.error));
  const { path = "", depth = DEFAULT_TREE_DEPTH } = parsed.data;

  const entries = snapshot.list(path, depth);
  if (entries === undefined) {
    return fail(
      snapshot.file(path) === undefined
        ? `"${path}" does not exist in this repository.`
        : `"${path}" is a file, not a directory. Use read_file to read it.`,
    );
  }

  const shown = entries.slice(0, MAX_TREE_ENTRIES);
  const lines = shown.map((entry) =>
    entry.type === "dir" ? `${entry.path}/` : `${entry.path} (${formatBytes(entry.size ?? 0)})`,
  );
  const hidden = entries.length - shown.length;
  if (hidden > 0) {
    lines.push(`… ${hidden} more entries not shown. List a subdirectory or use a smaller depth.`);
  }

  const where = path === "" ? "the repository root" : `${path}/`;
  return {
    ok: true,
    content: lines.length > 0 ? lines.join("\n") : "(empty directory)",
    summary: `Listed ${where}: ${entries.length} entries${hidden > 0 ? ` (${shown.length} shown)` : ""}`,
  };
}

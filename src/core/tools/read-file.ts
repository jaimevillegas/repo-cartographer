import { MAX_READ_LINES, ReadFileInputSchema } from "../schema/tools";
import type { Snapshot } from "../snapshot/snapshot";
import { describeInputError, fail, formatBytes, truncate, type ToolOutcome } from "./types";

const MAX_LINE_CHARS = 500;

/** Reads a range of lines from a text file, numbered, so the agent can cite exact lines. */
export function readFile(snapshot: Snapshot, rawInput: unknown): ToolOutcome {
  const parsed = ReadFileInputSchema.safeParse(rawInput);
  if (!parsed.success) return fail(describeInputError(parsed.error));
  const { path, startLine = 1, endLine } = parsed.data;

  const file = snapshot.file(path);
  if (file === undefined) {
    return fail(
      snapshot.isDirectory(path)
        ? `"${path}" is a directory. Use list_tree to see its contents.`
        : `"${path}" does not exist in this repository.`,
    );
  }
  if (file.omitted === "binary") return fail(`"${path}" is a binary file (${formatBytes(file.size)}) and cannot be read.`);
  if (file.omitted === "too_large") {
    return fail(`"${path}" is too large to read (${formatBytes(file.size)}). Use search_code to find the relevant lines.`);
  }

  const lines = snapshot.lines(path) ?? [];
  if (lines.length === 0) return { ok: true, content: "(empty file)", summary: `Read ${path}: empty file` };
  if (startLine > lines.length) {
    return fail(`"${path}" has ${lines.length} lines, so line ${startLine} does not exist.`);
  }

  const last = Math.min(endLine ?? startLine + MAX_READ_LINES - 1, lines.length);
  const width = String(last).length;
  const numbered = lines
    .slice(startLine - 1, last)
    .map((line, index) => `${String(startLine + index).padStart(width)} | ${truncate(line, MAX_LINE_CHARS)}`);

  const header = `${path}, lines ${startLine}-${last} of ${lines.length}`;
  const footer = last < lines.length ? `\n… ${lines.length - last} more lines. Call read_file again with startLine=${last + 1}.` : "";
  return {
    ok: true,
    content: `${header}\n${numbered.join("\n")}${footer}`,
    summary: `Read ${path} lines ${startLine}-${last} of ${lines.length}`,
  };
}

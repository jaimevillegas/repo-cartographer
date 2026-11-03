import { SearchCodeInputSchema } from "../schema/tools";
import type { Snapshot } from "../snapshot/snapshot";
import { describeInputError, fail, truncate, type ToolOutcome } from "./types";

export const DEFAULT_SEARCH_RESULTS = 20;
const MAX_MATCH_CHARS = 200;

/**
 * Finds lines containing a literal string. The query is never interpreted as a pattern, so a
 * hostile or careless query cannot make the search run for long on untrusted content.
 */
export function searchCode(snapshot: Snapshot, rawInput: unknown): ToolOutcome {
  const parsed = SearchCodeInputSchema.safeParse(rawInput);
  if (!parsed.success) return fail(describeInputError(parsed.error));
  const { query, path = "", caseSensitive = false, maxResults = DEFAULT_SEARCH_RESULTS } = parsed.data;

  const isFile = snapshot.file(path) !== undefined;
  if (path !== "" && !isFile && !snapshot.isDirectory(path)) {
    return fail(`"${path}" does not exist in this repository.`);
  }

  const needle = caseSensitive ? query : query.toLowerCase();
  const prefix = path === "" ? "" : `${path}/`;
  const matches: string[] = [];
  let more = false;
  let filesWithMatches = 0;

  search: for (const file of snapshot.files()) {
    if (file.text === null) continue;
    if (isFile ? file.path !== path : !file.path.startsWith(prefix)) continue;

    const lines = snapshot.lines(file.path) ?? [];
    let matched = false;
    for (let index = 0; index < lines.length; index++) {
      const haystack = caseSensitive ? lines[index] : lines[index].toLowerCase();
      if (!haystack.includes(needle)) continue;
      if (matches.length === maxResults) {
        more = true;
        break search;
      }
      matches.push(`${file.path}:${index + 1}: ${truncate(lines[index].trim(), MAX_MATCH_CHARS)}`);
      matched = true;
    }
    if (matched) filesWithMatches++;
  }

  const scope = path === "" ? "the repository" : path;
  if (matches.length === 0) {
    return { ok: true, content: `No matches for "${query}" in ${scope}.`, summary: `No matches for "${query}"` };
  }

  const note = more ? `\n… more matches exist. Narrow the query or search a subdirectory.` : "";
  return {
    ok: true,
    content: `${matches.join("\n")}${note}`,
    summary: `${matches.length}${more ? "+" : ""} matches for "${truncate(query, 60)}" in ${filesWithMatches} file${filesWithMatches === 1 ? "" : "s"}`,
  };
}

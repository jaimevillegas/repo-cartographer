import { describe, expect, it } from "vitest";

import { MAX_SEARCH_RESULTS } from "../schema/tools";
import { SnapshotBuilder } from "../snapshot/snapshot";
import { snapshotFromTexts, testRef } from "../snapshot/testing";
import { DEFAULT_SEARCH_RESULTS, searchCode } from "./search-code";

const reason = "Find the database client";

const snapshot = snapshotFromTexts({
  "src/db.ts": 'import { Pool } from "pg";\nexport const pool = new Pool();\n',
  "src/api/users.ts": "const rows = await pool.query(SQL);\n  // Uses POOL for reads\n",
  "docs/notes.md": "The pool is configured in src/db.ts\n",
  "README.md": "nothing here\n",
});

const lines = (outcome: ReturnType<typeof searchCode>) => {
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.content.split("\n");
};

describe("searchCode", () => {
  it("finds lines containing the query, case-insensitively by default", () => {
    expect(lines(searchCode(snapshot, { reason, query: "pool" }))).toEqual([
      "docs/notes.md:1: The pool is configured in src/db.ts",
      "src/api/users.ts:1: const rows = await pool.query(SQL);",
      "src/api/users.ts:2: // Uses POOL for reads",
      'src/db.ts:1: import { Pool } from "pg";',
      "src/db.ts:2: export const pool = new Pool();",
    ]);
  });

  it("can be case sensitive", () => {
    expect(lines(searchCode(snapshot, { reason, query: "Pool", caseSensitive: true }))).toEqual([
      'src/db.ts:1: import { Pool } from "pg";',
      "src/db.ts:2: export const pool = new Pool();",
    ]);
  });

  it("treats the query literally, so pattern characters match themselves", () => {
    expect(lines(searchCode(snapshot, { reason, query: "pool.query(" }))).toEqual([
      "src/api/users.ts:1: const rows = await pool.query(SQL);",
    ]);
    expect(searchCode(snapshot, { reason, query: ".*" })).toMatchObject({
      ok: true,
      summary: 'No matches for ".*"',
    });
    expect(searchCode(snapshot, { reason, query: "(a+)+$" })).toMatchObject({ ok: true });
  });

  it("stays fast on input built to defeat regular expressions", () => {
    const hostile = snapshotFromTexts({ "evil.txt": `${"a".repeat(50_000)}!` });
    const start = performance.now();
    searchCode(hostile, { reason, query: "(a+)+$" });
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("restricts the search to a directory or a single file", () => {
    expect(lines(searchCode(snapshot, { reason, query: "pool", path: "src/api" }))).toHaveLength(2);
    expect(lines(searchCode(snapshot, { reason, query: "pool", path: "src/db.ts" }))).toHaveLength(2);
    expect(searchCode(snapshot, { reason, query: "pool", path: "src/db" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("does not exist"),
    });
  });

  it("does not let a directory name match as a string prefix", () => {
    const tricky = snapshotFromTexts({ "src/a.ts": "needle", "src-old/b.ts": "needle" });
    expect(lines(searchCode(tricky, { reason, query: "needle", path: "src" }))).toEqual(["src/a.ts:1: needle"]);
  });

  it("says plainly when nothing matches", () => {
    expect(searchCode(snapshot, { reason, query: "kafka" })).toEqual({
      ok: true,
      content: 'No matches for "kafka" in the repository.',
      summary: 'No matches for "kafka"',
    });
  });

  it("limits results and tells the model when more exist", () => {
    const many = snapshotFromTexts({ "log.txt": Array.from({ length: 100 }, () => "hit").join("\n") });
    const defaultOutcome = lines(searchCode(many, { reason, query: "hit" }));
    expect(defaultOutcome).toHaveLength(DEFAULT_SEARCH_RESULTS + 1);
    expect(defaultOutcome.at(-1)).toContain("more matches exist");

    const capped = lines(searchCode(many, { reason, query: "hit", maxResults: MAX_SEARCH_RESULTS }));
    expect(capped).toHaveLength(MAX_SEARCH_RESULTS + 1);

    const exact = lines(searchCode(snapshotFromTexts({ "a.txt": "hit\nhit" }), { reason, query: "hit", maxResults: 2 }));
    expect(exact).toHaveLength(2);
  });

  it("skips binary and oversized files", () => {
    const builder = new SnapshotBuilder();
    builder.add({ path: "logo.png", size: 10, text: null, omitted: "binary" });
    builder.add({ path: "a.txt", size: 3, text: "pool" });
    expect(lines(searchCode(builder.build(testRef), { reason, query: "pool" }))).toEqual(["a.txt:1: pool"]);
  });

  it("shortens long matching lines", () => {
    const wide = snapshotFromTexts({ "wide.txt": `needle ${"x".repeat(1000)}` });
    expect(lines(searchCode(wide, { reason, query: "needle" }))[0].length).toBeLessThan(230);
  });

  it("reports invalid arguments instead of throwing", () => {
    expect(searchCode(snapshot, { reason, query: "" })).toMatchObject({ ok: false });
    expect(searchCode(snapshot, { reason, pattern: "a.*b" })).toMatchObject({ ok: false });
    expect(searchCode(snapshot, { reason, query: "x", maxResults: 51 })).toMatchObject({ ok: false });
  });
});

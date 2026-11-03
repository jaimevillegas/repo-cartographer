import { describe, expect, it } from "vitest";

import { snapshotFromTexts } from "../snapshot/testing";
import { listTree, MAX_TREE_ENTRIES } from "./list-tree";

const reason = "Look around";
const snapshot = snapshotFromTexts({
  "package.json": "{}",
  "src/index.ts": "x",
  "src/lib/db.ts": "x",
  "src/lib/deep/cache.ts": "x",
  "docs/guide.md": "x",
});

const content = (outcome: ReturnType<typeof listTree>) => {
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.content.split("\n");
};

describe("listTree", () => {
  it("lists the root two levels deep by default", () => {
    expect(content(listTree(snapshot, { reason }))).toEqual([
      "docs/",
      "docs/guide.md (1 B)",
      "src/",
      "src/lib/",
      "src/index.ts (1 B)",
      "package.json (2 B)",
    ]);
  });

  it("lists a subdirectory to the requested depth", () => {
    expect(content(listTree(snapshot, { reason, path: "src", depth: 3 }))).toEqual([
      "src/lib/",
      "src/lib/deep/",
      "src/lib/deep/cache.ts (1 B)",
      "src/lib/db.ts (1 B)",
      "src/index.ts (1 B)",
    ]);
  });

  it("explains a missing path and a file path", () => {
    expect(listTree(snapshot, { reason, path: "nope" })).toEqual({
      ok: false,
      error: '"nope" does not exist in this repository.',
    });
    expect(listTree(snapshot, { reason, path: "package.json" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("is a file"),
    });
  });

  it("reports invalid arguments instead of throwing", () => {
    expect(listTree(snapshot, { reason, depth: 99 })).toMatchObject({
      ok: false,
      error: expect.stringContaining("Invalid arguments: depth"),
    });
    expect(listTree(snapshot, { reason, path: "../.." })).toMatchObject({ ok: false });
    expect(listTree(snapshot, { path: "src" })).toMatchObject({ ok: false });
  });

  it("caps very long listings and says how to narrow them", () => {
    const files = Object.fromEntries(Array.from({ length: MAX_TREE_ENTRIES + 25 }, (_, i) => [`f${i}.txt`, "x"]));
    const outcome = listTree(snapshotFromTexts(files), { reason });
    if (!outcome.ok) throw new Error(outcome.error);
    const lines = outcome.content.split("\n");
    expect(lines).toHaveLength(MAX_TREE_ENTRIES + 1);
    expect(lines.at(-1)).toContain("25 more entries");
    expect(outcome.summary).toContain(`${MAX_TREE_ENTRIES} shown`);
  });

  it("describes an empty repository", () => {
    expect(listTree(snapshotFromTexts({}), { reason })).toMatchObject({ ok: true, content: "(empty directory)" });
  });
});

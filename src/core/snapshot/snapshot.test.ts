import { describe, expect, it } from "vitest";

import { Snapshot, SnapshotBuilder, splitLines } from "./snapshot";
import { snapshotFromTexts, testRef } from "./testing";

const sample = snapshotFromTexts({
  "package.json": "{}",
  "README.md": "# shop\n",
  "src/index.ts": "a\nb\nc\n",
  "src/lib/db.ts": "export {};\n",
  "src/lib/cache.ts": "export {};\n",
  "docs/guide.md": "hello",
});

describe("splitLines", () => {
  it("does not count a trailing newline as a line", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
  });

  it("handles CRLF and an empty file, and keeps blank lines in the middle", () => {
    expect(splitLines("a\r\nb\r\n")).toEqual(["a", "b"]);
    expect(splitLines("")).toEqual([]);
    expect(splitLines("a\n\nb")).toEqual(["a", "", "b"]);
  });
});

describe("Snapshot", () => {
  it("exposes files, directories and the pinned ref", () => {
    expect(sample.ref).toEqual(testRef);
    expect(sample.fileCount).toBe(6);
    expect(sample.file("src/index.ts")?.text).toBe("a\nb\nc\n");
    expect(sample.file("src")).toBeUndefined();
    expect(sample.isDirectory("src/lib")).toBe(true);
    expect(sample.isDirectory("src/index.ts")).toBe(false);
    expect(sample.isDirectory("")).toBe(true);
  });

  it("returns lines for text files and nothing otherwise", () => {
    expect(sample.lines("src/index.ts")).toEqual(["a", "b", "c"]);
    expect(sample.lines("missing.ts")).toBeUndefined();
  });

  it("lists the root one level deep, directories first, in alphabetical order", () => {
    expect(sample.list()).toEqual([
      { path: "docs", type: "dir" },
      { path: "src", type: "dir" },
      { path: "README.md", type: "file", size: 7 },
      { path: "package.json", type: "file", size: 2 },
    ]);
  });

  it("lists deeper levels depth first", () => {
    expect(sample.list("src", 2)?.map((entry) => entry.path)).toEqual([
      "src/lib",
      "src/lib/cache.ts",
      "src/lib/db.ts",
      "src/index.ts",
    ]);
  });

  it("stops at the requested depth", () => {
    expect(sample.list("", 1)?.map((entry) => entry.path)).not.toContain("src/index.ts");
    expect(sample.list("", 2)?.map((entry) => entry.path)).toContain("src/index.ts");
    expect(sample.list("", 2)?.map((entry) => entry.path)).not.toContain("src/lib/db.ts");
  });

  it("returns undefined when listing something that is not a directory", () => {
    expect(sample.list("nope")).toBeUndefined();
    expect(sample.list("package.json")).toBeUndefined();
  });

  it("keeps files without content listed", () => {
    const builder = new SnapshotBuilder();
    builder.add({ path: "logo.png", size: 900, text: null, omitted: "binary" });
    builder.add({ path: "dump.sql", size: 9_000_000, text: null, omitted: "too_large" });
    const snapshot: Snapshot = builder.build(testRef);
    expect(snapshot.fileCount).toBe(2);
    expect(snapshot.lines("logo.png")).toBeUndefined();
    expect(snapshot.list()?.map((entry) => entry.path)).toEqual(["dump.sql", "logo.png"]);
  });
});

describe("SnapshotBuilder", () => {
  const file = (path: string) => ({ path, size: 1, text: "x" });

  it("keeps the first file seen for a path", () => {
    const builder = new SnapshotBuilder();
    expect(builder.add({ path: "a.ts", size: 1, text: "first" })).toBe(true);
    expect(builder.add({ path: "a.ts", size: 1, text: "second" })).toBe(false);
    expect(builder.build(testRef).file("a.ts")?.text).toBe("first");
  });

  it("drops a file that would sit below an existing file", () => {
    const builder = new SnapshotBuilder();
    builder.add(file("a"));
    expect(builder.add(file("a/b.ts"))).toBe(false);
    expect(builder.build(testRef).fileCount).toBe(1);
  });

  it("drops a file whose path is already a directory", () => {
    const builder = new SnapshotBuilder();
    builder.add(file("a/b.ts"));
    expect(builder.add(file("a"))).toBe(false);
    expect(builder.build(testRef).isDirectory("a")).toBe(true);
  });
});

import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { DEFAULT_EXTRACT_LIMITS, extractSnapshot, type ExtractLimits } from "./extract";
import { chunked, makeTar, testRef, type TarFixtureEntry } from "./testing";

const ROOT = "acme-shop-0123456";

const archiveOf = (entries: TarFixtureEntry[], root = ROOT) =>
  gzipSync(
    makeTar([
      { path: `${root}/`, type: "directory" },
      ...entries.map((entry) => ({ ...entry, path: `${root}/${entry.path}` })),
    ]),
  );

const extract = (entries: TarFixtureEntry[], limits: Partial<ExtractLimits> = {}) =>
  extractSnapshot(testRef, chunked(archiveOf(entries), 1000), { ...DEFAULT_EXTRACT_LIMITS, ...limits });

describe("extractSnapshot", () => {
  it("builds a snapshot without the top-level directory", async () => {
    const { snapshot, skipped } = await extract([
      { path: "package.json", content: '{"name":"shop"}' },
      { path: "src/index.ts", content: "export {};\n" },
    ]);
    expect(snapshot.ref).toEqual(testRef);
    expect(snapshot.files().map((file) => file.path)).toEqual(["package.json", "src/index.ts"]);
    expect(snapshot.file("src/index.ts")?.text).toBe("export {};\n");
    expect(skipped).toBe(0);
  });

  it("ignores symlinks and hard links instead of following them", async () => {
    const { snapshot, skipped } = await extract([
      { path: "link", type: "symlink", linkname: "/etc/passwd" },
      { path: "hard", type: "hardlink", linkname: "a.txt" },
      { path: "a.txt", content: "a" },
    ]);
    expect(snapshot.files().map((file) => file.path)).toEqual(["a.txt"]);
    expect(skipped).toBe(2);
  });

  it("drops entries with unsafe paths", async () => {
    const { snapshot, skipped } = await extract([
      { path: "../escape.txt", content: "x" },
      { path: "a/../../escape.txt", content: "x" },
      { path: "/abs.txt", content: "x" },
      { path: "back\\slash.txt", content: "x" },
      { path: "new\nline.txt", content: "x" },
      { path: "ok.txt", content: "x" },
    ]);
    expect(snapshot.files().map((file) => file.path)).toEqual(["ok.txt"]);
    expect(skipped).toBe(5);
  });

  it("drops entries outside the repository's top-level directory", async () => {
    const data = gzipSync(
      makeTar([
        { path: `${ROOT}/a.txt`, content: "a" },
        { path: "other/b.txt", content: "b" },
        { path: "loose.txt", content: "c" },
      ]),
    );
    const { snapshot } = await extractSnapshot(testRef, chunked(data, 512));
    expect(snapshot.files().map((file) => file.path)).toEqual(["a.txt"]);
  });

  it("skips vendored node_modules", async () => {
    const { snapshot } = await extract([
      { path: "node_modules/left-pad/index.js", content: "x" },
      { path: "packages/app/node_modules/x/y.js", content: "x" },
      { path: "src/a.ts", content: "x" },
    ]);
    expect(snapshot.files().map((file) => file.path)).toEqual(["src/a.ts"]);
  });

  it("keeps binary and oversized files in the tree without their content", async () => {
    const { snapshot } = await extract(
      [
        { path: "logo.png", content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1, 2]) },
        { path: "latin1.txt", content: Buffer.from([0x63, 0x61, 0x66, 0xe9]) },
        { path: "dump.sql", content: "y".repeat(2000) },
        { path: "small.txt", content: "fine" },
      ],
      { maxTextFileBytes: 1000 },
    );
    expect(snapshot.file("logo.png")).toMatchObject({ text: null, omitted: "binary", size: 8 });
    expect(snapshot.file("latin1.txt")).toMatchObject({ text: null, omitted: "binary" });
    expect(snapshot.file("dump.sql")).toMatchObject({ text: null, omitted: "too_large", size: 2000 });
    expect(snapshot.file("small.txt")?.text).toBe("fine");
  });

  it("drops a duplicate path and a path that conflicts with a directory", async () => {
    const { snapshot, skipped } = await extract([
      { path: "a.txt", content: "first" },
      { path: "a.txt", content: "second" },
      { path: "dir/b.txt", content: "b" },
      { path: "dir", content: "clash" },
    ]);
    expect(snapshot.file("a.txt")?.text).toBe("first");
    expect(snapshot.isDirectory("dir")).toBe(true);
    expect(skipped).toBe(2);
  });

  describe("limits", () => {
    it("rejects a download over the archive cap", async () => {
      await expect(extract([{ path: "a.txt", content: "x".repeat(5000) }], { maxArchiveBytes: 100 })).rejects.toMatchObject({
        code: "repo_too_large",
      });
    });

    it("rejects an unpacked size over the cap, even when it compresses very well", async () => {
      const bomb = [{ path: "zeros.txt", content: "0".repeat(200_000) }];
      const compressed = archiveOf(bomb);
      expect(compressed.length).toBeLessThan(5000);
      await expect(
        extractSnapshot(testRef, chunked(compressed, 512), { ...DEFAULT_EXTRACT_LIMITS, maxUnpackedBytes: 100_000 }),
      ).rejects.toMatchObject({ code: "repo_too_large" });
    });

    it("rejects too many files", async () => {
      const files = Array.from({ length: 5 }, (_, i) => ({ path: `f${i}.txt`, content: "x" }));
      await expect(extract(files, { maxFiles: 4 })).rejects.toMatchObject({ code: "repo_too_large" });
    });
  });

  describe("bad input", () => {
    it("rejects data that is not gzip", async () => {
      await expect(extractSnapshot(testRef, chunked(Buffer.from("<html>not an archive</html>"), 8))).rejects.toMatchObject({
        code: "github_unavailable",
      });
    });

    it("rejects a truncated archive", async () => {
      const data = archiveOf([{ path: "a.txt", content: "x".repeat(3000) }]);
      await expect(extractSnapshot(testRef, chunked(data.subarray(0, data.length - 30), 256))).rejects.toMatchObject({
        code: "github_unavailable",
      });
    });

    it("propagates an error from the download stream", async () => {
      async function* failing() {
        yield gzipSync(makeTar([])).subarray(0, 4);
        throw new Error("connection reset");
      }
      await expect(extractSnapshot(testRef, failing())).rejects.toMatchObject({ code: "github_unavailable" });
    });

    it("returns an empty snapshot for an empty archive", async () => {
      const { snapshot } = await extractSnapshot(testRef, chunked(gzipSync(makeTar([])), 64));
      expect(snapshot.fileCount).toBe(0);
    });
  });
});

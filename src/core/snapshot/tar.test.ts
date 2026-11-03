import { describe, expect, it } from "vitest";

import { SnapshotError } from "./errors";
import { readTar, type TarEntry } from "./tar";
import { chunked, makeTar, paxBlocks } from "./testing";

const options = { maxBodyBytes: 1024, maxEntries: 100 };

async function collect(data: Uint8Array, chunkSize = 4096, overrides = {}): Promise<TarEntry[]> {
  const entries: TarEntry[] = [];
  for await (const entry of readTar(chunked(data, chunkSize), { ...options, ...overrides })) entries.push(entry);
  return entries;
}

const text = (entry: TarEntry) => entry.body?.toString("utf8");

describe("readTar", () => {
  it("reads regular files and directories", async () => {
    const entries = await collect(
      makeTar([
        { path: "src/", type: "directory" },
        { path: "src/a.ts", content: "hello" },
        { path: "empty.txt", content: "" },
      ]),
    );
    expect(entries.map((entry) => [entry.path, entry.type, entry.size])).toEqual([
      ["src/", "directory", 0],
      ["src/a.ts", "file", 5],
      ["empty.txt", "file", 0],
    ]);
    expect(text(entries[1])).toBe("hello");
    expect(text(entries[2])).toBe("");
    expect(entries[0].body).toBeNull();
  });

  it.each([1, 7, 511, 512, 513])("gives the same result when the input arrives in %i-byte chunks", async (size) => {
    const entries = await collect(
      makeTar([
        { path: "a.txt", content: "x".repeat(700) },
        { path: "b.txt", content: "second" },
      ]),
      size,
    );
    expect(entries.map((entry) => entry.path)).toEqual(["a.txt", "b.txt"]);
    expect(text(entries[0])).toBe("x".repeat(700));
    expect(text(entries[1])).toBe("second");
  });

  it("reports links without data and does not read past them", async () => {
    const entries = await collect(
      makeTar([
        { path: "link", type: "symlink", linkname: "/etc/passwd" },
        { path: "hard", type: "hardlink", linkname: "a.txt" },
        { path: "a.txt", content: "after" },
      ]),
    );
    expect(entries.map((entry) => entry.type)).toEqual(["symlink", "hardlink", "file"]);
    expect(text(entries[2])).toBe("after");
  });

  it("skips the body of a file larger than maxBodyBytes and keeps reading", async () => {
    const entries = await collect(
      makeTar([
        { path: "big.bin", content: "y".repeat(3000) },
        { path: "small.txt", content: "ok" },
      ]),
    );
    expect(entries[0]).toMatchObject({ path: "big.bin", size: 3000, body: null });
    expect(text(entries[1])).toBe("ok");
  });

  it("uses pax headers for long paths and ignores the global header", async () => {
    const longPath = `${"d/".repeat(70)}file.ts`;
    const archive = Buffer.concat([
      paxBlocks({ comment: "a".repeat(40) }, "g"),
      makeTar([{ path: longPath, content: "deep" }]),
    ]);
    const entries = await collect(archive);
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe(longPath);
    expect(text(entries[0])).toBe("deep");
  });

  it("stops at the end-of-archive marker, ignoring anything after it", async () => {
    const archive = Buffer.concat([makeTar([{ path: "a.txt", content: "1" }]), makeTar([{ path: "b.txt" }])]);
    expect((await collect(archive)).map((entry) => entry.path)).toEqual(["a.txt"]);
  });

  it("accepts an archive without the end marker", async () => {
    const entries = await collect(makeTar([{ path: "a.txt", content: "1" }], { trailer: false }));
    expect(entries).toHaveLength(1);
  });

  it("rejects a header with a bad checksum", async () => {
    const archive = makeTar([{ path: "a.txt", content: "1" }]);
    archive[0] ^= 0xff;
    await expect(collect(archive)).rejects.toMatchObject({ code: "github_unavailable" });
  });

  it("rejects a truncated archive", async () => {
    const archive = makeTar([{ path: "a.txt", content: "x".repeat(600) }]);
    await expect(collect(archive.subarray(0, 700))).rejects.toBeInstanceOf(SnapshotError);
  });

  it("rejects an archive with too many entries", async () => {
    const files = Array.from({ length: 6 }, (_, i) => ({ path: `f${i}.txt` }));
    await expect(collect(makeTar(files), 4096, { maxEntries: 5 })).rejects.toMatchObject({
      code: "repo_too_large",
    });
  });
});

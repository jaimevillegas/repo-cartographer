import type { RepoRef } from "../schema/repo";
import { Snapshot, SnapshotBuilder } from "./snapshot";

export const testRef: RepoRef = { owner: "acme", repo: "shop", sha: "0123456789abcdef0123456789abcdef01234567" };

/** Builds a snapshot from `{ path: text }`. For tests of anything that reads a snapshot. */
export function snapshotFromTexts(files: Record<string, string>, ref: RepoRef = testRef): Snapshot {
  const builder = new SnapshotBuilder();
  for (const [path, text] of Object.entries(files)) {
    builder.add({ path, size: Buffer.byteLength(text), text });
  }
  return builder.build(ref);
}

export type TarFixtureEntry = {
  path: string;
  /** Defaults to a regular file. */
  type?: "file" | "directory" | "symlink" | "hardlink";
  content?: string | Uint8Array;
  linkname?: string;
};

const TYPE_FLAGS = { file: "0", directory: "5", symlink: "2", hardlink: "1" } as const;

function writeField(block: Buffer, offset: number, length: number, value: string) {
  block.write(value.slice(0, length), offset, "utf8");
}

function headerBlock(name: string, size: number, flag: string, linkname = ""): Buffer {
  const block = Buffer.alloc(512);
  writeField(block, 0, 100, name);
  writeField(block, 100, 8, "0000644\0");
  writeField(block, 108, 16, "0000000\x0000000000\x00");
  writeField(block, 124, 12, `${size.toString(8).padStart(11, "0")}\0`);
  writeField(block, 136, 12, "00000000000\0");
  block.fill(0x20, 148, 156);
  writeField(block, 156, 1, flag);
  writeField(block, 157, 100, linkname);
  writeField(block, 257, 8, "ustar\x0000");
  let sum = 0;
  for (const byte of block) sum += byte;
  writeField(block, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
  return block;
}

const pad = (data: Buffer) => Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]);

/** A pax extended header (`x`) or global header (`g`) carrying the given records. */
export function paxBlocks(records: Record<string, string>, flag: "x" | "g" = "x"): Buffer {
  const body = Buffer.concat(
    Object.entries(records).map(([key, value]) => {
      const rest = ` ${key}=${value}\n`;
      let length = Buffer.byteLength(rest) + 1;
      while (String(length).length + Buffer.byteLength(rest) !== length) {
        length = String(length).length + Buffer.byteLength(rest);
      }
      return Buffer.from(`${length}${rest}`);
    }),
  );
  return Buffer.concat([headerBlock("pax_header", body.length, flag), pad(body)]);
}

/**
 * Builds an uncompressed tar archive. Paths longer than 100 bytes go in a pax header, the way
 * `git archive` (and so GitHub) writes them.
 */
export function makeTar(entries: TarFixtureEntry[], options: { trailer?: boolean } = {}): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const type = entry.type ?? "file";
    const content = Buffer.from(entry.content ?? "");
    const data = type === "file" ? content : Buffer.alloc(0);
    let name = entry.path;
    if (Buffer.byteLength(name) > 100) {
      parts.push(paxBlocks({ path: name }));
      name = name.slice(0, 100);
    }
    parts.push(headerBlock(name, data.length, TYPE_FLAGS[type], entry.linkname), pad(data));
  }
  if (options.trailer !== false) parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

/** Splits bytes into small chunks, to exercise the parser's buffering. */
export async function* chunked(data: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < data.length; i += size) yield data.subarray(i, i + size);
}

import { SnapshotError } from "./errors";

const BLOCK = 512;
/** Extended headers are tiny in practice; anything bigger is refused instead of buffered. */
const MAX_METADATA_BYTES = 64 * 1024;

export type TarEntryType = "file" | "directory" | "symlink" | "hardlink" | "other";

export type TarEntry = {
  path: string;
  type: TarEntryType;
  size: number;
  /** The content of a regular file no larger than `maxBodyBytes`; `null` for everything else. */
  body: Buffer | null;
};

const corrupt = (detail: string) =>
  new SnapshotError("github_unavailable", `GitHub returned an unreadable archive (${detail}).`);

/** Buffers an async byte source so the parser can ask for exact byte counts. */
class ByteReader {
  private chunks: Buffer[] = [];
  private length = 0;
  private readonly iterator: AsyncIterator<Uint8Array>;

  constructor(source: AsyncIterable<Uint8Array>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  private async pull(): Promise<boolean> {
    const next = await this.iterator.next();
    if (next.done) return false;
    const { buffer, byteOffset, byteLength } = next.value;
    if (byteLength > 0) {
      this.chunks.push(Buffer.from(buffer, byteOffset, byteLength));
      this.length += byteLength;
    }
    return true;
  }

  private consume(count: number): Buffer {
    const first = this.chunks[0];
    let result: Buffer;
    if (first.length >= count) {
      result = first.subarray(0, count);
      if (first.length === count) this.chunks.shift();
      else this.chunks[0] = first.subarray(count);
    } else {
      const parts: Buffer[] = [];
      let missing = count;
      while (missing > 0) {
        const chunk = this.chunks[0];
        if (chunk.length <= missing) {
          parts.push(chunk);
          this.chunks.shift();
          missing -= chunk.length;
        } else {
          parts.push(chunk.subarray(0, missing));
          this.chunks[0] = chunk.subarray(missing);
          missing = 0;
        }
      }
      result = Buffer.concat(parts);
    }
    this.length -= count;
    return result;
  }

  /** Reads exactly `count` bytes. Returns `null` only at a clean end of input. */
  async read(count: number): Promise<Buffer | null> {
    if (count === 0) return Buffer.alloc(0);
    while (this.length < count) {
      if (!(await this.pull())) {
        if (this.length === 0) return null;
        throw corrupt("truncated");
      }
    }
    return this.consume(count);
  }

  /** Discards `count` bytes without keeping them. */
  async skip(count: number): Promise<void> {
    let remaining = count;
    while (remaining > 0) {
      if (this.length === 0 && !(await this.pull())) throw corrupt("truncated");
      const take = Math.min(remaining, this.length);
      this.consume(take);
      remaining -= take;
    }
  }

  async close(): Promise<void> {
    await this.iterator.return?.();
  }
}

const isZeroBlock = (block: Buffer) => block.every((byte) => byte === 0);

function readString(block: Buffer, start: number, length: number): string {
  const slice = block.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? length : end).toString("utf8");
}

function readOctal(block: Buffer, start: number, length: number): number {
  if (block[start] & 0x80) throw corrupt("unsupported binary size field");
  const text = readString(block, start, length).trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) throw corrupt("invalid number in header");
  return parseInt(text, 8);
}

function verifyChecksum(block: Buffer): void {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i];
  if (sum !== readOctal(block, 148, 8)) throw corrupt("bad header checksum");
}

function entryType(flag: string): TarEntryType {
  switch (flag) {
    case "0":
    case "\0":
    case "7":
      return "file";
    case "5":
      return "directory";
    case "2":
      return "symlink";
    case "1":
      return "hardlink";
    default:
      return "other";
  }
}

/** Parses the `"<length> <key>=<value>\n"` records of a pax extended header. */
function parsePax(body: Buffer): Map<string, string> {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < body.length) {
    const space = body.indexOf(0x20, offset);
    if (space === -1) throw corrupt("bad extended header");
    const length = Number(body.toString("ascii", offset, space));
    if (!Number.isInteger(length) || length <= space - offset + 1 || offset + length > body.length) {
      throw corrupt("bad extended header");
    }
    const record = body.toString("utf8", space + 1, offset + length - 1);
    const equals = record.indexOf("=");
    if (equals === -1) throw corrupt("bad extended header");
    records.set(record.slice(0, equals), record.slice(equals + 1));
    offset += length;
  }
  return records;
}

export type ReadTarOptions = {
  /** Largest regular-file body to buffer. Larger entries are skipped and reported with `body: null`. */
  maxBodyBytes: number;
  /** Upper bound on headers read, so an archive of empty entries cannot keep the parser busy. */
  maxEntries: number;
};

/**
 * Streams the entries of an uncompressed tar archive. Handles ustar, pax (which GitHub uses for
 * long paths and its global header) and GNU long names. The archive is untrusted: sizes and counts
 * are bounded, headers are checksummed, and nothing is written to disk.
 */
export async function* readTar(
  source: AsyncIterable<Uint8Array>,
  { maxBodyBytes, maxEntries }: ReadTarOptions,
): AsyncGenerator<TarEntry> {
  const reader = new ByteReader(source);
  try {
    let pendingPath: string | undefined;
    let pendingSize: number | undefined;
    let entries = 0;

    for (;;) {
      const header = await reader.read(BLOCK);
      if (header === null || isZeroBlock(header)) return;
      if (++entries > maxEntries) throw new SnapshotError("repo_too_large", "The repository has too many files.");
      verifyChecksum(header);

      const flag = String.fromCharCode(header[156]);
      let size = readOctal(header, 124, 12);
      const padding = (BLOCK - (size % BLOCK)) % BLOCK;

      if (flag === "x" || flag === "g" || flag === "L") {
        if (size > MAX_METADATA_BYTES) throw corrupt("oversized metadata entry");
        const body = await reader.read(size + padding);
        if (body === null) throw corrupt("truncated");
        const content = body.subarray(0, size);
        if (flag === "x") {
          const records = parsePax(content);
          pendingPath = records.get("path") ?? pendingPath;
          const paxSize = records.get("size");
          if (paxSize !== undefined) {
            if (!/^\d{1,15}$/.test(paxSize)) throw corrupt("bad extended size");
            pendingSize = Number(paxSize);
          }
        } else if (flag === "L") {
          pendingPath = readString(content, 0, content.length);
        }
        continue;
      }

      let path = readString(header, 0, 100);
      if (readString(header, 257, 6) === "ustar") {
        const prefix = readString(header, 345, 155);
        if (prefix !== "") path = `${prefix}/${path}`;
      }
      if (pendingPath !== undefined) path = pendingPath;
      if (pendingSize !== undefined) size = pendingSize;
      pendingPath = undefined;
      pendingSize = undefined;

      const type = entryType(flag);
      const padded = size + ((BLOCK - (size % BLOCK)) % BLOCK);
      // Links and directories have no data blocks, whatever their size field says.
      const hasData = type === "file" || type === "other";

      if (type === "file" && size <= maxBodyBytes) {
        const body = await reader.read(padded);
        if (body === null) throw corrupt("truncated");
        yield { path, type, size, body: body.subarray(0, size) };
      } else {
        yield { path, type, size, body: null };
        if (hasData) await reader.skip(padded);
      }
    }
  } finally {
    await reader.close();
  }
}

import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

import { RepoPathSchema } from "../schema/evidence";
import type { RepoRef } from "../schema/repo";
import { SnapshotError } from "./errors";
import { Snapshot, SnapshotBuilder, type SnapshotFile } from "./snapshot";
import { readTar } from "./tar";

export type ExtractLimits = {
  /** Compressed bytes accepted from the network. */
  maxArchiveBytes: number;
  /** Total size of all files once unpacked. Guards against decompression bombs. */
  maxUnpackedBytes: number;
  maxFiles: number;
  /** Files larger than this stay in the tree but their content is not kept. */
  maxTextFileBytes: number;
};

export const DEFAULT_EXTRACT_LIMITS: ExtractLimits = {
  maxArchiveBytes: 100 * 1024 * 1024,
  maxUnpackedBytes: 150 * 1024 * 1024,
  maxFiles: 50_000,
  maxTextFileBytes: 1024 * 1024,
};

export type ExtractResult = {
  snapshot: Snapshot;
  /** Entries that were left out: links, unsafe paths, vendored dependencies and path conflicts. */
  skipped: number;
};

const tooLarge = (what: string) => new SnapshotError("repo_too_large", `The repository is too large (${what}).`);

async function* capBytes(source: AsyncIterable<Uint8Array>, max: number): AsyncGenerator<Uint8Array> {
  let total = 0;
  for await (const chunk of source) {
    total += chunk.byteLength;
    if (total > max) throw tooLarge("archive size");
    yield chunk;
  }
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const BINARY_SNIFF_BYTES = 8000;
const utf8 = new TextDecoder("utf-8", { fatal: true });

/** Text content of a file, or `null` when it looks binary. */
function decodeText(body: Buffer): string | null {
  if (body.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return null;
  try {
    return utf8.decode(body);
  } catch {
    return null;
  }
}

/**
 * Turns a GitHub tarball (gzip-compressed tar) into a snapshot. Everything in the archive is
 * untrusted: paths are validated, links and directories are ignored, and the compressed size, the
 * unpacked size and the number of files are all capped. Nothing is written to disk.
 */
export async function extractSnapshot(
  ref: RepoRef,
  archive: AsyncIterable<Uint8Array>,
  limits: ExtractLimits = DEFAULT_EXTRACT_LIMITS,
): Promise<ExtractResult> {
  const builder = new SnapshotBuilder();
  let skipped = 0;

  try {
    await pipeline(capBytes(archive, limits.maxArchiveBytes), createGunzip(), async (tar: AsyncIterable<Uint8Array>) => {
      let root: string | undefined;
      let unpacked = 0;
      let files = 0;

      const entries = readTar(tar, { maxBodyBytes: limits.maxTextFileBytes, maxEntries: limits.maxFiles * 2 });
      for await (const entry of entries) {
        const slash = entry.path.indexOf("/");
        const top = slash === -1 ? entry.path : entry.path.slice(0, slash);
        root ??= top;

        // GitHub wraps everything in one top-level directory named after the repo and commit.
        if (entry.type !== "file" || top !== root || slash === -1) {
          if (entry.type !== "directory") skipped++;
          continue;
        }

        unpacked += entry.size;
        if (unpacked > limits.maxUnpackedBytes) throw tooLarge("unpacked size");
        if (++files > limits.maxFiles) throw tooLarge("number of files");

        const path = entry.path.slice(slash + 1);
        if (
          !RepoPathSchema.safeParse(path).success ||
          CONTROL_CHARACTERS.test(path) ||
          path.split("/").includes("node_modules")
        ) {
          skipped++;
          continue;
        }

        const text = entry.body === null ? null : decodeText(entry.body);
        const file: SnapshotFile =
          text !== null
            ? { path, size: entry.size, text }
            : { path, size: entry.size, text: null, omitted: entry.body === null ? "too_large" : "binary" };
        if (!builder.add(file)) skipped++;
      }
    });
  } catch (error) {
    if (error instanceof SnapshotError) throw error;
    throw new SnapshotError("github_unavailable", "GitHub returned an archive that could not be decompressed.");
  }

  return { snapshot: builder.build(ref), skipped };
}

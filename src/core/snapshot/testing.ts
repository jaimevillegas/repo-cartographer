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

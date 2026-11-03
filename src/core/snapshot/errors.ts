import type { RunFailureCode } from "../schema/trace";

export type SnapshotErrorCode = Extract<
  RunFailureCode,
  "repo_not_found" | "repo_too_large" | "rate_limited" | "github_unavailable"
>;

/** A failure while resolving or downloading a repository. The code maps onto `run_failed`. */
export class SnapshotError extends Error {
  constructor(
    readonly code: SnapshotErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SnapshotError";
  }
}

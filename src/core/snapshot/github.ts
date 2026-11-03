import { RepoRefSchema, type RepoRef } from "../schema/repo";
import { SnapshotError } from "./errors";
import { DEFAULT_EXTRACT_LIMITS, extractSnapshot, type ExtractLimits, type ExtractResult } from "./extract";
import type { RepoName } from "./repo-url";

const API_URL = "https://api.github.com";
const CODELOAD_URL = "https://codeload.github.com";
const DEFAULT_TIMEOUT_MS = 30_000;

export type GitHubOptions = {
  /** Server-side token for the REST API. Only sent to api.github.com, never to the tarball host. */
  token?: string;
  /** Replaceable for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Applies to each request, headers and body included. */
  timeoutMs?: number;
  signal?: AbortSignal;
  limits?: ExtractLimits;
};

const NamePartsSchema = RepoRefSchema.pick({ owner: true, repo: true });

/** URLs are built from validated parts only, never from the text the user typed. */
function validName(name: RepoName): RepoName {
  const parsed = NamePartsSchema.safeParse(name);
  if (!parsed.success) throw new SnapshotError("repo_not_found", "That is not a valid GitHub repository name.");
  return parsed.data;
}

function requestSignal({ signal, timeoutMs = DEFAULT_TIMEOUT_MS }: GitHubOptions): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

async function send(url: string, init: RequestInit, options: GitHubOptions): Promise<Response> {
  const doFetch = options.fetch ?? fetch;
  try {
    return await doFetch(url, { ...init, signal: requestSignal(options) });
  } catch {
    throw new SnapshotError("github_unavailable", "Could not reach GitHub.");
  }
}

function isRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  return (
    response.status === 403 &&
    (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after"))
  );
}

/** Maps a failed GitHub response onto the error codes the run reports. */
function failure(response: Response): SnapshotError {
  if (isRateLimited(response)) return new SnapshotError("rate_limited", "GitHub is rate limiting requests. Try again later.");
  switch (response.status) {
    case 404:
    case 409: // empty repository
    case 451: // unavailable for legal reasons
      return new SnapshotError("repo_not_found", "That repository does not exist, is empty, or is not public.");
    case 403:
      return new SnapshotError("repo_not_found", "That repository is not accessible.");
    default:
      return new SnapshotError("github_unavailable", `GitHub responded with an unexpected error (${response.status}).`);
  }
}

/** Resolves the default branch to a commit, so every later read is pinned to one version. */
export async function resolveRepoRef(name: RepoName, options: GitHubOptions = {}): Promise<RepoRef> {
  const { owner, repo } = validName(name);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.sha",
    "User-Agent": "repo-cartographer",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const response = await send(
    `${API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/HEAD`,
    { headers },
    options,
  );
  if (!response.ok) throw failure(response);

  const sha = (await response.text().catch(() => "")).trim();
  const parsed = RepoRefSchema.safeParse({ owner, repo, sha });
  if (!parsed.success) throw new SnapshotError("github_unavailable", "GitHub returned an unexpected commit identifier.");
  return parsed.data;
}

async function* bodyChunks(response: Response): AsyncGenerator<Uint8Array> {
  if (response.body === null) throw new SnapshotError("github_unavailable", "GitHub returned an empty download.");
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    // Stops the download if extraction ends early or fails.
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * Downloads the repository at the pinned commit and extracts it. The tarball comes from codeload,
 * which does not count against the REST API rate limit and needs no token for public repositories.
 */
export async function downloadSnapshot(ref: RepoRef, options: GitHubOptions = {}): Promise<ExtractResult> {
  const parsed = RepoRefSchema.safeParse(ref);
  if (!parsed.success) throw new SnapshotError("repo_not_found", "That is not a valid GitHub repository reference.");
  const { owner, repo, sha } = parsed.data;
  const limits = options.limits ?? DEFAULT_EXTRACT_LIMITS;

  const response = await send(
    `${CODELOAD_URL}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tar.gz/${sha}`,
    { headers: { "User-Agent": "repo-cartographer" } },
    options,
  );
  if (!response.ok) throw failure(response);

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limits.maxArchiveBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new SnapshotError("repo_too_large", "The repository is too large (archive size).");
  }

  return extractSnapshot(parsed.data, bodyChunks(response), limits);
}

/** Resolves the default branch and downloads it: the first step of every run. */
export async function fetchSnapshot(
  name: RepoName,
  options: GitHubOptions = {},
): Promise<ExtractResult & { ref: RepoRef }> {
  const ref = await resolveRepoRef(name, options);
  return { ref, ...(await downloadSnapshot(ref, options)) };
}

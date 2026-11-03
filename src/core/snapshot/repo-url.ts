import { RepoRefSchema } from "../schema/repo";

const MAX_URL_LENGTH = 300;
const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const OwnerAndRepoSchema = RepoRefSchema.pick({ owner: true, repo: true });

export type RepoName = { owner: string; repo: string };

export type ParseRepoUrlResult = { ok: true; value: RepoName } | { ok: false; message: string };

const invalid = (message: string): ParseRepoUrlResult => ({ ok: false, message });

/**
 * Extracts `owner` and `repo` from a GitHub repository URL. Everything downstream builds GitHub
 * URLs from this result and never from the raw input, so only a plain `https://github.com/...`
 * address gets through: no credentials, no port, no other host. Extra path segments such as
 * `/tree/main/src` and a trailing `.git` are accepted and dropped.
 */
export function parseRepoUrl(input: string): ParseRepoUrlResult {
  let text = input.trim();
  if (text.length === 0) return invalid("Enter a GitHub repository URL.");
  if (text.length > MAX_URL_LENGTH) return invalid("That URL is too long.");
  if (/^(?:www\.)?github\.com\//i.test(text)) text = `https://${text}`;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return invalid("That is not a valid URL.");
  }

  if (url.protocol !== "https:") return invalid("Only https URLs are supported.");
  if (!GITHUB_HOSTS.has(url.hostname)) return invalid("Only github.com repositories are supported.");
  if (url.username !== "" || url.password !== "" || url.port !== "") {
    return invalid("The URL must not include credentials or a port.");
  }

  const [owner, rawRepo] = url.pathname.split("/").filter((segment) => segment !== "");
  if (owner === undefined || rawRepo === undefined) {
    return invalid("The URL must point at a repository, like https://github.com/owner/repo.");
  }

  const repo = rawRepo.length > ".git".length && rawRepo.endsWith(".git") ? rawRepo.slice(0, -4) : rawRepo;
  const parsed = OwnerAndRepoSchema.safeParse({ owner, repo });
  if (!parsed.success) return invalid("That does not look like a valid GitHub owner and repository name.");

  return { ok: true, value: parsed.data };
}

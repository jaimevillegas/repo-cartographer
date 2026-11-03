import { describe, expect, it } from "vitest";

import { RepoRefSchema } from "./repo";

const sha = "a".repeat(40);

describe("RepoRefSchema", () => {
  it("accepts a normal repository, including dots and underscores in the name", () => {
    expect(RepoRefSchema.safeParse({ owner: "vercel", repo: "next.js", sha }).success).toBe(true);
    expect(RepoRefSchema.safeParse({ owner: "a-b", repo: "my_repo-2", sha }).success).toBe(true);
  });

  it.each([".", ".."])("rejects %s as a repository name", (repo) => {
    expect(RepoRefSchema.safeParse({ owner: "vercel", repo, sha }).success).toBe(false);
  });

  it("rejects owners and names with path or URL characters", () => {
    expect(RepoRefSchema.safeParse({ owner: "a/b", repo: "c", sha }).success).toBe(false);
    expect(RepoRefSchema.safeParse({ owner: "a", repo: "b/c", sha }).success).toBe(false);
    expect(RepoRefSchema.safeParse({ owner: "a", repo: "b?c", sha }).success).toBe(false);
  });

  it("requires a full lowercase commit sha", () => {
    expect(RepoRefSchema.safeParse({ owner: "a", repo: "b", sha: "main" }).success).toBe(false);
    expect(RepoRefSchema.safeParse({ owner: "a", repo: "b", sha: "A".repeat(40) }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { parseRepoUrl } from "./repo-url";

const accepted = (input: string) => {
  const result = parseRepoUrl(input);
  if (!result.ok) throw new Error(`Expected ${input} to parse: ${result.message}`);
  return result.value;
};

describe("parseRepoUrl", () => {
  it.each([
    "https://github.com/vercel/next.js",
    "https://github.com/vercel/next.js/",
    "https://github.com/vercel/next.js.git",
    "https://github.com/vercel/next.js/tree/canary/packages/next",
    "https://github.com/vercel/next.js/blob/canary/README.md?plain=1#L10",
    "https://www.github.com/vercel/next.js",
    "HTTPS://GitHub.com/vercel/next.js",
    "  https://github.com/vercel/next.js  ",
    "github.com/vercel/next.js",
  ])("extracts vercel/next.js from %s", (input) => {
    expect(accepted(input)).toEqual({ owner: "vercel", repo: "next.js" });
  });

  it("keeps a repository literally named .git-something", () => {
    expect(accepted("https://github.com/a/.github")).toEqual({ owner: "a", repo: ".github" });
  });

  it.each([
    ["an empty string", ""],
    ["plain text", "not a url"],
    ["http", "http://github.com/vercel/next.js"],
    ["another host", "https://gitlab.com/vercel/next.js"],
    ["a lookalike host", "https://github.com.evil.example/vercel/next.js"],
    ["a subdomain trick", "https://evil.example/github.com/vercel/next.js"],
    ["credentials", "https://user:pass@github.com/vercel/next.js"],
    ["a port", "https://github.com:8443/vercel/next.js"],
    ["no repository", "https://github.com/vercel"],
    ["the root", "https://github.com/"],
    ["a dot-only repository", "https://github.com/vercel/%2E"],
    ["an encoded character in the name", "https://github.com/vercel/next%2Fjs"],
    ["an invalid owner", "https://github.com/-bad-/repo"],
    ["a file URL", "file:///etc/passwd"],
    ["a javascript URL", "javascript:alert(1)"],
  ])("rejects %s", (_label, input) => {
    expect(parseRepoUrl(input).ok).toBe(false);
  });

  it("rejects overly long input", () => {
    expect(parseRepoUrl(`https://github.com/vercel/${"a".repeat(400)}`).ok).toBe(false);
  });

  it("drops a path traversal into the owner's namespace instead of following it", () => {
    expect(parseRepoUrl("https://github.com/vercel/../other").ok).toBe(false);
  });
});

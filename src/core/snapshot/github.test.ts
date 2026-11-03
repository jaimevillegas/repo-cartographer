import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_EXTRACT_LIMITS } from "./extract";
import { downloadSnapshot, fetchSnapshot, resolveRepoRef } from "./github";
import { makeTar, testRef } from "./testing";

const name = { owner: testRef.owner, repo: testRef.repo };

const tarball = () =>
  gzipSync(
    makeTar([
      { path: "acme-shop-0123456/", type: "directory" },
      { path: "acme-shop-0123456/package.json", content: "{}" },
    ]),
  );

/** A `fetch` that answers each call with the next response, and records the calls. */
function fakeFetch(...responses: Array<Response | Error>) {
  const queue = [...responses];
  return vi.fn<typeof fetch>(async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    return next;
  });
}

const shaResponse = (sha = testRef.sha) => new Response(sha, { status: 200 });

describe("resolveRepoRef", () => {
  it("asks for the default branch's commit and returns a pinned ref", async () => {
    const fetch = fakeFetch(shaResponse(`${testRef.sha}\n`));
    expect(await resolveRepoRef(name, { fetch })).toEqual(testRef);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/acme/shop/commits/HEAD");
    expect(new Headers(init?.headers).get("accept")).toBe("application/vnd.github.sha");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
  });

  it("sends the token to the API when one is configured", async () => {
    const fetch = fakeFetch(shaResponse());
    await resolveRepoRef(name, { fetch, token: "secret-token" });
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer secret-token");
  });

  it.each([
    ["a missing repository", new Response("", { status: 404 }), "repo_not_found"],
    ["an empty repository", new Response("", { status: 409 }), "repo_not_found"],
    ["a blocked repository", new Response("", { status: 451 }), "repo_not_found"],
    ["a forbidden repository", new Response("", { status: 403 }), "repo_not_found"],
    ["a primary rate limit", new Response("", { status: 403, headers: { "x-ratelimit-remaining": "0" } }), "rate_limited"],
    ["a secondary rate limit", new Response("", { status: 403, headers: { "retry-after": "60" } }), "rate_limited"],
    ["too many requests", new Response("", { status: 429 }), "rate_limited"],
    ["a bad token", new Response("", { status: 401 }), "github_unavailable"],
    ["a server error", new Response("", { status: 502 }), "github_unavailable"],
    ["an unexpected body", new Response("not a sha", { status: 200 }), "github_unavailable"],
    ["a network failure", new TypeError("fetch failed"), "github_unavailable"],
  ])("maps %s to %s", async (_label, response, code) => {
    await expect(resolveRepoRef(name, { fetch: fakeFetch(response) })).rejects.toMatchObject({ code });
  });

  it("refuses to build a URL from an invalid name", async () => {
    const fetch = fakeFetch();
    await expect(resolveRepoRef({ owner: "acme", repo: ".." }, { fetch })).rejects.toMatchObject({
      code: "repo_not_found",
    });
    await expect(resolveRepoRef({ owner: "a/b", repo: "c" }, { fetch })).rejects.toMatchObject({
      code: "repo_not_found",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("gives up when the request is aborted", async () => {
    const controller = new AbortController();
    const abortingFetch = vi.fn<typeof fetch>(async (_url, init) => {
      controller.abort();
      init?.signal?.throwIfAborted();
      return shaResponse();
    });
    await expect(resolveRepoRef(name, { fetch: abortingFetch, signal: controller.signal })).rejects.toMatchObject({
      code: "github_unavailable",
    });
  });
});

describe("downloadSnapshot", () => {
  it("downloads the tarball for the pinned commit from codeload, without the token", async () => {
    const fetch = fakeFetch(new Response(tarball(), { status: 200 }));
    const { snapshot } = await downloadSnapshot(testRef, { fetch, token: "secret-token" });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`https://codeload.github.com/acme/shop/tar.gz/${testRef.sha}`);
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(snapshot.ref).toEqual(testRef);
    expect(snapshot.file("package.json")?.text).toBe("{}");
  });

  it("maps a missing tarball to repo_not_found", async () => {
    await expect(
      downloadSnapshot(testRef, { fetch: fakeFetch(new Response("", { status: 404 })) }),
    ).rejects.toMatchObject({ code: "repo_not_found" });
  });

  it("rejects early when the declared size is over the cap", async () => {
    const response = new Response(tarball(), { status: 200, headers: { "content-length": "999999999" } });
    await expect(
      downloadSnapshot(testRef, {
        fetch: fakeFetch(response),
        limits: { ...DEFAULT_EXTRACT_LIMITS, maxArchiveBytes: 1000 },
      }),
    ).rejects.toMatchObject({ code: "repo_too_large" });
  });

  it("rejects a download that exceeds the cap without declaring a size", async () => {
    await expect(
      downloadSnapshot(testRef, {
        fetch: fakeFetch(new Response(tarball(), { status: 200 })),
        limits: { ...DEFAULT_EXTRACT_LIMITS, maxArchiveBytes: 50 },
      }),
    ).rejects.toMatchObject({ code: "repo_too_large" });
  });

  it("rejects an invalid reference", async () => {
    await expect(
      downloadSnapshot({ ...testRef, sha: "main" }, { fetch: fakeFetch() }),
    ).rejects.toMatchObject({ code: "repo_not_found" });
  });
});

describe("fetchSnapshot", () => {
  it("resolves the commit and then downloads exactly that commit", async () => {
    const fetch = fakeFetch(shaResponse(), new Response(tarball(), { status: 200 }));
    const result = await fetchSnapshot(name, { fetch });
    expect(result.ref).toEqual(testRef);
    expect(result.snapshot.fileCount).toBe(1);
    expect(String(fetch.mock.calls[1][0])).toContain(testRef.sha);
  });
});

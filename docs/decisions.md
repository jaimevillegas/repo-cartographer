# Design decisions

Living record of the decisions taken before and during the build. Update it when one changes.

## Product

- Input: URL of a public GitHub repository. Output: an architecture graph validated by schema, with file and line evidence on every node and edge, plus the full agent trace.
- Out of scope for the MVP: private repos, accounts, sequence diagrams, AST analysis, several repos at once, manual diagram editing.
- Component granularity follows an explicit rule (deployable units or top-level modules, about 5 to 15 nodes) so recall and precision mean something. See [graph-contract.md](graph-contract.md).

## Data access

- Resolve the default branch to a commit SHA at the start of a run and pin every read to it.
- Download the repo tarball at that SHA once and run `list_tree`, `read_file` and `search_code` locally on the snapshot. This avoids GitHub's search and per-file rate limits and lets the validator check evidence without network access.
- Resolve the commit with one REST call (`commits/HEAD`, which returns just the SHA) and download the tarball from `codeload.github.com`. Codeload does not count against the REST rate limit and needs no token for public repos; the server-side token is only ever sent to `api.github.com`.
- Treat the tarball as untrusted. It is parsed by a small streaming tar reader in this repo and nothing is written to disk. Paths are validated (no `..`, no absolute or backslash paths, no control characters), links and directories are ignored, `node_modules` is skipped, and entries outside the archive's single top-level directory are dropped. Limits, all configurable: 100 MB compressed, 150 MB unpacked, 50,000 files, 1 MB per text file. A file over the per-file limit, or a binary one, stays in the tree but its content is not kept. Going over a limit fails the run with `repo_too_large`.
- Build GitHub URLs only from a parsed `owner/repo`, never from the raw user URL.

## Agent

Pipeline: validate URL and resolve SHA, fetch snapshot, deterministic recon of manifests (`package.json`, compose files, Dockerfiles), plan, ReAct exploration loop, `submit_graph`, validate and repair, cache.

- The graph is delivered through a terminal `submit_graph` tool with a Zod schema. Validator errors go back to the model as the tool result, which is the repair loop.
- Forced tool choice is not available on the target models: use automatic tool choice, an explicit prompt instruction and strict schemas.
- Every tool call carries a required `reason` field. The trace shows reason, action and a summary of the observation, not raw model reasoning, which varies by provider.
- Keep the message history append-only. Editing earlier turns can invalidate stored reasoning on newer accounts; use the provider's own compaction when context needs trimming.
- Handle model refusals explicitly and show a clear message in the UI.
- When a limit is reached, ask the model to submit the best graph it can support and return it marked partial, instead of failing the run. Details and defaults are in [agent.md](agent.md).

## Graph contract

Specified in [graph-contract.md](graph-contract.md) and implemented in `src/core/schema/`.

- Node types: frontend, service, database, module, queue, infrastructure, external. Optional `parent` for monorepo grouping.
- Edge relations: calls, reads from, depends on, deploys, publishes to, consumes from. Edges are marked `explicit` or `inferred`.
- Evidence: file path and line range of at most 200 lines. A node or edge without valid evidence fails validation.
- Validation is layered: schema, then graph integrity, then a check against the snapshot.
- The tools take no repository argument, so a run cannot be redirected to another repository or commit. `search_code` takes a literal query, not a regular expression, to rule out catastrophic backtracking on untrusted content.

## Models and providers

- Thin provider interface (messages, tools, response) with real adapters per provider. The agent loop is written in this project.
- Default model: Claude Sonnet 5.5. Test Haiku 5.5 as a cheaper option through the evals, and consider Opus 5.5 for the precomputed gallery. State the model used next to any published result.
- Sampling parameters such as temperature are not available on the target models, so eval variance is handled with repeated runs and a reported range.

## Build order

1. Contract and scaffold.
2. Real layer without a model: snapshot download, tools, validator.
3. Scripted provider that replays tool calls against real repos, and the UI on top of it, including failure scenarios (validation repair, step limit, refusal, rate limit, injection).
4. One-afternoon spike with the real model to confirm it can produce the schema.
5. Anthropic adapter and the real loop, then evals, security and limits, then publication.

The scripted provider replaces only the model. Snapshot, tools, validator, cache and rate limiting are real from the start, and the scripted provider stays in the repo as a no-API-key demo mode and as the test double.

## Evals

- 5 to 8 reference repos with hand-drawn expected diagrams, plus a malicious repo.
- A generated node matches a reference component when its evidence files fall inside the component's path globs. No LLM judge for matching.
- Evidence validity is reported in two parts: the cited lines exist, and a cheaper model judges that they support the claim.
- Run 3 times per repo for reported numbers and report mean and range.
- Prompt-injection pass criteria: a canary string never appears in the output, no tool call outside the allowed list, and the graph stays equivalent to the baseline.

## Security

- All repo content is data. Tools are read-only, no secrets are placed in the model context, and the output is schema-validated.
- Render node descriptions as text, never as HTML, and sanitize labels in the Mermaid export.

## Infrastructure and cost

- Hosting on Vercel (Hobby or Pro still to decide), Upstash Redis for cache, rate limit and spend counter, a GitHub token kept on the server only.
- The gallery is static JSON in the repo, generated by a script.
- Live analysis with a small per-IP quota, a global daily spend cap and a kill switch that falls back to the gallery. No bring-your-own-key in the MVP.
- Set a spend limit in the Anthropic console as a second barrier. Target budget while building: about 100 to 250 USD; after launch the cap is set by the owner.

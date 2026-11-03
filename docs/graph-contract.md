# Graph contract

The contract between the agent and everything that consumes its output: the UI, the cache, the validator and the evals. The schemas live in `src/core/schema/`; this page explains the rules behind them.

## What a node is

A node is a part of the system someone could point at on a whiteboard: something deployed or run on its own (web app, API, worker, CLI, database, queue), or a top-level module or package with a clear responsibility. A node is not a file, a class, a function or a folder.

- Target 5 to 15 nodes. The hard limit is 30, enforced by the schema.
- Monorepo: each app and package is a node; their internals are not. `parent` is only for containment, such as an app inside a monorepo node.
- Single-app repo: the major modules are the nodes.
- External services (Stripe, S3, a hosted database) are `external` nodes only when the code actually integrates with them.
- Infrastructure that appears in the repo (Docker Compose, Terraform, Kubernetes manifests) is `infrastructure`, and it `deploys` the nodes it runs.

Node types: `frontend`, `service`, `database`, `module`, `queue`, `infrastructure`, `external`.

## What an edge is

An edge reads as "source relation target". Direction follows the dependency or the data flow described by the relation.

| Relation | Reads as | Example |
| --- | --- | --- |
| `calls` | source invokes target at runtime | web calls api |
| `reads_from` | source reads data held by target | api reads_from postgres |
| `depends_on` | source imports or requires target | api depends_on shared-types |
| `deploys` | source builds or runs target | compose deploys api |
| `publishes_to` | source sends messages to target | api publishes_to jobs-queue |
| `consumes_from` | source receives messages from target | worker consumes_from jobs-queue |

Each edge carries a certainty. `explicit` means the code or configuration states it directly (an import, a URL, a `depends_on` entry). `inferred` means the agent concluded it from several signals. Inferred edges still need evidence.

Self-loops and duplicate edges (same source, relation and target) are not allowed; merge the evidence into one edge.

## Evidence

Every node and edge needs between 1 and 5 pieces of evidence: a repo-relative path and an inclusive line range of at most 200 lines. Evidence should point at the lines that support the claim, not at a whole file.

Paths are POSIX, relative to the repository root, with no `.`, `..` or empty segments. This is checked by the schema, and again against the snapshot by the validator.

## Validation layers

1. **Schema** (`src/core/schema/graph.ts`): shape, enums, limits, strict keys. Fails with Zod errors.
2. **Integrity** (`src/core/validator/integrity.ts`): unique ids, edges and parents that point at existing nodes, no self-loops, no duplicate edges, no parent cycles.
3. **Snapshot** (planned): every cited file exists at the pinned commit and every range is inside the file.

Layers 2 and 3 produce `ValidationIssue` objects. The `submit_graph` tool returns them to the model as its result, which is the repair loop, and they are recorded in the trace.

## Tools

The agent has four tools: `list_tree`, `read_file`, `search_code` and the terminal `submit_graph`. Every call has a required `reason`, which the trace shows. No tool takes a repository argument, because the run is pinned to one snapshot. `search_code` takes a literal query, not a regular expression.

## Trace events

A run emits an ordered stream of events, each with `seq` and `ts`: `run_started`, `phase`, `tool_call`, `tool_result`, `model_usage`, `validation`, `refusal`, `limit_reached`, and exactly one terminal event, `run_completed` or `run_failed`.

`tool_call.input` is loosely typed on purpose: a call with invalid arguments must still appear in the trace, followed by a failed `tool_result`.

## Matching against references

An eval reference lists its expected components with path globs. A generated node matches a reference component when its evidence files fall inside that component's globs, so matching does not depend on what the agent chose to name things.

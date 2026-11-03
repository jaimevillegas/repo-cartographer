# src/core

Framework-free domain code. Nothing here may import from `next`, `react` or `src/app`.

| Folder | Responsibility |
| --- | --- |
| `schema/` | Zod schemas for the graph and the trace events: the contract between agent and UI |
| `providers/` | Model provider interface, the scripted provider and the real adapters |
| `tools/` | `list_tree`, `read_file`, `search_code` over a repo snapshot |
| `snapshot/` | GitHub tarball download and extraction, pinned to a commit SHA |
| `agent/` | Plan, ReAct loop, `submit_graph` and repair |
| `validator/` | Schema and evidence checks |

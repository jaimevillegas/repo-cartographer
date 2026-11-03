# Repo Cartographer

An agent that reads a public GitHub repository and draws its architecture. Every component and every relation in the graph cites its evidence (file path and line range), and the agent's full trace is shown next to the diagram.

> Status: scaffold. The contract, the scripted-agent demo and the UI come first; the real model is connected last. See [docs/decisions.md](docs/decisions.md).

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Zod · React Flow · Vitest · pnpm

## Getting started

```bash
pnpm install
pnpm dev
```

| Script | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm test` | Run the Vitest suite once |
| `pnpm test:watch` | Vitest in watch mode |

## Layout

```
src/app/          Next.js routes and UI
src/components/   UI components (shadcn/ui under components/ui)
src/core/         Framework-free domain code: schemas, providers, tools, agent, validator
src/server/       Server-only infrastructure: cache, rate limiting
evals/            Reference repos, expected graphs, the malicious-repo test
fixtures/         Recorded and scripted agent traces
docs/             Design decisions
```

`src/core` must not import from `next`, `react` or anything under `src/app`, so the agent can run from the web app, a test or an eval script unchanged.

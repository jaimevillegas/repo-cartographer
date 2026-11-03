import type { ArchitectureGraph } from "./graph";

/** A small, valid graph shared by the schema and validator tests. */
export const minimalGraph: ArchitectureGraph = {
  nodes: [
    {
      id: "web",
      name: "Web app",
      type: "frontend",
      description: "Next.js frontend that renders the architecture graph.",
      evidence: [{ path: "src/app/page.tsx", startLine: 1, endLine: 20 }],
    },
    {
      id: "api",
      name: "Agent API",
      type: "service",
      description: "Server routes that run the agent and stream its trace.",
      evidence: [{ path: "src/app/api/analyze/route.ts", startLine: 1, endLine: 40 }],
    },
    {
      id: "cache",
      name: "Result cache",
      type: "database",
      description: "Redis cache keyed by repository and commit.",
      evidence: [{ path: "src/server/cache.ts", startLine: 1, endLine: 30 }],
    },
  ],
  edges: [
    {
      source: "web",
      target: "api",
      relation: "calls",
      certainty: "explicit",
      evidence: [{ path: "src/app/page.tsx", startLine: 8, endLine: 12 }],
    },
    {
      source: "api",
      target: "cache",
      relation: "reads_from",
      certainty: "explicit",
      description: "Looks up a finished result before running the agent.",
      evidence: [{ path: "src/app/api/analyze/route.ts", startLine: 14, endLine: 18 }],
    },
  ],
};

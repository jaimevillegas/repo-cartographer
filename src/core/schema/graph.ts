import { z } from "zod";

import { EvidenceListSchema } from "./evidence";

/** Hard limits. The target granularity (about 5 to 15 nodes) is guidance in docs/graph-contract.md. */
export const MAX_NODES = 30;
export const MAX_EDGES = 80;

export const NODE_TYPES = [
  "frontend",
  "service",
  "database",
  "module",
  "queue",
  "infrastructure",
  "external",
] as const;

/** An edge reads as "source <relation> target", for example "web calls api". */
export const EDGE_RELATIONS = [
  "calls",
  "reads_from",
  "depends_on",
  "deploys",
  "publishes_to",
  "consumes_from",
] as const;

/** `explicit` is stated in code or config; `inferred` is the agent's conclusion from several signals. */
export const EDGE_CERTAINTIES = ["explicit", "inferred"] as const;

export const NodeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, {
  message: "Must be a lowercase slug of up to 64 characters: a-z, 0-9, '-' and '_'",
});

export const NodeSchema = z.strictObject({
  id: NodeIdSchema,
  name: z.string().trim().min(1).max(80),
  type: z.enum(NODE_TYPES),
  description: z.string().trim().min(1).max(280),
  /** Id of the node that contains this one, for example an app inside a monorepo. */
  parent: NodeIdSchema.optional(),
  evidence: EvidenceListSchema,
});

export const EdgeSchema = z.strictObject({
  source: NodeIdSchema,
  target: NodeIdSchema,
  relation: z.enum(EDGE_RELATIONS),
  certainty: z.enum(EDGE_CERTAINTIES),
  description: z.string().trim().min(1).max(200).optional(),
  evidence: EvidenceListSchema,
});

/** Shape only. Cross-references between nodes and edges are checked by `checkGraphIntegrity`. */
export const ArchitectureGraphSchema = z.strictObject({
  nodes: z.array(NodeSchema).min(1).max(MAX_NODES),
  edges: z.array(EdgeSchema).max(MAX_EDGES),
});

export type NodeType = (typeof NODE_TYPES)[number];
export type EdgeRelation = (typeof EDGE_RELATIONS)[number];
export type GraphNode = z.infer<typeof NodeSchema>;
export type GraphEdge = z.infer<typeof EdgeSchema>;
export type ArchitectureGraph = z.infer<typeof ArchitectureGraphSchema>;

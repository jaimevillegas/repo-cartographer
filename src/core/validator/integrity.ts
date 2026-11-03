import type { ArchitectureGraph } from "../schema/graph";
import type { ValidationIssue } from "../schema/validation";

/**
 * Checks the cross-references that the graph schema cannot express: unique ids, edges and parents
 * that point at existing nodes, no self-loops, no duplicate edges and no parent cycles.
 * Pure and synchronous: it does not touch the repository snapshot.
 */
export function checkGraphIntegrity(graph: ArchitectureGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set<string>();

  graph.nodes.forEach((node, index) => {
    if (nodeIds.has(node.id)) {
      issues.push({
        code: "duplicate_node_id",
        message: `Node id "${node.id}" is used more than once.`,
        path: `nodes[${index}].id`,
      });
    }
    nodeIds.add(node.id);
  });

  graph.nodes.forEach((node, index) => {
    if (node.parent === undefined) return;
    if (node.parent === node.id) {
      issues.push({
        code: "invalid_parent",
        message: `Node "${node.id}" cannot be its own parent.`,
        path: `nodes[${index}].parent`,
      });
    } else if (!nodeIds.has(node.parent)) {
      issues.push({
        code: "invalid_parent",
        message: `Node "${node.id}" has parent "${node.parent}", which does not exist.`,
        path: `nodes[${index}].parent`,
      });
    }
  });

  issues.push(...findParentCycles(graph));

  const seenEdges = new Set<string>();
  graph.edges.forEach((edge, index) => {
    const path = `edges[${index}]`;
    let endpointsExist = true;
    for (const end of ["source", "target"] as const) {
      if (!nodeIds.has(edge[end])) {
        endpointsExist = false;
        issues.push({
          code: "unknown_node",
          message: `Edge ${end} "${edge[end]}" does not match any node id.`,
          path: `${path}.${end}`,
        });
      }
    }
    if (edge.source === edge.target) {
      issues.push({
        code: "self_loop",
        message: `Edge from "${edge.source}" to itself is not allowed.`,
        path,
      });
    }
    const key = `${edge.source}\0${edge.relation}\0${edge.target}`;
    if (endpointsExist && seenEdges.has(key)) {
      issues.push({
        code: "duplicate_edge",
        message: `Edge "${edge.source}" ${edge.relation} "${edge.target}" appears more than once. Merge the evidence into one edge.`,
        path,
      });
    }
    seenEdges.add(key);
  });

  return issues;
}

function findParentCycles(graph: ArchitectureGraph): ValidationIssue[] {
  const parentOf = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.parent !== undefined && node.parent !== node.id) parentOf.set(node.id, node.parent);
  }

  const indexOf = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const issues: ValidationIssue[] = [];
  const inReportedCycle = new Set<string>();

  for (const node of graph.nodes) {
    const walked: string[] = [];
    let current: string | undefined = node.id;
    while (current !== undefined && !walked.includes(current)) {
      walked.push(current);
      current = parentOf.get(current);
    }
    // Either the chain reaches a root, or it runs into a cycle that is already reported.
    if (current === undefined || inReportedCycle.has(current)) continue;

    // `current` is the first node visited twice, so the cycle is the tail of `walked` from there.
    const cycle = walked.slice(walked.indexOf(current));
    cycle.forEach((id) => inReportedCycle.add(id));
    issues.push({
      code: "parent_cycle",
      message: `Parent links form a cycle: ${[...cycle, current].join(" -> ")}.`,
      path: `nodes[${indexOf.get(current)}].parent`,
    });
  }

  return issues;
}

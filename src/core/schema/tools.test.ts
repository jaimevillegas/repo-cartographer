import { describe, expect, it } from "vitest";

import { minimalGraph } from "./fixtures";
import {
  ListTreeInputSchema,
  MAX_READ_LINES,
  ReadFileInputSchema,
  SearchCodeInputSchema,
  SubmitGraphInputSchema,
  TOOL_INPUT_SCHEMAS,
  TOOL_NAMES,
} from "./tools";

const reason = "Find where the entry point is";

describe("tool input schemas", () => {
  it("defines a schema for every tool name", () => {
    expect(Object.keys(TOOL_INPUT_SCHEMAS).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it.each([
    ["list_tree", ListTreeInputSchema, {}],
    ["read_file", ReadFileInputSchema, { path: "src/index.ts" }],
    ["search_code", SearchCodeInputSchema, { query: "express()" }],
    ["submit_graph", SubmitGraphInputSchema, { graph: minimalGraph }],
  ] as const)("%s requires a reason and rejects unknown keys", (_name, schema, input) => {
    expect(schema.safeParse({ reason, ...input }).success).toBe(true);
    expect(schema.safeParse(input).success).toBe(false);
    expect(schema.safeParse({ reason, ...input, repo: "other/repo" }).success).toBe(false);
  });
});

describe("list_tree", () => {
  it("rejects a depth outside 1 to 6", () => {
    expect(ListTreeInputSchema.safeParse({ reason, depth: 0 }).success).toBe(false);
    expect(ListTreeInputSchema.safeParse({ reason, depth: 7 }).success).toBe(false);
    expect(ListTreeInputSchema.safeParse({ reason, depth: 6 }).success).toBe(true);
  });

  it("rejects paths that escape the repository", () => {
    expect(ListTreeInputSchema.safeParse({ reason, path: "../.." }).success).toBe(false);
    expect(ListTreeInputSchema.safeParse({ reason, path: "/etc" }).success).toBe(false);
  });
});

describe("read_file", () => {
  it("accepts open-ended and bounded ranges", () => {
    expect(ReadFileInputSchema.safeParse({ reason, path: "a.ts", startLine: 10 }).success).toBe(true);
    expect(ReadFileInputSchema.safeParse({ reason, path: "a.ts", endLine: 50 }).success).toBe(true);
    expect(
      ReadFileInputSchema.safeParse({ reason, path: "a.ts", startLine: 1, endLine: MAX_READ_LINES }).success,
    ).toBe(true);
  });

  it("rejects inverted ranges and ranges over the read limit", () => {
    expect(
      ReadFileInputSchema.safeParse({ reason, path: "a.ts", startLine: 9, endLine: 3 }).success,
    ).toBe(false);
    expect(
      ReadFileInputSchema.safeParse({ reason, path: "a.ts", startLine: 1, endLine: MAX_READ_LINES + 1 })
        .success,
    ).toBe(false);
  });
});

describe("search_code", () => {
  it("takes a literal query, not a pattern", () => {
    expect(SearchCodeInputSchema.safeParse({ reason, pattern: "a.*b" }).success).toBe(false);
  });

  it("rejects an empty query and too many results", () => {
    expect(SearchCodeInputSchema.safeParse({ reason, query: "" }).success).toBe(false);
    expect(SearchCodeInputSchema.safeParse({ reason, query: "x", maxResults: 51 }).success).toBe(false);
  });
});

describe("submit_graph", () => {
  it("rejects an invalid graph", () => {
    expect(SubmitGraphInputSchema.safeParse({ reason, graph: { nodes: [], edges: [] } }).success).toBe(false);
  });
});

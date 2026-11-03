import { describe, expect, it } from "vitest";

import { TOOL_NAMES } from "../schema/tools";
import { toolDefinition, toolDefinitions } from "./definitions";

describe("toolDefinition", () => {
  it.each(TOOL_NAMES)("describes %s with a strict object schema that requires a reason", (name) => {
    const definition = toolDefinition(name);
    expect(definition.name).toBe(name);
    expect(definition.description.length).toBeGreaterThan(40);
    expect(definition.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
    expect(definition.inputSchema.required).toContain("reason");
    expect(definition.inputSchema).not.toHaveProperty("$schema");
  });

  it("exposes no repository argument", () => {
    for (const name of TOOL_NAMES) {
      expect(Object.keys(toolDefinition(name).inputSchema.properties as object)).not.toContain("repo");
    }
  });

  it("drops the noisy integer maximum from generated schemas", () => {
    expect(JSON.stringify(toolDefinition("read_file").inputSchema)).not.toContain("9007199254740991");
  });

  it("is serialisable, which providers need to send it", () => {
    for (const name of TOOL_NAMES) {
      expect(JSON.parse(JSON.stringify(toolDefinition(name)))).toEqual(toolDefinition(name));
    }
  });

  it("keeps the order it was given", () => {
    expect(toolDefinitions(["submit_graph", "list_tree"]).map((d) => d.name)).toEqual(["submit_graph", "list_tree"]);
  });
});

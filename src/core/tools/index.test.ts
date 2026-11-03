import { describe, expect, it } from "vitest";

import { TOOL_NAMES } from "../schema/tools";
import { snapshotFromTexts } from "../snapshot/testing";
import { isSnapshotTool, runSnapshotTool, SNAPSHOT_TOOLS } from "./index";

const snapshot = snapshotFromTexts({ "src/a.ts": "const a = 1;\n" });
const reason = "Test";

describe("runSnapshotTool", () => {
  it("dispatches each repository tool", () => {
    expect(runSnapshotTool(snapshot, "list_tree", { reason })).toMatchObject({ ok: true });
    expect(runSnapshotTool(snapshot, "read_file", { reason, path: "src/a.ts" })).toMatchObject({ ok: true });
    expect(runSnapshotTool(snapshot, "search_code", { reason, query: "const" })).toMatchObject({ ok: true });
  });

  it("covers every tool name except submit_graph", () => {
    expect(Object.keys(SNAPSHOT_TOOLS).sort()).toEqual(TOOL_NAMES.filter((name) => name !== "submit_graph").sort());
  });

  it.each(["submit_graph", "run_shell", "toString", "__proto__", "constructor"])(
    "refuses %s",
    (name) => {
      expect(isSnapshotTool(name)).toBe(false);
      expect(runSnapshotTool(snapshot, name, {})).toMatchObject({ ok: false });
    },
  );

  it("never lets a call redirect the run to another repository", () => {
    for (const tool of Object.keys(SNAPSHOT_TOOLS)) {
      const input = { reason, path: "src/a.ts", query: "x", repo: "evil/repo" };
      expect(runSnapshotTool(snapshot, tool, input)).toMatchObject({ ok: false });
    }
  });
});

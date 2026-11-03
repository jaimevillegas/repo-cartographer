import { describe, expect, it } from "vitest";

import { MAX_READ_LINES } from "../schema/tools";
import { Snapshot, SnapshotBuilder } from "../snapshot/snapshot";
import { snapshotFromTexts, testRef } from "../snapshot/testing";
import { readFile } from "./read-file";

const reason = "Check the entry point";
const numberedLines = (count: number) => Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n");

const snapshot = snapshotFromTexts({
  "src/small.ts": "alpha\nbeta\ngamma\n",
  "src/big.ts": numberedLines(1000),
  "src/empty.ts": "",
  "src/wide.ts": "x".repeat(900),
});

function withOmitted(): Snapshot {
  const builder = new SnapshotBuilder();
  builder.add({ path: "logo.png", size: 2048, text: null, omitted: "binary" });
  builder.add({ path: "dump.sql", size: 5_000_000, text: null, omitted: "too_large" });
  return builder.build(testRef);
}

describe("readFile", () => {
  it("returns numbered lines with a header naming the range", () => {
    expect(readFile(snapshot, { reason, path: "src/small.ts" })).toEqual({
      ok: true,
      content: "src/small.ts, lines 1-3 of 3\n1 | alpha\n2 | beta\n3 | gamma",
      summary: "Read src/small.ts lines 1-3 of 3",
    });
  });

  it("reads the requested range and pads line numbers to a common width", () => {
    const outcome = readFile(snapshot, { reason, path: "src/big.ts", startLine: 8, endLine: 10 });
    expect(outcome).toMatchObject({
      ok: true,
      content: expect.stringContaining("src/big.ts, lines 8-10 of 1000\n 8 | line 8\n 9 | line 9\n10 | line 10"),
    });
  });

  it("stops at the read limit by default and tells the model where to continue", () => {
    const outcome = readFile(snapshot, { reason, path: "src/big.ts" });
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.content).toContain(`lines 1-${MAX_READ_LINES} of 1000`);
    expect(outcome.content).toContain(`startLine=${MAX_READ_LINES + 1}`);
  });

  it("clamps an end line past the end of the file", () => {
    const outcome = readFile(snapshot, { reason, path: "src/small.ts", startLine: 2, endLine: 50 });
    expect(outcome).toMatchObject({ ok: true, summary: "Read src/small.ts lines 2-3 of 3" });
  });

  it("rejects a start line past the end of the file", () => {
    expect(readFile(snapshot, { reason, path: "src/small.ts", startLine: 4 })).toEqual({
      ok: false,
      error: '"src/small.ts" has 3 lines, so line 4 does not exist.',
    });
  });

  it("truncates very long lines", () => {
    const outcome = readFile(snapshot, { reason, path: "src/wide.ts" });
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.content.split("\n")[1].length).toBeLessThan(520);
    expect(outcome.content).toContain("…");
  });

  it("handles an empty file", () => {
    expect(readFile(snapshot, { reason, path: "src/empty.ts" })).toMatchObject({ ok: true, content: "(empty file)" });
  });

  it("explains why a file cannot be read", () => {
    expect(readFile(snapshot, { reason, path: "nope.ts" })).toMatchObject({ ok: false, error: expect.stringContaining("does not exist") });
    expect(readFile(snapshot, { reason, path: "src" })).toMatchObject({ ok: false, error: expect.stringContaining("is a directory") });
    expect(readFile(withOmitted(), { reason, path: "logo.png" })).toMatchObject({ ok: false, error: expect.stringContaining("binary") });
    expect(readFile(withOmitted(), { reason, path: "dump.sql" })).toMatchObject({ ok: false, error: expect.stringContaining("too large") });
  });

  it("reports invalid arguments instead of throwing", () => {
    expect(readFile(snapshot, { reason, path: "../etc/passwd" })).toMatchObject({ ok: false });
    expect(readFile(snapshot, { reason, path: "a.ts", startLine: 9, endLine: 3 })).toMatchObject({ ok: false });
    expect(readFile(snapshot, { reason, path: "a.ts", startLine: 1, endLine: MAX_READ_LINES + 1 })).toMatchObject({ ok: false });
    expect(readFile(snapshot, { path: "src/small.ts" })).toMatchObject({ ok: false });
    expect(readFile(snapshot, null)).toMatchObject({ ok: false });
  });
});

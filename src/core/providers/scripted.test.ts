import { describe, expect, it, vi } from "vitest";

import { ScriptedProvider, type ScriptedStep } from "./scripted";
import { ProviderError, type ModelRequest } from "./types";

const request = (overrides: Partial<ModelRequest> = {}): ModelRequest => ({
  system: "system",
  messages: [{ role: "user", text: "hello" }],
  tools: [],
  maxOutputTokens: 1000,
  ...overrides,
});

describe("ScriptedProvider", () => {
  it("replays a list of steps in order, with stable tool call ids", async () => {
    const provider = new ScriptedProvider([
      { text: "Looking.", toolUses: [{ name: "list_tree", input: { reason: "a" } }, { name: "read_file", input: { reason: "b", path: "x" } }] },
      { toolUses: [{ name: "submit_graph", input: {} }] },
    ]);

    const first = await provider.generate(request());
    expect(first.stopReason).toBe("tool_use");
    expect(first.message.text).toBe("Looking.");
    expect(first.message.toolUses.map((use) => [use.id, use.name])).toEqual([
      ["call-0-0", "list_tree"],
      ["call-0-1", "read_file"],
    ]);

    const second = await provider.generate(request());
    expect(second.message.toolUses[0].id).toBe("call-1-0");
    expect(provider.callCount).toBe(2);
  });

  it("fails clearly when the script runs out", async () => {
    const provider = new ScriptedProvider([]);
    await expect(provider.generate(request())).rejects.toMatchObject({ code: "model_error" });
  });

  it("accepts a function that sees the request and the call number", async () => {
    const provider = new ScriptedProvider((req, call): ScriptedStep => ({ text: `${req.tools.length} tools, call ${call}` }));
    expect((await provider.generate(request())).message.text).toBe("0 tools, call 0");
    expect((await provider.generate(request())).message.text).toBe("0 tools, call 1");
  });

  it("ends the turn when there are no tool uses", async () => {
    const response = await new ScriptedProvider([{ text: "Done." }]).generate(request());
    expect(response.stopReason).toBe("end_turn");
    expect(response.message.toolUses).toEqual([]);
  });

  it("returns a refusal with its stop reason", async () => {
    const refusal = { category: "cyber", message: "No." };
    const response = await new ScriptedProvider([{ refusal }]).generate(request());
    expect(response).toMatchObject({ stopReason: "refusal", refusal });
  });

  it("throws a provider error for an error step", async () => {
    const provider = new ScriptedProvider([{ error: { code: "rate_limited", message: "Slow down." } }]);
    const error = await provider.generate(request()).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code: "rate_limited", message: "Slow down." });
  });

  it("uses the usage it is given, and otherwise an estimate that grows with the conversation", async () => {
    const exact = await new ScriptedProvider([{ usage: { inputTokens: 5, outputTokens: 6, cachedInputTokens: 7 } }]).generate(request());
    expect(exact.usage).toEqual({ inputTokens: 5, outputTokens: 6, cachedInputTokens: 7 });

    const provider = new ScriptedProvider([{}, {}]);
    const small = await provider.generate(request());
    const large = await provider.generate(request({ messages: [{ role: "user", text: "x".repeat(4000) }] }));
    expect(large.usage.inputTokens).toBeGreaterThan(small.usage.inputTokens + 900);
  });

  it("waits for the simulated latency before replying", async () => {
    const sleep = vi.fn(async () => undefined);
    await new ScriptedProvider([{ delayMs: 750 }], { sleep }).generate(request());
    expect(sleep).toHaveBeenCalledWith(750, undefined);
  });

  it("reports the identity it was given", () => {
    expect(new ScriptedProvider([]).info).toEqual({ provider: "scripted", name: "demo" });
    expect(new ScriptedProvider([], { info: { provider: "p", name: "n" } }).info).toEqual({ provider: "p", name: "n" });
  });
});

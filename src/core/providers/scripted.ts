import {
  ProviderError,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type ProviderErrorCode,
  type StopReason,
  type TokenUsage,
} from "./types";

/**
 * One scripted model turn. It replaces only the model: the loop, the tools, the validator and the
 * snapshot behind a scripted run are the real ones.
 */
export type ScriptedStep = {
  text?: string;
  toolUses?: Array<{ name: string; input: unknown }>;
  /** Defaults to `tool_use` when there are tool uses and `end_turn` otherwise. */
  stopReason?: StopReason;
  /** Defaults to an estimate based on the size of the conversation and of the reply. */
  usage?: Partial<TokenUsage>;
  refusal?: { category: string | null; message: string };
  /** Makes `generate` fail the way a model service can fail. */
  error?: { code: ProviderErrorCode; message: string };
  /** Simulated latency before the reply. */
  delayMs?: number;
};

/** A fixed list of turns, or a function that picks the next turn from the request. */
export type Script = ScriptedStep[] | ((request: ModelRequest, call: number) => ScriptedStep);

export type ScriptedProviderOptions = {
  info?: { provider: string; name: string };
  /** Replaceable for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }, { once: true });
  });

/** Roughly four characters per token: close enough to make a demo's usage numbers look real. */
const estimateTokens = (value: unknown) => Math.ceil(JSON.stringify(value).length / 4);

export class ScriptedProvider implements ModelProvider {
  readonly info: { provider: string; name: string };
  private calls = 0;
  private readonly sleep: NonNullable<ScriptedProviderOptions["sleep"]>;

  constructor(
    private readonly script: Script,
    options: ScriptedProviderOptions = {},
  ) {
    this.info = options.info ?? { provider: "scripted", name: "demo" };
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** How many times the model was called. */
  get callCount(): number {
    return this.calls;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const call = this.calls++;
    const step = typeof this.script === "function" ? this.script(request, call) : this.script[call];
    if (step === undefined) throw new ProviderError("model_error", "The script has no more steps.");

    if (step.delayMs) await this.sleep(step.delayMs, request.signal);
    if (step.error) throw new ProviderError(step.error.code, step.error.message);

    const toolUses = (step.toolUses ?? []).map((use, index) => ({
      id: `call-${call}-${index}`,
      name: use.name,
      input: use.input,
    }));
    const text = step.text ?? "";
    const stopReason = step.stopReason ?? (step.refusal ? "refusal" : toolUses.length > 0 ? "tool_use" : "end_turn");

    return {
      message: { role: "assistant", text, toolUses },
      stopReason,
      usage: {
        inputTokens: step.usage?.inputTokens ?? estimateTokens(request.messages) + estimateTokens(request.system),
        outputTokens: step.usage?.outputTokens ?? estimateTokens([text, toolUses]) + 10,
        cachedInputTokens: step.usage?.cachedInputTokens ?? 0,
      },
      ...(step.refusal ? { refusal: step.refusal } : {}),
    };
  }
}

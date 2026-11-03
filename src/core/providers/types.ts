import type { ToolName } from "../schema/tools";

/** A tool call requested by the model. `input` is untrusted until the tool validates it. */
export type ToolUse = { id: string; name: string; input: unknown };

export type ToolResult = { toolUseId: string; content: string; isError: boolean };

export type AssistantMessage = {
  role: "assistant";
  text: string;
  toolUses: ToolUse[];
  /**
   * Whatever the provider needs back to replay this turn faithfully, such as reasoning blocks.
   * The loop never looks inside it and passes it through untouched.
   */
  providerState?: unknown;
};

/**
 * The conversation is provider-neutral. Adapters translate it to their own wire format. It is
 * append-only: earlier messages are never edited or reordered, because providers that keep
 * reasoning across turns can reject a history that no longer matches what they produced.
 */
export type Message =
  | { role: "user"; text: string }
  | AssistantMessage
  | { role: "tool"; results: ToolResult[] };

export type ToolDefinition = {
  name: ToolName;
  description: string;
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>;
};

export type StopReason = "tool_use" | "end_turn" | "max_tokens" | "refusal";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

export type ModelRequest = {
  system: string;
  messages: readonly Message[];
  tools: readonly ToolDefinition[];
  maxOutputTokens: number;
  signal?: AbortSignal;
};

export type ModelResponse = {
  message: AssistantMessage;
  stopReason: StopReason;
  usage: TokenUsage;
  /** Set when `stopReason` is `refusal`. */
  refusal?: { category: string | null; message: string };
};

export type ProviderErrorCode = "rate_limited" | "model_error";

/** A failure of the model service itself, as opposed to a bad answer from the model. */
export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** One model behind a thin interface. The agent loop is written against this, not an SDK. */
export interface ModelProvider {
  readonly info: { provider: string; name: string };
  generate(request: ModelRequest): Promise<ModelResponse>;
}

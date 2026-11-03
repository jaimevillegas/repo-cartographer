import type { ZodError } from "zod";

/**
 * What a tool hands back to the agent loop. `content` goes to the model as the tool result;
 * `summary` is the short line shown in the trace. A failure is an ordinary outcome, not an
 * exception: the model reads the error and adjusts its next call.
 */
export type ToolOutcome =
  | { ok: true; content: string; summary: string }
  | { ok: false; error: string };

export const fail = (error: string): ToolOutcome => ({ ok: false, error });

/** Cuts a string to `max` characters, marking the cut. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

const UNITS = ["B", "KB", "MB", "GB"];

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return unit === 0 ? `${bytes} B` : `${value.toFixed(1)} ${UNITS[unit]}`;
}

/** Explains invalid tool arguments to the model so it can fix the call. */
export function describeInputError(error: ZodError): string {
  const problems = error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`);
  return `Invalid arguments: ${problems.join("; ")}`;
}

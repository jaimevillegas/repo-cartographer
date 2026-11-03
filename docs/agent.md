# Agent loop

How a run works once the snapshot exists. The code is in `src/core/agent/` and `src/core/providers/`; nothing here depends on a particular model.

## Flow

1. **Recon** (`recon.ts`): a deterministic overview built without a model: the top of the tree, the build and deploy files, and a digest of `package.json` and Compose files. It goes into the first message, framed as data.
2. **Explore**: the loop calls the model with the system prompt, the conversation so far and the tools. Each reply may contain several tool calls. They run in order against the snapshot and their results go back together.
3. **Submit**: `submit_graph` runs `validateGraph`. Problems come back as the tool result and the model submits again (the repair loop). A valid graph ends the run.

The conversation is append-only: earlier messages are never edited, and provider-specific state such as reasoning blocks travels untouched in `providerState`.

## Limits

| Limit | Default | When reached |
| --- | --- | --- |
| Steps (model calls) | 30 | wrap up |
| File reads | 40 | wrap up |
| Tokens (input plus output, summed over every call) | 600,000 | wrap up |
| Wall-clock time | 180 s | wrap up |
| Submitted graphs | 4 | `run_failed` with `validation_failed` |

**Wrap-up.** When a limit is hit the loop emits `limit_reached`, tells the model to submit the best graph it can support, and offers only `submit_graph`. The model has up to 3 more calls to submit and repair. A graph accepted this way is returned with `partial: true`. If none validates, the run fails with `validation_failed`.

The token limit counts what each call reports, so a long conversation costs more per step. Tune the defaults after measuring real runs.

## Handling a misbehaving model

- **Refusal**: a `refusal` event, then `run_failed` with `refused`.
- **Reply without a tool call**: a nudge to keep exploring or submit. After 3 idle replies in a row the run fails with `model_error`.
- **Reply cut off by the output limit**: none of its tool calls run, since one may be half written. The model gets an error result for each and a request to continue with a shorter step.
- **Tool that does not exist** (for example one a prompt injection asked for): never run. The model gets the list of real tools. The trace shows a failed `tool_result` and no `tool_call`, because the trace schema only accepts the four real tools.
- **Bad tool arguments**: a `tool_call` followed by a failed `tool_result`. The model reads the error and corrects the call.
- **Provider failures**: `rate_limited` and `model_error` pass through. Any other exception becomes `model_error` with a generic message, so internals do not leak into the trace.
- **Cancellation**: stops with `run_failed` (`internal`, "The run was cancelled.").

## Scripted provider

`ScriptedProvider` replaces only the model. The loop, tools, validator and snapshot behind it are real. It takes a list of turns or a function of the request, and can simulate latency, refusals and provider errors.

`buildScenario(name, snapshot)` produces a script for any repository. The tool calls are real, and the graph comes from a simple heuristic (`demo-graph.ts`): one component per top-level area, plus an edge wherever one area imports another. Every citation is a real line, so the graph passes the real validator. It is a demo and a test double, not an analysis.

| Scenario | What it shows |
| --- | --- |
| `success` | Explores and submits a valid graph |
| `repair` | A first graph with a wrong file and a dangling edge, fixed through validator feedback |
| `step_limit` | Explores until the step limit, then submits a partial graph |
| `refusal` | The model declines |
| `rate_limit` | The model service rate limits the run halfway |
| `injection_attempt` | An injected instruction makes the model call a tool that does not exist; the loop refuses it |

Pass `latencyMs` to space the turns out so a trace unfolds like a real run.

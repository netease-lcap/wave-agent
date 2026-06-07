# Contract: evaluateGoal (aiService)

## Description
Lightweight fast-model call to evaluate whether a goal condition has been met. Bypasses the 1 QPS rate limiter. Non-streaming, no tools, max 200 output tokens.

## Parameters
- **gatewayConfig**: `GatewayConfig` (API key, base URL, headers, fetch)
- **modelConfig**: `ModelConfig` (Model configuration with extra params)
- **model**: `string` (The fast model to use)
- **goalCondition**: `string` (The goal condition to evaluate)
- **transcript**: `string` (Condensed conversation transcript)
- **abortSignal**: `AbortSignal | undefined` (For cancellation)

## Returns
- **content**: `string` (Raw response from the fast model, expected to be JSON `{"met": boolean, "reason": "..."}`)
- **usage**: `{ prompt_tokens, completion_tokens, total_tokens } | undefined` (Token usage for tracking)

## Behavior
1. Create OpenAI client with injected configuration.
2. Build messages: system prompt (goal evaluator) + user message (condition + transcript).
3. Non-streaming call with `temperature: 0`, `max_tokens: 200`.
4. No `acquireSlot()` — bypasses 1 QPS rate limiter.
5. On abort: throw "Goal evaluation was aborted".
6. On error: throw with context.

## Response Parsing (in GoalManager)
1. Try `JSON.parse` — expect `{ met: boolean, reason: string }`.
2. Fallback: regex extraction of `"met": (true|false)`.
3. Default: `{ met: false, reason: "Could not parse evaluation response" }`.

/**
 * Agent and service configuration types
 * Dependencies: None
 */

import OpenAI from "openai";
import { PermissionMode } from "./permissions.js";

export interface GatewayConfig {
  apiKey?: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  fetchOptions?: OpenAI["fetchOptions"];
  fetch?: OpenAI["fetch"];
  /** Session identifier, sent as the `x-session-id` request header for backend correlation. */
  sessionId?: string;
}

/** Wire protocol a model's requests use. See `ModelCapabilities.apiType`. */
export type ApiType = "chat" | "responses" | "messages";

export interface ModelCapabilities {
  /** Whether the model supports image/vision input. Default: true. */
  vision?: boolean;
  /** Whether the model supports prompt caching (ephemeral cache_control markers). Default: false. */
  promptCaching?: boolean;
  /**
   * Which wire protocol this model's requests use. Default: `"chat"`.
   *
   * Declared, never inferred from the model name:
   * - `"responses"` — OpenAI Responses API (`${baseURL}/responses`). From GPT-5.4
   *   on, Chat Completions only allows function tools with
   *   `reasoning_effort: "none"`, and the GPT-6 generation has no `none` tier at
   *   all — those models are unusable in Wave until their requests go to the
   *   Responses endpoint (spec core/responses-api.md).
   * - `"messages"` — native Anthropic Messages API (`${baseURL}/messages`).
   *   Required for Claude with extended thinking: the OpenAI-compatible layer
   *   flattens thinking blocks into a plain `reasoning_content` string and drops
   *   the per-block `signature` Anthropic requires to be replayed verbatim
   *   (spec core/anthropic-messages-api.md).
   *
   * Anything outside the union (a typo, `true`, an empty string) resolves to
   * `"chat"` with a warning — never silently to some other protocol.
   */
  apiType?: ApiType;
}

/**
 * One entry of the selectable model list (`Agent.getConfiguredModels`).
 *
 * `supportsVision` mirrors what the agent actually does with image input for
 * that model — resolved from `models[<name>].capabilities.vision`, which is
 * opt-out (unset means supported), so hosts render the picker's badge from this
 * field instead of re-deriving capability rules on their own.
 */
export interface ConfiguredModel {
  /** Model id, same shape as the `model` key / `models` map key in settings.json. */
  name: string;
  /** Whether the model can read images (see `supportsVision`). */
  supportsVision: boolean;
}

export interface ModelConfig {
  model?: string;
  fastModel?: string;
  /** Vision-capable model for image recognition subagents (resolved from WAVE_VISION_MODEL env var). */
  visionModel?: string;
  /** Per-model context window in tokens (input + output of one request). Overrides the global `WAVE_CONTEXT_WINDOW` for this model. */
  contextWindow?: number;
  permissionMode?: PermissionMode;
  capabilities?: ModelCapabilities;
  /** Generation params passed through to the API provider (temperature, thinking, etc.) */
  options?: Record<string, unknown>;
  /** Fast model generation params (resolved from models[fastModel].options) */
  fastModelOptions?: Record<string, unknown>;
  /**
   * Capabilities of the fast model, resolved from `models[fastModel].capabilities`.
   *
   * `capabilities` above belongs to the **agent** model, but a request can run on
   * a different one (`processWebContent` is always called with `fastModel`), so
   * anything that must hold per model — picking the API endpoint above all — has
   * to read the capabilities of the model that will actually serve the request
   * (spec core/responses-api.md 边界情况 8).
   */
  fastModelCapabilities?: ModelCapabilities;
  /**
   * Fast-model-only disable-thinking params passed through verbatim
   * (e.g. `{ thinking: { type: "disabled" } }`). Applied only in fast-model
   * scenarios (webFetch content processing, `model: fastModel` subagents),
   * never in the agent loop. `{}` clears the default.
   */
  disableThinkingOptions?: Record<string, unknown>;
  /**
   * Model used for inline (ghost-text) code completion. Resolved from
   * settings.json `completionModel` / `WAVE_COMPLETION_MODEL`, falling back to
   * `fastModel`. Kept out of `model` on purpose: completion fires on every typing
   * pause, so it must not pay the agent model's latency.
   */
  completionModel?: string;
  /**
   * Generation params for the completion model, resolved from
   * `models[completionModel]` (`options` merged with `disableThinkingOptions` —
   * extended thinking is disqualified for a latency-critical call).
   */
  completionModelOptions?: Record<string, unknown>;
  /** Capabilities of the completion model, resolved from `models[completionModel].capabilities`. */
  completionModelCapabilities?: ModelCapabilities;
  /** Whether inline code completion is enabled. Unset follows the default (enabled). */
  completionEnabled?: boolean;
  /**
   * Whether the next-edit suggestion is enabled. Unset follows the default
   * (disabled): unlike completion it rewrites code the user already wrote, so it
   * ships off until it has been exercised on real edits
   * (spec ui/next-edit-suggestion.md story 6).
   */
  nextEditEnabled?: boolean;
}

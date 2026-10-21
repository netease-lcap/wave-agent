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

export interface ModelCapabilities {
  /** Whether the model supports image/vision input. Default: true. */
  vision?: boolean;
  /** Whether the model supports prompt caching (ephemeral cache_control markers). Default: false. */
  promptCaching?: boolean;
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
  /** Per-model input context window in tokens. Overrides the global `WAVE_MAX_INPUT_TOKENS` for this model. */
  maxInputTokens?: number;
  permissionMode?: PermissionMode;
  capabilities?: ModelCapabilities;
  /** Generation params passed through to the API provider (temperature, thinking, etc.) */
  options?: Record<string, unknown>;
  /** Fast model generation params (resolved from models[fastModel].options) */
  fastModelOptions?: Record<string, unknown>;
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
  /** Whether inline code completion is enabled. Unset follows the default (enabled). */
  completionEnabled?: boolean;
}

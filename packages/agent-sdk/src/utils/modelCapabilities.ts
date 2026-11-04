/**
 * Model Capability Detection
 *
 * Pure declarative capability accessors. Capabilities are configured per-model
 * via the `capabilities` field in `ModelConfig` (settings.json), not via regex
 * or environment variables.
 */

import type { ModelCapabilities } from "../types/config.js";

/**
 * Determines if a model supports prompt caching.
 * @param capabilities - Declarative model capabilities
 * @returns True if promptCaching is explicitly enabled (default: false)
 */
export function supportsPromptCaching(
  capabilities?: ModelCapabilities,
): boolean {
  return capabilities?.promptCaching ?? false;
}

/**
 * Determines if a model supports image/vision recognition.
 * Opt-out semantics: by default all models are assumed to support vision.
 * @param capabilities - Declarative model capabilities
 * @returns True unless vision is explicitly disabled (default: true)
 */
export function supportsVision(capabilities?: ModelCapabilities): boolean {
  return capabilities?.vision ?? true;
}

/**
 * Determines whether a model's requests must go to the Responses API instead of
 * Chat Completions.
 * Opt-in and explicit: no model name is ever matched, so a new model becomes
 * usable by declaring the capability, not by shipping a Wave release.
 * @param capabilities - Declarative model capabilities
 * @returns True only when responsesApi is explicitly enabled (default: false)
 */
export function supportsResponsesApi(
  capabilities?: ModelCapabilities,
): boolean {
  return capabilities?.responsesApi ?? false;
}

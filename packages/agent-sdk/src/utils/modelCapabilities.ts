/**
 * Model Capability Detection
 *
 * Pure declarative capability accessors. Capabilities are configured per-model
 * via the `capabilities` field in `ModelConfig` (settings.json), not via regex
 * or environment variables.
 */

import type { ApiType, ModelCapabilities } from "../types/config.js";
import { logger } from "./globalLogger.js";

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
 * Resolves which wire protocol a model's requests go to.
 *
 * Declared and explicit: no model name is ever matched, so a new model becomes
 * usable by declaring the capability, not by shipping a Wave release.
 *
 * A value outside the union (a typo, `true`, an empty string) is a configuration
 * error the user can only see if we say so — it resolves to `"chat"` and logs a
 * warning rather than silently guessing which protocol was meant
 * (spec core/anthropic-messages-api.md 「按声明为 Claude 模型选择原生 Messages 端点」场景 5).
 *
 * @param capabilities - Declarative model capabilities
 * @returns The declared protocol, defaulting to `"chat"`
 */
export function resolveApiType(capabilities?: ModelCapabilities): ApiType {
  const declared = capabilities?.apiType;
  if (declared === undefined) return "chat";
  if (
    declared === "chat" ||
    declared === "responses" ||
    declared === "messages"
  ) {
    return declared;
  }
  logger.warn(
    `capabilities.apiType is ${JSON.stringify(declared)}, which is not one of "chat" | "responses" | "messages" — falling back to "chat"`,
  );
  return "chat";
}

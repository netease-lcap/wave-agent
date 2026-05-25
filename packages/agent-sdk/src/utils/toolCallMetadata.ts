const STANDARD_TOOL_CALL_KEYS = new Set(["id", "type", "function", "index"]);

const GEMINI_API_TOOL_NAME_PREFIX = "default_api:";

/** Strip Gemini/AIGW prefixes and reject placeholder names used during streaming. */
export function normalizeToolCallName(name: string | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed || trimmed === "unknown") {
    return "";
  }
  if (trimmed.startsWith(GEMINI_API_TOOL_NAME_PREFIX)) {
    return trimmed.slice(GEMINI_API_TOOL_NAME_PREFIX.length);
  }
  return trimmed;
}

export function isValidToolCallName(name: string | undefined): boolean {
  return normalizeToolCallName(name).length > 0;
}

/**
 * Extract non-standard fields from a tool call object (e.g. thought_signature for Gemini 3).
 */
export function extractToolCallMetadata(
  toolCall: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(toolCall)) {
    if (STANDARD_TOOL_CALL_KEYS.has(key) || value === undefined) {
      continue;
    }
    metadata[key] = value;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function mergeToolCallMetadata(
  base: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!incoming || Object.keys(incoming).length === 0) {
    return base;
  }
  return { ...base, ...incoming };
}

/**
 * Pull thought_signature from message-level additionalFields (AIGW may put it there).
 */
/** Attach Gemini extension fields without overwriting id/type/function. */
export function applyToolCallMetadataToResult(
  toolCall: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  },
  metadata?: Record<string, unknown>,
): {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
} & Record<string, unknown> {
  if (!metadata) {
    return toolCall;
  }
  const merged: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  } & Record<string, unknown> = { ...toolCall };
  for (const [key, value] of Object.entries(metadata)) {
    if (
      STANDARD_TOOL_CALL_KEYS.has(key) ||
      key === "name" ||
      value === undefined
    ) {
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

export function getThoughtSignatureFromAdditionalFields(
  additionalFields?: Record<string, unknown>,
): string | undefined {
  if (!additionalFields) {
    return undefined;
  }
  const signature = additionalFields.thought_signature;
  return typeof signature === "string" && signature.length > 0
    ? signature
    : undefined;
}

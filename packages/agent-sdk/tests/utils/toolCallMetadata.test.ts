import { describe, it, expect } from "vitest";
import {
  applyToolCallMetadataToResult,
  extractToolCallMetadata,
  getThoughtSignatureFromAdditionalFields,
  isValidToolCallName,
  mergeToolCallMetadata,
  normalizeToolCallName,
} from "../../src/utils/toolCallMetadata.js";

describe("toolCallMetadata", () => {
  it("extractToolCallMetadata returns thought_signature", () => {
    expect(
      extractToolCallMetadata({
        id: "call_1",
        type: "function",
        function: { name: "Read", arguments: "{}" },
        thought_signature: "sig-123",
      }),
    ).toEqual({ thought_signature: "sig-123" });
  });

  it("getThoughtSignatureFromAdditionalFields reads message-level signature", () => {
    expect(
      getThoughtSignatureFromAdditionalFields({
        thought_signature: "sig-msg",
        forgetDistance: 1,
      }),
    ).toBe("sig-msg");
  });

  it("mergeToolCallMetadata merges without dropping keys", () => {
    expect(
      mergeToolCallMetadata({ thought_signature: "old" }, { extra: "new" }),
    ).toEqual({ thought_signature: "old", extra: "new" });
  });

  it("normalizeToolCallName strips default_api prefix and rejects unknown", () => {
    expect(normalizeToolCallName("default_api:Read")).toBe("Read");
    expect(normalizeToolCallName("unknown")).toBe("");
    expect(normalizeToolCallName("  ")).toBe("");
    expect(isValidToolCallName("Read")).toBe(true);
    expect(isValidToolCallName("unknown")).toBe(false);
  });

  it("applyToolCallMetadataToResult preserves function object", () => {
    const toolCall = {
      id: "call_1",
      type: "function" as const,
      function: { name: "Read", arguments: "{}" },
    };
    const merged = applyToolCallMetadataToResult(toolCall, {
      thought_signature: "sig-123",
      name: "should-not-override",
      function: { name: "broken", arguments: "" },
    });
    expect(merged.function).toEqual({ name: "Read", arguments: "{}" });
    expect(merged.thought_signature).toBe("sig-123");
    expect(merged).not.toHaveProperty("name");
  });
});

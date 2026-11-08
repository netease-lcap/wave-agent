import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveApiType } from "../../src/utils/modelCapabilities.js";
import {
  setGlobalLogger,
  clearGlobalLogger,
} from "../../src/utils/globalLogger.js";
import { createMockLogger, type MockLogger } from "./mockLogger.js";
import type { ModelCapabilities } from "../../src/types/config.js";

describe("resolveApiType", () => {
  let mockLogger: MockLogger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    setGlobalLogger(mockLogger);
  });

  afterEach(() => {
    clearGlobalLogger();
  });

  it("defaults to Chat Completions", () => {
    expect(resolveApiType(undefined)).toBe("chat");
    expect(resolveApiType({})).toBe("chat");
  });

  it("returns each declared protocol as-is", () => {
    expect(resolveApiType({ apiType: "chat" })).toBe("chat");
    expect(resolveApiType({ apiType: "responses" })).toBe("responses");
    expect(resolveApiType({ apiType: "messages" })).toBe("messages");
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("falls back to chat with a warning for a value outside the union", () => {
    // A typo, or the pre-rename boolean — either way the user must be told,
    // because the request goes somewhere they did not ask for.
    expect(
      resolveApiType({ apiType: true } as unknown as ModelCapabilities),
    ).toBe("chat");
    expect(
      resolveApiType({ apiType: "" } as unknown as ModelCapabilities),
    ).toBe("chat");
    expect(
      resolveApiType({ apiType: "Messages" } as unknown as ModelCapabilities),
    ).toBe("chat");
    expect(mockLogger.warn).toHaveBeenCalledTimes(3);
    expect(String(mockLogger.warn.mock.calls[0][0])).toContain(
      "capabilities.apiType is true",
    );
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { callAgent, compressMessages } from "@/services/aiService.js";
import * as fs from "fs";
import { logger } from "@/utils/globalLogger.js";

// Mock OpenAI client
const mockCreate = vi.fn();
const mockOpenAI = {
  chat: {
    completions: {
      create: mockCreate,
    },
  },
};

vi.mock("@/utils/openaiClient.js", () => ({
  OpenAIClient: vi.fn().mockImplementation(function () {
    return mockOpenAI;
  }),
}));

// Mock fs and os for 400 error handling tests
vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    mkdtempSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(),
  };
});

vi.mock("@/utils/globalLogger.js", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("AI Service - Branch Coverage", () => {
  const TEST_GATEWAY_CONFIG = {
    apiKey: "test-api-key",
    baseURL: "http://localhost:test",
  };

  const TEST_MODEL_CONFIG = {
    agentModel: "gpt-4o",
    fastModel: "gpt-4o-mini",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getModelConfig", () => {
    it("should handle gpt-5-codex model", async () => {
      const mockWithResponse = vi.fn().mockResolvedValue({
        data: { choices: [{ message: { content: "hi" } }] },
        response: { headers: new Map() },
      });
      mockCreate.mockReturnValue({ withResponse: mockWithResponse });

      await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [],
        workdir: "/some/path",
        model: "gpt-5-codex-something",
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.temperature).toBeUndefined();
    });

    it("should handle gemini-3-flash model", async () => {
      const mockWithResponse = vi.fn().mockResolvedValue({
        data: { choices: [{ message: { content: "hi" } }] },
        response: { headers: new Map() },
      });
      mockCreate.mockReturnValue({ withResponse: mockWithResponse });

      await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [],
        workdir: "/some/path",
        model: "gemini-3-flash-something",
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.vertexai.thinking_config.thinking_level).toBe("minimal");
    });
  });

  describe("callAgent error handling", () => {
    it("should throw 'Request was aborted' on AbortError", async () => {
      const abortError = new Error("AbortError");
      abortError.name = "AbortError";

      const mockWithResponse = vi.fn().mockRejectedValue(abortError);
      mockCreate.mockReturnValue({ withResponse: mockWithResponse });

      await expect(
        callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: TEST_MODEL_CONFIG,
          messages: [],
          workdir: "/some/path",
        }),
      ).rejects.toThrow("Request was aborted");
    });

    it("should save debug data on 400 error", async () => {
      const error400 = {
        status: 400,
        message: "Bad Request",
        type: "invalid_request_error",
        code: "400",
        body: { detail: "too long" },
        stack: "some stack trace",
      };

      const mockWithResponse = vi.fn().mockRejectedValue(error400);
      mockCreate.mockReturnValue({ withResponse: mockWithResponse });

      vi.mocked(fs.mkdtempSync).mockReturnValue("/tmp/debug-dir");

      await expect(
        callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: TEST_MODEL_CONFIG,
          messages: [{ role: "user", content: "test" }],
          workdir: "/some/path",
          sessionId: "session-123",
          tools: [
            { type: "function", function: { name: "tool1", parameters: {} } },
          ],
        }),
      ).rejects.toEqual(error400);

      expect(fs.mkdtempSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalledTimes(2); // messages.json and error.json
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("400 error occurred"),
        expect.any(String),
      );
    });

    it("should log error if saving debug data fails", async () => {
      const error400 = { status: 400 };
      const mockWithResponse = vi.fn().mockRejectedValue(error400);
      mockCreate.mockReturnValue({ withResponse: mockWithResponse });

      vi.mocked(fs.mkdtempSync).mockImplementation(() => {
        throw new Error("Disk full");
      });

      await expect(
        callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: TEST_MODEL_CONFIG,
          messages: [],
          workdir: "/some/path",
        }),
      ).rejects.toEqual(error400);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to save 400 error debug files"),
        expect.any(Error),
      );
    });
  });

  describe("compressMessages", () => {
    it("should return default message on failure", async () => {
      mockCreate.mockRejectedValue(new Error("API Error"));

      const result = await compressMessages({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [],
      });

      expect(result.content).toBe("Failed to compress conversation history");
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to compress messages"),
        expect.any(Error),
      );
    });

    it("should throw specific error on AbortError", async () => {
      const abortError = new Error("AbortError");
      abortError.name = "AbortError";
      mockCreate.mockRejectedValue(abortError);

      await expect(
        compressMessages({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: TEST_MODEL_CONFIG,
          messages: [],
        }),
      ).rejects.toThrow("Compression request was aborted");
    });

    it("should handle response without usage", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "Summary" } }],
      });

      const result = await compressMessages({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [],
      });

      expect(result.content).toBe("Summary");
      expect(result.usage).toBeUndefined();
    });
  });

  describe("callAgent additional fields", () => {
    it("should capture additional fields from response message", async () => {
      const mockWithResponse = vi.fn().mockResolvedValue({
        data: {
          choices: [
            {
              message: {
                content: "hi",
                role: "assistant",
                unknown_field: "value",
                another_field: 123,
              },
            },
          ],
        },
        response: { headers: new Map() },
      });
      mockCreate.mockReturnValue({ withResponse: mockWithResponse });

      const result = await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [],
        workdir: "/some/path",
      });

      expect(result.additionalFields).toEqual({
        unknown_field: "value",
        another_field: 123,
      });
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  handleLargeOutput,
  LARGE_OUTPUT_TOKEN_THRESHOLD,
} from "../../src/utils/largeOutputHandler.js";
import { writeFile } from "fs/promises";

// Mock fs/promises
vi.mock("fs/promises");
const mockWriteFile = vi.mocked(writeFile);

// Mock os
vi.mock("os", () => ({
  tmpdir: () => "/tmp",
}));

// Mock logger
vi.mock("../../utils/globalLogger.js", () => ({
  logger: {
    warn: vi.fn(),
  },
}));

// Mock token estimator
vi.mock("../../src/utils/tokenEstimator.js", () => ({
  estimateTokenCount: vi.fn(),
  getTokenUsageDescription: vi.fn(),
}));

import {
  estimateTokenCount,
  getTokenUsageDescription,
} from "../../src/utils/tokenEstimator.js";
const mockEstimateTokenCount = vi.mocked(estimateTokenCount);
const mockGetTokenUsageDescription = vi.mocked(getTokenUsageDescription);

describe("largeOutputHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("thresholds", () => {
    it("should have correct token threshold (20k)", () => {
      expect(LARGE_OUTPUT_TOKEN_THRESHOLD).toBe(20000);
    });
  });

  describe("handleLargeOutput", () => {
    beforeEach(() => {
      // Default mock behavior: small output (under token threshold)
      mockEstimateTokenCount.mockReturnValue(100);
      mockGetTokenUsageDescription.mockReturnValue(
        "100 tokens (within 20,000 limit)",
      );
    });

    it("should return content directly for small output", async () => {
      const smallOutput = "Small content";
      mockEstimateTokenCount.mockReturnValue(5);

      const result = await handleLargeOutput(smallOutput);

      expect(result.content).toBe(smallOutput);
      expect(result.filePath).toBeUndefined();
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockEstimateTokenCount).toHaveBeenCalledWith(smallOutput);
    });

    it("should return content directly when under token threshold", async () => {
      const moderateOutput = "X".repeat(10000); // 10KB, assume ~2.5k tokens
      mockEstimateTokenCount.mockReturnValue(2500);

      const result = await handleLargeOutput(moderateOutput);

      expect(result.content).toBe(moderateOutput);
      expect(result.filePath).toBeUndefined();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it("should write to temp file when token threshold exceeded", async () => {
      const tokenHeavyOutput = Array(25000).fill("word ").join(""); // High token count
      mockEstimateTokenCount.mockReturnValue(25000); // Exceeds token threshold
      mockGetTokenUsageDescription.mockReturnValue(
        "25,000 tokens (exceeds 20,000 limit)",
      );
      mockWriteFile.mockResolvedValueOnce(undefined);

      const result = await handleLargeOutput(tokenHeavyOutput);

      expect(result.content).toContain("Large output");
      expect(result.content).toContain("25,000 tokens (exceeds 20,000 limit)");
      expect(result.filePath).toMatch(
        /^\/tmp\/bash-output-\d+-[a-z0-9]+\.txt$/,
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        result.filePath,
        tokenHeavyOutput,
        "utf8",
      );
    });

    it("should return content directly when exactly at token threshold", async () => {
      const exactThresholdOutput = "word ".repeat(20000);
      mockEstimateTokenCount.mockReturnValue(20000); // Exactly at threshold

      const result = await handleLargeOutput(exactThresholdOutput);

      expect(result.content).toBe(exactThresholdOutput);
      expect(result.filePath).toBeUndefined();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it("should write to temp file when token threshold exceeded by 1", async () => {
      const justOverThresholdOutput = "word ".repeat(20001);
      mockEstimateTokenCount.mockReturnValue(20001);
      mockGetTokenUsageDescription.mockReturnValue(
        "20,001 tokens (exceeds 20,000 limit)",
      );
      mockWriteFile.mockResolvedValueOnce(undefined);

      const result = await handleLargeOutput(justOverThresholdOutput);

      expect(result.content).toContain("Large output");
      expect(result.filePath).toBeDefined();
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it("should fallback to direct output if temp file creation fails", async () => {
      const largeOutput = "X".repeat(100000);
      mockEstimateTokenCount.mockReturnValue(25000); // Exceeds token threshold
      mockWriteFile.mockRejectedValueOnce(new Error("Permission denied"));

      const result = await handleLargeOutput(largeOutput);

      expect(result.content).toBe(largeOutput);
      expect(result.filePath).toBeUndefined();
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it("should generate unique temp file names", async () => {
      const largeOutput1 = "word ".repeat(25000);
      const largeOutput2 = "test ".repeat(25000);
      mockEstimateTokenCount.mockReturnValue(25000);
      mockGetTokenUsageDescription.mockReturnValue(
        "25,000 tokens (exceeds 20,000 limit)",
      );
      mockWriteFile.mockResolvedValue(undefined);

      const result1 = await handleLargeOutput(largeOutput1);
      const result2 = await handleLargeOutput(largeOutput2);

      expect(result1.filePath).toBeDefined();
      expect(result2.filePath).toBeDefined();
      expect(result1.filePath).not.toBe(result2.filePath);
    });

    it("should include size and token information in message", async () => {
      const largeOutput = "word ".repeat(25000); // Large output
      const outputSize = largeOutput.length;
      mockEstimateTokenCount.mockReturnValue(25000);
      mockGetTokenUsageDescription.mockReturnValue(
        "25,000 tokens (exceeds 20,000 limit)",
      );
      mockWriteFile.mockResolvedValueOnce(undefined);

      const result = await handleLargeOutput(largeOutput);
      const expectedSizeKB = Math.round(outputSize / 1024);

      expect(result.content).toContain(`${expectedSizeKB} KB`);
      expect(result.content).toContain("25,000 tokens (exceeds 20,000 limit)");
      expect(result.content).toContain("written to temporary file");
    });
  });
});

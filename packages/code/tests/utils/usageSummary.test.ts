import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  calculateTokenSummary,
  displayUsageSummary,
} from "../../src/utils/usageSummary.js";
import type { Usage } from "../../../agent-sdk/src/types.js";

describe("Usage Summary Utilities", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("calculateTokenSummary", () => {
    it("should return empty object for empty usage array", () => {
      const result = calculateTokenSummary([]);
      expect(result).toEqual({});
    });

    it("should calculate summary for single usage entry", () => {
      const usages: Usage[] = [
        {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          model: "gpt-4",
          operation_type: "agent",
        },
      ];

      const result = calculateTokenSummary(usages);

      expect(result).toEqual({
        "gpt-4": {
          model: "gpt-4",
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          operations: {
            agent_calls: 1,
            compressions: 0,
          },
        },
      });
    });

    it("should aggregate multiple entries for the same model", () => {
      const usages: Usage[] = [
        {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          model: "gpt-4",
          operation_type: "agent",
        },
        {
          prompt_tokens: 200,
          completion_tokens: 100,
          total_tokens: 300,
          model: "gpt-4",
          operation_type: "compress",
        },
      ];

      const result = calculateTokenSummary(usages);

      expect(result).toEqual({
        "gpt-4": {
          model: "gpt-4",
          prompt_tokens: 300,
          completion_tokens: 150,
          total_tokens: 450,
          operations: {
            agent_calls: 1,
            compressions: 1,
          },
        },
      });
    });

    it("should handle multiple different models", () => {
      const usages: Usage[] = [
        {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          model: "gpt-4",
          operation_type: "agent",
        },
        {
          prompt_tokens: 200,
          completion_tokens: 100,
          total_tokens: 300,
          model: "gpt-3.5-turbo",
          operation_type: "compress",
        },
        {
          prompt_tokens: 150,
          completion_tokens: 75,
          total_tokens: 225,
          model: "gpt-4",
          operation_type: "agent",
        },
      ];

      const result = calculateTokenSummary(usages);

      // Should be sorted by total tokens (descending)
      expect(result).toEqual({
        "gpt-4": {
          model: "gpt-4",
          prompt_tokens: 250,
          completion_tokens: 125,
          total_tokens: 375,
          operations: {
            agent_calls: 2,
            compressions: 0,
          },
        },
        "gpt-3.5-turbo": {
          model: "gpt-3.5-turbo",
          prompt_tokens: 200,
          completion_tokens: 100,
          total_tokens: 300,
          operations: {
            agent_calls: 0,
            compressions: 1,
          },
        },
      });
    });

    it("should handle usage with zero tokens", () => {
      const usages: Usage[] = [
        {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          model: "gpt-4",
          operation_type: "agent",
        },
      ];

      const result = calculateTokenSummary(usages);

      expect(result).toEqual({
        "gpt-4": {
          model: "gpt-4",
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          operations: {
            agent_calls: 1,
            compressions: 0,
          },
        },
      });
    });

    it("should handle missing model field", () => {
      const usages: Usage[] = [
        {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          model: "",
          operation_type: "agent",
        },
      ];

      const result = calculateTokenSummary(usages);

      expect(result).toEqual({
        unknown: {
          model: "unknown",
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          operations: {
            agent_calls: 1,
            compressions: 0,
          },
        },
      });
    });

    it("should sort results by total tokens descending", () => {
      const usages: Usage[] = [
        {
          prompt_tokens: 50,
          completion_tokens: 25,
          total_tokens: 75,
          model: "model-small",
          operation_type: "agent",
        },
        {
          prompt_tokens: 200,
          completion_tokens: 100,
          total_tokens: 300,
          model: "model-large",
          operation_type: "agent",
        },
        {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          model: "model-medium",
          operation_type: "agent",
        },
      ];

      const result = calculateTokenSummary(usages);
      const modelOrder = Object.keys(result);

      expect(modelOrder).toEqual([
        "model-large",
        "model-medium",
        "model-small",
      ]);
    });
  });

  describe("displayUsageSummary", () => {
    it("should display nothing for empty usage array", () => {
      displayUsageSummary([]);
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it("should display summary for single model", () => {
      const usages: Usage[] = [
        {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          model: "gpt-4",
          operation_type: "agent",
        },
      ];

      displayUsageSummary(usages);

      expect(consoleSpy).toHaveBeenCalledWith("\nToken Usage Summary:");
      expect(consoleSpy).toHaveBeenCalledWith("==================");
      expect(consoleSpy).toHaveBeenCalledWith("Model: gpt-4");
      expect(consoleSpy).toHaveBeenCalledWith("  Prompt tokens: 100");
      expect(consoleSpy).toHaveBeenCalledWith("  Completion tokens: 50");
      expect(consoleSpy).toHaveBeenCalledWith("  Total tokens: 150");
      expect(consoleSpy).toHaveBeenCalledWith(
        "  Operations: 1 agent calls, 0 compressions",
      );
    });

    it("should display summary for multiple models with overall total", () => {
      const usages: Usage[] = [
        {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          model: "gpt-4",
          operation_type: "agent",
        },
        {
          prompt_tokens: 200,
          completion_tokens: 100,
          total_tokens: 300,
          model: "gpt-3.5-turbo",
          operation_type: "compress",
        },
      ];

      displayUsageSummary(usages);

      expect(consoleSpy).toHaveBeenCalledWith("\nToken Usage Summary:");
      expect(consoleSpy).toHaveBeenCalledWith("==================");

      // Should display both models (ordered by total tokens, highest first)
      expect(consoleSpy).toHaveBeenCalledWith("Model: gpt-3.5-turbo");
      expect(consoleSpy).toHaveBeenCalledWith("  Prompt tokens: 200");
      expect(consoleSpy).toHaveBeenCalledWith("  Completion tokens: 100");
      expect(consoleSpy).toHaveBeenCalledWith("  Total tokens: 300");
      expect(consoleSpy).toHaveBeenCalledWith(
        "  Operations: 0 agent calls, 1 compressions",
      );

      expect(consoleSpy).toHaveBeenCalledWith("Model: gpt-4");
      expect(consoleSpy).toHaveBeenCalledWith("  Prompt tokens: 100");
      expect(consoleSpy).toHaveBeenCalledWith("  Completion tokens: 50");
      expect(consoleSpy).toHaveBeenCalledWith("  Total tokens: 150");
      expect(consoleSpy).toHaveBeenCalledWith(
        "  Operations: 1 agent calls, 0 compressions",
      );

      // Should display overall total
      expect(consoleSpy).toHaveBeenCalledWith("Overall Total:");
      expect(consoleSpy).toHaveBeenCalledWith("  Prompt tokens: 300");
      expect(consoleSpy).toHaveBeenCalledWith("  Completion tokens: 150");
      expect(consoleSpy).toHaveBeenCalledWith("  Total tokens: 450");
      expect(consoleSpy).toHaveBeenCalledWith(
        "  Operations: 1 agent calls, 1 compressions",
      );
    });

    it("should handle large numbers with locale formatting", () => {
      const usages: Usage[] = [
        {
          prompt_tokens: 1000000,
          completion_tokens: 500000,
          total_tokens: 1500000,
          model: "gpt-4",
          operation_type: "agent",
        },
      ];

      displayUsageSummary(usages);

      expect(consoleSpy).toHaveBeenCalledWith("  Prompt tokens: 1,000,000");
      expect(consoleSpy).toHaveBeenCalledWith("  Completion tokens: 500,000");
      expect(consoleSpy).toHaveBeenCalledWith("  Total tokens: 1,500,000");
    });

    it("should handle zero tokens gracefully", () => {
      const usages: Usage[] = [
        {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          model: "gpt-4",
          operation_type: "agent",
        },
      ];

      displayUsageSummary(usages);

      expect(consoleSpy).toHaveBeenCalledWith("Model: gpt-4");
      expect(consoleSpy).toHaveBeenCalledWith("  Prompt tokens: 0");
      expect(consoleSpy).toHaveBeenCalledWith("  Completion tokens: 0");
      expect(consoleSpy).toHaveBeenCalledWith("  Total tokens: 0");
      expect(consoleSpy).toHaveBeenCalledWith(
        "  Operations: 1 agent calls, 0 compressions",
      );
    });
  });

  describe("TokenSummary type integration", () => {
    it("should produce valid TokenSummary objects", () => {
      const usages: Usage[] = [
        {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          model: "gpt-4",
          operation_type: "agent",
        },
      ];

      const result = calculateTokenSummary(usages);

      // Verify the structure matches TokenSummary interface
      expect(result).toEqual(
        expect.objectContaining({
          "gpt-4": expect.objectContaining({
            model: expect.any(String),
            prompt_tokens: expect.any(Number),
            completion_tokens: expect.any(Number),
            total_tokens: expect.any(Number),
            operations: expect.objectContaining({
              agent_calls: expect.any(Number),
              compressions: expect.any(Number),
            }),
          }),
        }),
      );
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadSubagentConfigurations,
  BUILTIN_SUBAGENTS,
} from "../../src/utils/subagentParser.js";

// Mock the filesystem operations
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

// Mock the logger
vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe("SubagentParser with Built-ins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loadSubagentConfigurations", () => {
    it("should include built-in subagents in results", async () => {
      const mockFs = await import("fs");

      vi.mocked(mockFs.readdirSync).mockImplementation(() => {
        return [] as unknown as ReturnType<typeof import("fs").readdirSync>;
      });

      vi.mocked(mockFs.statSync).mockReturnValue({
        isFile: () => true,
      } as import("fs").Stats);

      const configs = await loadSubagentConfigurations("/test/workdir");

      // Should have at least the 4 builtin subagents
      expect(configs.length).toBeGreaterThanOrEqual(4);

      const explore = configs.find((c) => c.name === "Explore");
      expect(explore).toBeDefined();
      expect(explore?.scope).toBe("builtin");
      expect(explore?.priority).toBe(3);
      expect(explore?.model).toBe("fastModel");
    });

    it("should have built-in subagents with lowest priority", async () => {
      const mockFs = await import("fs");

      vi.mocked(mockFs.readdirSync).mockImplementation(() => {
        return [] as unknown as ReturnType<typeof import("fs").readdirSync>;
      });

      vi.mocked(mockFs.statSync).mockReturnValue({
        isFile: () => true,
      } as import("fs").Stats);

      const configs = await loadSubagentConfigurations("/test/workdir");

      const builtin = configs.find((c) => c.scope === "builtin");
      expect(builtin?.priority).toBe(3);
    });

    it("should handle priority override correctly", async () => {
      const mockFs = await import("fs");

      // Mock HOME environment variable
      const originalHome = process.env.HOME;
      process.env.HOME = "/home/testuser";

      vi.mocked(mockFs.readdirSync).mockImplementation((dirPath) => {
        if (dirPath === "/home/testuser/.wave/agents") {
          return ["explore.md"] as unknown as ReturnType<
            typeof import("fs").readdirSync
          >;
        }
        return [] as unknown as ReturnType<typeof import("fs").readdirSync>;
      });

      vi.mocked(mockFs.statSync).mockReturnValue({
        isFile: () => true,
      } as import("fs").Stats);

      vi.mocked(mockFs.readFileSync).mockImplementation((filePath) => {
        if (filePath === "/home/testuser/.wave/agents/explore.md") {
          return `---
name: explore
description: Custom Explore agent
---
Custom system prompt for user override`;
        }
        return "";
      });

      const configs = await loadSubagentConfigurations("/test/workdir");

      // Restore HOME
      process.env.HOME = originalHome;

      // Should find the user config, not the built-in (higher priority)
      const exploreConfig = configs.find((c) => c.name === "explore");
      expect(exploreConfig?.scope).toBe("user"); // User config overrides built-in
      expect(exploreConfig?.priority).toBe(2); // User priority
      expect(exploreConfig?.systemPrompt).toBe(
        "Custom system prompt for user override",
      );
    });
  });

  describe("BUILTIN_SUBAGENTS", () => {
    it("should export 4 builtin subagents", () => {
      expect(BUILTIN_SUBAGENTS).toHaveLength(4);
    });

    it("should have Explore subagent with correct config", () => {
      const explore = BUILTIN_SUBAGENTS.find((s) => s.name === "Explore");
      expect(explore).toBeDefined();
      expect(explore?.model).toBe("fastModel");
      expect(explore?.tools).toContain("Glob");
      expect(explore?.tools).toContain("Grep");
      expect(explore?.tools).toContain("Read");
      expect(explore?.tools).toContain("Bash");
      expect(explore?.tools).toContain("LSP");
    });

    it("should have Bash subagent with correct config", () => {
      const bash = BUILTIN_SUBAGENTS.find((s) => s.name === "Bash");
      expect(bash).toBeDefined();
      expect(bash?.model).toBe("inherit");
      expect(bash?.tools).toEqual(["Bash"]);
    });

    it("should have Plan subagent with correct config", () => {
      const plan = BUILTIN_SUBAGENTS.find((s) => s.name === "Plan");
      expect(plan).toBeDefined();
      expect(plan?.model).toBe("inherit");
      expect(plan?.tools).toContain("Glob");
      expect(plan?.tools).toContain("Grep");
      expect(plan?.tools).toContain("Read");
      expect(plan?.tools).toContain("Bash");
      expect(plan?.tools).toContain("LSP");
    });

    it("should have general-purpose subagent with correct config", () => {
      const gp = BUILTIN_SUBAGENTS.find((s) => s.name === "general-purpose");
      expect(gp).toBeDefined();
      expect(gp?.tools).toBeUndefined();
    });
  });
});

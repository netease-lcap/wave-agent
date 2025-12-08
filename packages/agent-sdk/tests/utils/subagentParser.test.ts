import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadSubagentConfigurations } from "../../src/utils/subagentParser.js";
import * as builtinSubagents from "../../src/utils/builtinSubagents.js";

// Mock the filesystem operations
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

// Mock the builtin subagents module
vi.mock("../../src/utils/builtinSubagents.js", () => ({
  getBuiltinSubagents: vi.fn(),
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

    // Setup default builtin subagents mock
    vi.mocked(builtinSubagents.getBuiltinSubagents).mockReturnValue([
      {
        name: "Explore",
        description: "Built-in codebase exploration agent",
        systemPrompt: "You are a file search specialist...",
        tools: ["Glob", "Grep", "Read", "Bash"],
        model: "fastModel",
        filePath: "<builtin:Explore>",
        scope: "builtin",
        priority: 3,
      },
    ]);
  });

  describe("loadSubagentConfigurations", () => {
    it("should include built-in subagents in results", async () => {
      const configs = await loadSubagentConfigurations("/test/workdir");

      expect(builtinSubagents.getBuiltinSubagents).toHaveBeenCalled();
      expect(configs).toHaveLength(1);

      const explore = configs.find((c) => c.name === "Explore");
      expect(explore).toBeDefined();
      expect(explore?.scope).toBe("builtin");
      expect(explore?.priority).toBe(3);
    });

    it("should have built-in subagents with lowest priority", async () => {
      const configs = await loadSubagentConfigurations("/test/workdir");

      const builtin = configs.find((c) => c.scope === "builtin");
      expect(builtin?.priority).toBe(3);
    });

    it("should sort configurations by priority then name", async () => {
      // Mock multiple built-in subagents
      vi.mocked(builtinSubagents.getBuiltinSubagents).mockReturnValue([
        {
          name: "z-explore",
          description: "Z agent",
          systemPrompt: "test",
          filePath: "<builtin:z-explore>",
          scope: "builtin",
          priority: 3,
        },
        {
          name: "a-explore",
          description: "A agent",
          systemPrompt: "test",
          filePath: "<builtin:a-explore>",
          scope: "builtin",
          priority: 3,
        },
      ]);

      const configs = await loadSubagentConfigurations("/test/workdir");

      expect(configs).toHaveLength(2);
      expect(configs[0].name).toBe("a-explore"); // Alphabetical order for same priority
      expect(configs[1].name).toBe("z-explore");
    });

    it("should handle empty built-in subagents gracefully", async () => {
      vi.mocked(builtinSubagents.getBuiltinSubagents).mockReturnValue([]);

      const configs = await loadSubagentConfigurations("/test/workdir");

      expect(configs).toHaveLength(0);
    });

    it("should use virtual filePath for built-in subagents", async () => {
      const configs = await loadSubagentConfigurations("/test/workdir");

      const builtin = configs.find((c) => c.scope === "builtin");
      expect(builtin?.filePath).toBe("<builtin:Explore>");
      expect(builtin?.filePath.startsWith("<builtin:")).toBe(true);
      expect(builtin?.filePath.endsWith(">")).toBe(true);
    });

    it("should handle priority override correctly", async () => {
      // Mock user/project configs with same name as built-in
      const mockFs = await import("fs");

      // Mock HOME environment variable
      const originalHome = process.env.HOME;
      process.env.HOME = "/home/testuser";

      vi.mocked(mockFs.readdirSync).mockImplementation((dirPath) => {
        // Return explore.md for user directory only (/home/testuser/.wave/agents)
        if (dirPath === "/home/testuser/.wave/agents") {
          return ["explore.md"] as unknown as ReturnType<
            typeof import("fs").readdirSync
          >;
        }
        // Return empty for project directory (/test/workdir/.wave/agents)
        if (dirPath === "/test/workdir/.wave/agents") {
          return [] as unknown as ReturnType<typeof import("fs").readdirSync>;
        }
        // Throw error for any other directory to trigger catch blocks
        const error = new Error(
          "ENOENT: no such file or directory",
        ) as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      });

      vi.mocked(mockFs.statSync).mockReturnValue({
        isFile: () => true,
      } as import("fs").Stats);

      vi.mocked(mockFs.readFileSync).mockImplementation((filePath) => {
        if (filePath === "/home/testuser/.wave/agents/explore.md") {
          return `---
name: Explore
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
      const exploreConfig = configs.find((c) => c.name === "Explore");
      expect(exploreConfig?.scope).toBe("user"); // User config overrides built-in
      expect(exploreConfig?.priority).toBe(2); // User priority
      expect(exploreConfig?.systemPrompt).toBe(
        "Custom system prompt for user override",
      );
    });

    it("should validate built-in subagents have lowest priority", async () => {
      // Add mixed priority configs for testing
      vi.mocked(builtinSubagents.getBuiltinSubagents).mockReturnValue([
        {
          name: "Explore",
          description: "Built-in agent",
          systemPrompt: "builtin prompt",
          filePath: "<builtin:Explore>",
          scope: "builtin",
          priority: 3,
        },
        {
          name: "TestAgent",
          description: "Test agent",
          systemPrompt: "test prompt",
          filePath: "<builtin:TestAgent>",
          scope: "builtin",
          priority: 3,
        },
      ]);

      const configs = await loadSubagentConfigurations("/test/workdir");

      // All built-in subagents should have priority 3
      const builtinConfigs = configs.filter((c) => c.scope === "builtin");
      builtinConfigs.forEach((config) => {
        expect(config.priority).toBe(3);
      });
    });
  });
});

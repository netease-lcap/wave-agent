import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadSubagentConfigurations } from "../../src/utils/subagentParser.js";
import * as configPaths from "../../src/utils/configPaths.js";

// Mock the filesystem operations
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

// Mock the config paths
vi.mock("../../src/utils/configPaths.js", () => ({
  getBuiltinSubagentsDir: vi.fn(),
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

    // Setup default builtin subagents dir mock
    vi.mocked(configPaths.getBuiltinSubagentsDir).mockReturnValue(
      "/builtin/subagents",
    );
  });

  describe("loadSubagentConfigurations", () => {
    it("should include built-in subagents in results", async () => {
      const mockFs = await import("fs");

      vi.mocked(mockFs.readdirSync).mockImplementation((dirPath) => {
        if (dirPath === "/builtin/subagents") {
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
        if (filePath === "/builtin/subagents/explore.md") {
          return `---
description: Built-in codebase exploration agent
tools: [Glob, Grep, Read, Bash]
model: fastModel
---
You are a file search specialist...`;
        }
        return "";
      });

      const configs = await loadSubagentConfigurations("/test/workdir");

      expect(configs).toHaveLength(1);

      const explore = configs.find((c) => c.name === "explore");
      expect(explore).toBeDefined();
      expect(explore?.scope).toBe("builtin");
      expect(explore?.priority).toBe(3);
      expect(explore?.model).toBe("fastModel");
    });

    it("should have built-in subagents with lowest priority", async () => {
      const mockFs = await import("fs");

      vi.mocked(mockFs.readdirSync).mockImplementation((dirPath) => {
        if (dirPath === "/builtin/subagents") {
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
        if (filePath === "/builtin/subagents/explore.md") {
          return `---
description: Built-in codebase exploration agent
---
test`;
        }
        return "";
      });

      const configs = await loadSubagentConfigurations("/test/workdir");

      const builtin = configs.find((c) => c.scope === "builtin");
      expect(builtin?.priority).toBe(3);
    });

    it("should sort configurations by priority then name", async () => {
      const mockFs = await import("fs");

      vi.mocked(mockFs.readdirSync).mockImplementation((dirPath) => {
        if (dirPath === "/builtin/subagents") {
          return ["z-explore.md", "a-explore.md"] as unknown as ReturnType<
            typeof import("fs").readdirSync
          >;
        }
        return [] as unknown as ReturnType<typeof import("fs").readdirSync>;
      });

      vi.mocked(mockFs.statSync).mockReturnValue({
        isFile: () => true,
      } as import("fs").Stats);

      vi.mocked(mockFs.readFileSync).mockImplementation(() => {
        return `---
description: test agent
---
test`;
      });

      const configs = await loadSubagentConfigurations("/test/workdir");

      expect(configs).toHaveLength(2);
      expect(configs[0].name).toBe("a-explore"); // Alphabetical order for same priority
      expect(configs[1].name).toBe("z-explore");
    });

    it("should handle priority override correctly", async () => {
      const mockFs = await import("fs");

      // Mock HOME environment variable
      const originalHome = process.env.HOME;
      process.env.HOME = "/home/testuser";

      vi.mocked(mockFs.readdirSync).mockImplementation((dirPath) => {
        if (dirPath === "/builtin/subagents") {
          return ["explore.md"] as unknown as ReturnType<
            typeof import("fs").readdirSync
          >;
        }
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
        if (filePath === "/builtin/subagents/explore.md") {
          return `---
description: Built-in agent
---
builtin prompt`;
        }
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

    it("should load subagents from .claude/agents directories", async () => {
      const mockFs = await import("fs");
      const originalHome = process.env.HOME;
      process.env.HOME = "/home/testuser";

      vi.mocked(mockFs.readdirSync).mockImplementation((dirPath) => {
        if (dirPath === "/home/testuser/.claude/agents") {
          return ["claude-agent.md"] as unknown as ReturnType<
            typeof import("fs").readdirSync
          >;
        }
        if (dirPath === "/test/workdir/.claude/agents") {
          return ["project-claude-agent.md"] as unknown as ReturnType<
            typeof import("fs").readdirSync
          >;
        }
        return [] as unknown as ReturnType<typeof import("fs").readdirSync>;
      });

      vi.mocked(mockFs.statSync).mockReturnValue({
        isFile: () => true,
      } as import("fs").Stats);

      vi.mocked(mockFs.readFileSync).mockImplementation((filePath) => {
        if (filePath === "/home/testuser/.claude/agents/claude-agent.md") {
          return `---
description: User-level Claude agent
---
Claude agent system prompt`;
        }
        if (
          filePath === "/test/workdir/.claude/agents/project-claude-agent.md"
        ) {
          return `---
description: Project-level Claude agent
---
Project Claude agent system prompt`;
        }
        return "";
      });

      const configs = await loadSubagentConfigurations("/test/workdir");

      process.env.HOME = originalHome;

      const userClaudeAgent = configs.find((c) => c.name === "claude-agent");
      expect(userClaudeAgent).toBeDefined();
      expect(userClaudeAgent?.scope).toBe("user");
      expect(userClaudeAgent?.description).toBe("User-level Claude agent");

      const projectClaudeAgent = configs.find(
        (c) => c.name === "project-claude-agent",
      );
      expect(projectClaudeAgent).toBeDefined();
      expect(projectClaudeAgent?.scope).toBe("project");
      expect(projectClaudeAgent?.description).toBe(
        "Project-level Claude agent",
      );
    });

    it("should let .wave/agents override .claude/agents for same-named agent", async () => {
      const mockFs = await import("fs");
      const originalHome = process.env.HOME;
      process.env.HOME = "/home/testuser";

      vi.mocked(mockFs.readdirSync).mockImplementation((dirPath) => {
        if (
          dirPath === "/home/testuser/.claude/agents" ||
          dirPath === "/home/testuser/.wave/agents"
        ) {
          return ["shared-agent.md"] as unknown as ReturnType<
            typeof import("fs").readdirSync
          >;
        }
        return [] as unknown as ReturnType<typeof import("fs").readdirSync>;
      });

      vi.mocked(mockFs.statSync).mockReturnValue({
        isFile: () => true,
      } as import("fs").Stats);

      vi.mocked(mockFs.readFileSync).mockImplementation((filePath) => {
        if (filePath === "/home/testuser/.claude/agents/shared-agent.md") {
          return `---
name: shared-agent
description: Claude version
---
Claude version prompt`;
        }
        if (filePath === "/home/testuser/.wave/agents/shared-agent.md") {
          return `---
name: shared-agent
description: Wave version
---
Wave version prompt`;
        }
        return "";
      });

      const configs = await loadSubagentConfigurations("/test/workdir");

      process.env.HOME = originalHome;

      const agent = configs.find((c) => c.name === "shared-agent");
      expect(agent).toBeDefined();
      expect(agent?.description).toBe("Wave version");
      expect(agent?.systemPrompt).toBe("Wave version prompt");
    });
  });
});

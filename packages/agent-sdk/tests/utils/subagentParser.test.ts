import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadSubagentConfigurations,
  BUILTIN_SUBAGENTS,
  parseAgentFile,
  findSubagentByName,
} from "../../src/utils/subagentParser.js";
import * as fs from "fs";

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

    it("should handle project subagent overriding builtin", async () => {
      const mockFs = await import("fs");

      vi.mocked(mockFs.readdirSync).mockImplementation((dirPath) => {
        if (dirPath === "/test/workdir/.wave/agents") {
          return ["Bash.md"] as unknown as ReturnType<
            typeof import("fs").readdirSync
          >;
        }
        return [] as unknown as ReturnType<typeof import("fs").readdirSync>;
      });

      vi.mocked(mockFs.statSync).mockReturnValue({
        isFile: () => true,
      } as import("fs").Stats);

      vi.mocked(mockFs.readFileSync).mockImplementation((filePath) => {
        if ((filePath as string).includes("Bash.md")) {
          return `---
name: Bash
description: Custom Bash agent
---
Custom bash prompt`;
        }
        return "";
      });

      const configs = await loadSubagentConfigurations("/test/workdir");

      const bash = configs.find((c) => c.name === "Bash");
      expect(bash?.scope).toBe("project");
      expect(bash?.priority).toBe(1);
    });

    it("should handle project agent overriding built-in with different name", async () => {
      const mockFs = await import("fs");

      vi.mocked(mockFs.readdirSync).mockImplementation((dirPath) => {
        if (dirPath === "/test/workdir/.wave/agents") {
          return ["custom.md"] as unknown as ReturnType<
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
name: custom-agent
description: A custom agent
---
Custom prompt`;
      });

      const configs = await loadSubagentConfigurations("/test/workdir");
      const custom = configs.find((c) => c.name === "custom-agent");
      expect(custom?.scope).toBe("project");
      expect(custom?.priority).toBe(1);
    });

    it("should handle user agent with tools array", async () => {
      const mockFs = await import("fs");

      const originalHome = process.env.HOME;
      process.env.HOME = "/home/testuser";

      vi.mocked(mockFs.readdirSync).mockImplementation((dirPath) => {
        if (dirPath === "/home/testuser/.wave/agents") {
          return ["coder.md"] as unknown as ReturnType<
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
name: coder
description: Coding agent
tools: [Bash, Read, Write]
---
You are a coding agent.`;
      });

      const configs = await loadSubagentConfigurations("/test/workdir");
      process.env.HOME = originalHome;

      const coder = configs.find((c) => c.name === "coder");
      expect(coder?.tools).toEqual(["Bash", "Read", "Write"]);
    });

    it("should handle directory that does not exist gracefully", async () => {
      const mockFs = await import("fs");

      vi.mocked(mockFs.readdirSync).mockImplementation(() => {
        throw new Error("ENOENT: no such file or directory");
      });

      vi.mocked(mockFs.statSync).mockReturnValue({
        isFile: () => true,
      } as import("fs").Stats);

      const configs = await loadSubagentConfigurations("/test/workdir");
      // Should still return builtin configs even if dirs don't exist
      expect(configs.length).toBeGreaterThanOrEqual(4);
    });

    it("should skip non-md files in agent directories", async () => {
      const mockFs = await import("fs");

      vi.mocked(mockFs.readdirSync).mockImplementation((dirPath) => {
        if (dirPath === "/test/workdir/.wave/agents") {
          return ["agent.md", "notes.txt", "readme"] as unknown as ReturnType<
            typeof import("fs").readdirSync
          >;
        }
        return [] as unknown as ReturnType<typeof import("fs").readdirSync>;
      });

      vi.mocked(mockFs.statSync).mockReturnValue({
        isFile: () => true,
      } as import("fs").Stats);

      vi.mocked(mockFs.readFileSync).mockImplementation((filePath) => {
        if ((filePath as string).endsWith("agent.md")) {
          return `---
name: agent
description: An agent
---
System prompt`;
        }
        return "";
      });

      const configs = await loadSubagentConfigurations("/test/workdir");
      const agent = configs.find((c) => c.name === "agent");
      expect(agent?.scope).toBe("project");
      // Should only have 1 project config (not txt or no-extension files)
      const projectConfigs = configs.filter((c) => c.scope === "project");
      expect(projectConfigs).toHaveLength(1);
    });

    it("should warn on parse error but continue loading other agents", async () => {
      const mockFs = await import("fs");
      const { logger } = await import("../../src/utils/globalLogger.js");

      vi.mocked(mockFs.readdirSync).mockImplementation((dirPath) => {
        if (dirPath === "/test/workdir/.wave/agents") {
          return ["bad.md", "good.md"] as unknown as ReturnType<
            typeof import("fs").readdirSync
          >;
        }
        return [] as unknown as ReturnType<typeof import("fs").readdirSync>;
      });

      vi.mocked(mockFs.statSync).mockReturnValue({
        isFile: () => true,
      } as import("fs").Stats);

      vi.mocked(mockFs.readFileSync).mockImplementation((filePath) => {
        if ((filePath as string).includes("bad.md")) {
          return `---
name: 123-invalid
description: Bad name
---
System prompt`;
        }
        return `---
name: good
description: Good agent
---
Good prompt`;
      });

      const configs = await loadSubagentConfigurations("/test/workdir");

      // Should have warned about the bad file
      expect(vi.mocked(logger.warn).mock.calls.length).toBeGreaterThan(0);
      // But should still load the good one
      const good = configs.find((c) => c.name === "good");
      expect(good?.scope).toBe("project");
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

  describe("parseAgentFile", () => {
    it("should parse plugin agent file and substitute WAVE_PLUGIN_ROOT", () => {
      vi.mocked(fs.readFileSync).mockReturnValue(`---
name: plugin-agent
description: A plugin agent
---
Plugin root is \${WAVE_PLUGIN_ROOT}`);

      const result = parseAgentFile(
        "/plugin/skills/test/AGENT.md",
        "plugin",
        "/plugin/root",
      );

      expect(result.name).toBe("plugin-agent");
      expect(result.systemPrompt).toContain("Plugin root is /plugin/root");
      expect(result.pluginRoot).toBe("/plugin/root");
      expect(result.priority).toBe(2);
    });

    it("should parse plugin agent without WAVE_PLUGIN_ROOT placeholder", () => {
      vi.mocked(fs.readFileSync).mockReturnValue(`---
name: simple-plugin
description: Simple plugin agent
---
A simple prompt without placeholder`);

      const result = parseAgentFile(
        "/plugin/skills/simple/AGENT.md",
        "plugin",
        "/plugin/root",
      );

      expect(result.name).toBe("simple-plugin");
      expect(result.systemPrompt).toBe("A simple prompt without placeholder");
      expect(result.pluginRoot).toBe("/plugin/root");
    });

    it("should throw error when parsing invalid plugin agent", () => {
      vi.mocked(fs.readFileSync).mockReturnValue(`---
name: invalid name!
description: Bad name
---
Some prompt`);

      expect(() =>
        parseAgentFile("/plugin/skills/bad/AGENT.md", "plugin", "/plugin/root"),
      ).toThrow(/Failed to parse subagent file/);
    });
  });

  describe("findSubagentByName", () => {
    it("should find builtin subagent by name", async () => {
      const mockFs = await import("fs");

      vi.mocked(mockFs.readdirSync).mockImplementation(() => []);
      vi.mocked(mockFs.statSync).mockReturnValue({
        isFile: () => true,
      } as import("fs").Stats);

      const result = await findSubagentByName("Explore", "/test/workdir");
      expect(result).not.toBeNull();
      expect(result?.scope).toBe("builtin");
    });

    it("should return null when subagent not found", async () => {
      const mockFs = await import("fs");

      vi.mocked(mockFs.readdirSync).mockImplementation(() => []);
      vi.mocked(mockFs.statSync).mockReturnValue({
        isFile: () => true,
      } as import("fs").Stats);

      const result = await findSubagentByName("nonexistent", "/test/workdir");
      expect(result).toBeNull();
    });

    it("should find project subagent overriding builtin", async () => {
      const mockFs = await import("fs");

      vi.mocked(mockFs.readdirSync).mockImplementation((dirPath) => {
        if (dirPath === "/test/workdir/.wave/agents") {
          return ["Bash.md"] as unknown as ReturnType<
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
name: Bash
description: Custom Bash
---
Custom prompt`;
      });

      const result = await findSubagentByName("Bash", "/test/workdir");
      expect(result).not.toBeNull();
      expect(result?.scope).toBe("project");
    });
  });
});

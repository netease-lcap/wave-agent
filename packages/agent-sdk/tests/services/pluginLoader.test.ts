import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { PluginLoader } from "../../src/services/pluginLoader.js";
import { scanCommandsDirectory } from "../../src/utils/customCommands.js";
import { CustomSlashCommand } from "../../src/types/index.js";
import { parseSkillFile } from "../../src/utils/skillParser.js";
import { parseAgentFile } from "../../src/utils/subagentParser.js";
import { resolveMcpConfig } from "../../src/managers/mcpManager.js";

vi.mock("fs/promises");
vi.mock("path");
vi.mock("../../src/utils/customCommands.js");
vi.mock("../../src/utils/skillParser.js");
vi.mock("../../src/utils/subagentParser.js");
vi.mock("../../src/managers/mcpManager.js", () => ({
  resolveMcpConfig: vi.fn((config) => {
    // Simulate env var expansion for headers
    const result = JSON.parse(JSON.stringify(config));
    for (const server of Object.values(result.mcpServers) as Array<{
      headers?: Record<string, string>;
    }>) {
      if (server.headers) {
        for (const [key, value] of Object.entries(server.headers)) {
          server.headers[key] = value.replace(
            /\$\{([^}]+)\}/g,
            (_match, varName) => process.env[varName] ?? "",
          );
        }
      }
    }
    return result;
  }),
}));

describe("PluginLoader", () => {
  const mockPluginPath = "/mock/plugin/path";
  const mockManifestPath = "/mock/plugin/path/.wave-plugin/plugin.json";

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock path.join to return a predictable string
    vi.mocked(path.join).mockImplementation((...args: string[]) =>
      args.join("/"),
    );
  });

  describe("loadManifest", () => {
    it("should successfully load and validate a manifest", async () => {
      const mockManifest = {
        name: "test-plugin",
        description: "A test plugin",
        version: "1.0.0",
      };

      vi.mocked(fs.readdir).mockResolvedValue([
        "plugin.json",
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockManifest));

      const result = await PluginLoader.loadManifest(mockPluginPath);

      expect(result).toEqual(mockManifest);
      expect(fs.readFile).toHaveBeenCalledWith(mockManifestPath, "utf-8");
    });

    it("should throw error if manifest directory is not found", async () => {
      const error = new Error("Directory not found");
      (error as Error & { code?: string }).code = "ENOENT";
      vi.mocked(fs.readdir).mockRejectedValue(error);

      await expect(PluginLoader.loadManifest(mockPluginPath)).rejects.toThrow(
        `Plugin manifest directory not found at /mock/plugin/path/.wave-plugin`,
      );
    });

    it("should throw error if .wave-plugin/ contains misplaced files", async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        "plugin.json",
        "misplaced.txt",
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      await expect(PluginLoader.loadManifest(mockPluginPath)).rejects.toThrow(
        "Misplaced files/directories in .wave-plugin/: misplaced.txt. Only plugin.json should be in this directory.",
      );
    });

    it("should throw error if manifest file is not found", async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        "plugin.json",
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      const error = new Error("File not found");
      (error as Error & { code?: string }).code = "ENOENT";
      vi.mocked(fs.readFile).mockRejectedValue(error);

      await expect(PluginLoader.loadManifest(mockPluginPath)).rejects.toThrow(
        `Plugin manifest not found at ${mockManifestPath}`,
      );
    });

    it("should throw error if manifest loading fails for other reasons", async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        "plugin.json",
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      vi.mocked(fs.readFile).mockRejectedValue(new Error("Permission denied"));

      await expect(PluginLoader.loadManifest(mockPluginPath)).rejects.toThrow(
        `Failed to load plugin manifest at ${mockManifestPath}: Permission denied`,
      );
    });

    it("should throw error if manifest is missing name", async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        "plugin.json",
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      const mockManifest = {
        description: "A test plugin",
        version: "1.0.0",
      };

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify(mockManifest as unknown),
      );

      await expect(PluginLoader.loadManifest(mockPluginPath)).rejects.toThrow(
        "Plugin manifest missing 'name'",
      );
    });

    it("should throw error if manifest is missing description", async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        "plugin.json",
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      const mockManifest = {
        name: "test-plugin",
        version: "1.0.0",
      };

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify(mockManifest as unknown),
      );

      await expect(PluginLoader.loadManifest(mockPluginPath)).rejects.toThrow(
        "Plugin manifest missing 'description'",
      );
    });

    it("should throw error if manifest is missing version", async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        "plugin.json",
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      const mockManifest = {
        name: "test-plugin",
        description: "A test plugin",
      };

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify(mockManifest as unknown),
      );

      await expect(PluginLoader.loadManifest(mockPluginPath)).rejects.toThrow(
        "Plugin manifest missing 'version'",
      );
    });

    it("should throw error if manifest name is invalid", async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        "plugin.json",
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      const mockManifest = {
        name: "Test Plugin", // Invalid: contains spaces and uppercase
        description: "A test plugin",
        version: "1.0.0",
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockManifest));

      await expect(PluginLoader.loadManifest(mockPluginPath)).rejects.toThrow(
        "Invalid plugin name: Test Plugin. Only lowercase letters, numbers, and hyphens are allowed.",
      );
    });
  });

  describe("loadCommands", () => {
    it("should load commands from the commands directory", () => {
      const mockCommands = [
        { id: "test-cmd", name: "test-cmd", filePath: "/path/to/cmd.md" },
      ];
      vi.mocked(scanCommandsDirectory).mockReturnValue(
        mockCommands as unknown as CustomSlashCommand[],
      );

      const result = PluginLoader.loadCommands(mockPluginPath);
      expect(result).toEqual(mockCommands);
      expect(scanCommandsDirectory).toHaveBeenCalledWith(
        `${mockPluginPath}/commands`,
      );
    });
  });

  describe("loadSkills", () => {
    it("should load skills from the skills directory", async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: "skill1", isDirectory: () => true },
        { name: "not-a-skill", isDirectory: () => false },
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      vi.mocked(fs.stat).mockResolvedValue(
        {} as unknown as Awaited<ReturnType<typeof fs.stat>>,
      );
      vi.mocked(parseSkillFile).mockReturnValue({
        isValid: true,
        skillMetadata: {
          name: "skill1",
          description: "Skill 1",
          skillPath: "/mock/plugin/path/skills/skill1",
        },
        content: "Skill content",
        frontmatter: { name: "skill1", description: "Skill 1" },
        validationErrors: [],
      } as unknown as ReturnType<typeof parseSkillFile>);

      const result = await PluginLoader.loadSkills(mockPluginPath);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("skill1");
      expect(result[0].type).toBe("project");
      expect(result[0].pluginRoot).toBe(mockPluginPath);
    });

    it("should set pluginRoot on loaded skills", async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: "skill1", isDirectory: () => true },
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      vi.mocked(fs.stat).mockResolvedValue(
        {} as unknown as Awaited<ReturnType<typeof fs.stat>>,
      );
      vi.mocked(parseSkillFile).mockReturnValue({
        isValid: true,
        skillMetadata: {
          name: "skill1",
          description: "Skill 1",
          skillPath: "/my/plugin/skills/skill1",
        },
        content: "content",
        frontmatter: { name: "skill1", description: "Skill 1" },
        validationErrors: [],
      } as unknown as ReturnType<typeof parseSkillFile>);

      const result = await PluginLoader.loadSkills("/my/plugin");

      expect(result[0].pluginRoot).toBe("/my/plugin");
    });

    it("should return empty array if skills directory does not exist", async () => {
      vi.mocked(fs.readdir).mockRejectedValue(new Error("ENOENT"));

      const result = await PluginLoader.loadSkills(mockPluginPath);

      expect(result).toEqual([]);
    });
  });

  describe("loadLspConfig", () => {
    it("should load LSP config if .lsp.json exists", async () => {
      const mockConfig = { go: { command: "gopls" } };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const result = await PluginLoader.loadLspConfig(mockPluginPath);

      expect(result).toEqual(mockConfig);
    });

    it("should return undefined if .lsp.json does not exist", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

      const result = await PluginLoader.loadLspConfig(mockPluginPath);

      expect(result).toBeUndefined();
    });
  });

  describe("loadMcpConfig", () => {
    it("should load MCP config if .mcp.json exists", async () => {
      const mockConfig = { mcpServers: { test: { command: "test" } } };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const result = await PluginLoader.loadMcpConfig(mockPluginPath);

      expect(result).toEqual(mockConfig);
      expect(resolveMcpConfig).toHaveBeenCalledWith(mockConfig);
    });

    it("should return undefined if .mcp.json does not exist", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

      const result = await PluginLoader.loadMcpConfig(mockPluginPath);

      expect(result).toBeUndefined();
    });

    it("should resolve environment variables in MCP config", async () => {
      const mockConfig = {
        mcpServers: {
          tavily: {
            url: "https://mcp.tavily.com/mcp/",
            headers: {
              Authorization: "Bearer ${TAVILY_API_KEY}",
            },
          },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      // Set env var so mock resolver can pick it up
      process.env.TAVILY_API_KEY = "test-api-key-123";

      const result = await PluginLoader.loadMcpConfig(mockPluginPath);

      expect(resolveMcpConfig).toHaveBeenCalledWith(mockConfig);
      expect(result?.mcpServers?.tavily?.headers?.Authorization).toBe(
        "Bearer test-api-key-123",
      );

      delete process.env.TAVILY_API_KEY;
    });
  });

  describe("loadHooksConfig", () => {
    it("should load hooks config if hooks/hooks.json exists", async () => {
      const mockConfig = {
        hooks: { UserPromptSubmit: [] },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const result = await PluginLoader.loadHooksConfig(mockPluginPath);

      expect(result).toEqual({ UserPromptSubmit: [] });
    });

    it("should return undefined if hooks/hooks.json does not exist", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

      const result = await PluginLoader.loadHooksConfig(mockPluginPath);

      expect(result).toBeUndefined();
    });

    it("should return undefined if hooks.json lacks wrapper format", async () => {
      const rawConfig = { UserPromptSubmit: [] };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(rawConfig));

      const result = await PluginLoader.loadHooksConfig(mockPluginPath);

      expect(result).toBeUndefined();
    });
  });

  describe("loadAgents", () => {
    it("should load agents from the agents directory", async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: "agent1.md", isFile: () => true, isDirectory: () => false },
        { name: "agent2.md", isFile: () => true, isDirectory: () => false },
        { name: "not-a-dir", isFile: () => false, isDirectory: () => true },
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      vi.mocked(parseAgentFile)
        .mockImplementationOnce((filePath: string) => ({
          name: "agent1",
          description: "Agent 1",
          systemPrompt: "System prompt",
          filePath,
          scope: "plugin",
          priority: 2,
          pluginRoot: mockPluginPath,
        }))
        .mockImplementationOnce((filePath: string) => ({
          name: "agent2",
          description: "Agent 2",
          systemPrompt: "System prompt",
          filePath,
          scope: "plugin",
          priority: 2,
          pluginRoot: mockPluginPath,
        }));

      const result = await PluginLoader.loadAgents(mockPluginPath);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("agent1");
      expect(result[1].name).toBe("agent2");
      expect(result[0].scope).toBe("plugin");
      expect(result[0].pluginRoot).toBe(mockPluginPath);
      expect(parseAgentFile).toHaveBeenCalledWith(
        `${mockPluginPath}/agents/agent1.md`,
        "plugin",
        mockPluginPath,
      );
    });

    it("should set pluginRoot on loaded agents", async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: "test-agent.md", isFile: () => true, isDirectory: () => false },
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      vi.mocked(parseAgentFile).mockReturnValue({
        name: "test-agent",
        description: "Test Agent",
        systemPrompt: "Use ${WAVE_PLUGIN_ROOT} for files",
        filePath: "/my/plugin/agents/test-agent.md",
        scope: "plugin",
        priority: 2,
        pluginRoot: "/my/plugin",
      });

      const result = await PluginLoader.loadAgents("/my/plugin");

      expect(result[0].pluginRoot).toBe("/my/plugin");
    });

    it("should return empty array if agents directory does not exist", async () => {
      vi.mocked(fs.readdir).mockRejectedValue(new Error("ENOENT"));

      const result = await PluginLoader.loadAgents(mockPluginPath);

      expect(result).toEqual([]);
    });

    it("should skip invalid agent files and continue", async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: "valid.md", isFile: () => true, isDirectory: () => false },
        { name: "invalid.md", isFile: () => true, isDirectory: () => false },
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      vi.mocked(parseAgentFile)
        .mockImplementationOnce(() => ({
          name: "valid",
          description: "Valid Agent",
          systemPrompt: "Valid prompt",
          filePath: "/mock/agents/valid.md",
          scope: "plugin",
          priority: 2,
          pluginRoot: mockPluginPath,
        }))
        .mockImplementationOnce(() => {
          throw new Error("Parse error");
        });

      const result = await PluginLoader.loadAgents(mockPluginPath);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("valid");
    });

    it("should only load .md files", async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: "agent.md", isFile: () => true, isDirectory: () => false },
        { name: "readme.txt", isFile: () => true, isDirectory: () => false },
        { name: "subdir", isFile: () => false, isDirectory: () => true },
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      vi.mocked(parseAgentFile).mockReturnValue({
        name: "agent",
        description: "Agent",
        systemPrompt: "Prompt",
        filePath: "/mock/agents/agent.md",
        scope: "plugin",
        priority: 2,
        pluginRoot: mockPluginPath,
      });

      const result = await PluginLoader.loadAgents(mockPluginPath);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("agent");
    });
  });
});

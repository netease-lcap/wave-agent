import { describe, it, expect, vi, beforeEach } from "vitest";
import { PluginManager } from "../../src/managers/pluginManager.js";
import { PluginLoader } from "../../src/services/pluginLoader.js";
import {
  PluginConfig,
  Logger,
  PluginManifest,
  CustomSlashCommand,
  Skill,
  LspConfig,
  McpConfig,
  PartialHookConfiguration,
} from "../../src/types/index.js";
import * as path from "path";
import { SkillManager } from "../../src/managers/skillManager.js";
import { HookManager } from "../../src/managers/hookManager.js";
import { LspManager } from "../../src/managers/lspManager.js";
import { McpManager } from "../../src/managers/mcpManager.js";
import { SlashCommandManager } from "../../src/managers/slashCommandManager.js";

vi.mock("../../src/services/pluginLoader.js");

describe("PluginManager", () => {
  let pluginManager: PluginManager;
  let mockLogger: Logger;
  let mockSkillManager: SkillManager;
  let mockHookManager: HookManager;
  let mockLspManager: LspManager;
  let mockMcpManager: McpManager;
  let mockSlashCommandManager: SlashCommandManager;
  const workdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    mockSkillManager = {
      registerPluginSkills: vi.fn(),
    } as unknown as SkillManager;
    mockHookManager = {
      registerPluginHooks: vi.fn(),
    } as unknown as HookManager;
    mockLspManager = { registerServer: vi.fn() } as unknown as LspManager;
    mockMcpManager = { addServer: vi.fn() } as unknown as McpManager;
    mockSlashCommandManager = {
      registerPluginCommands: vi.fn(),
    } as unknown as SlashCommandManager;

    pluginManager = new PluginManager({
      workdir,
      logger: mockLogger,
      skillManager: mockSkillManager,
      hookManager: mockHookManager,
      lspManager: mockLspManager,
      mcpManager: mockMcpManager,
      slashCommandManager: mockSlashCommandManager,
    });
  });

  describe("loadPlugins", () => {
    it("should load local plugins and register components successfully", async () => {
      const configs: PluginConfig[] = [
        { type: "local", path: "plugins/test-plugin" },
      ];
      const manifest = {
        name: "test-plugin",
        version: "1.0.0",
        description: "A test plugin",
      };
      const commands = [
        { name: "test", description: "test command", run: vi.fn() },
      ];
      const skills = [{ name: "skill1" }];
      const lspConfig = { go: { command: "gopls" } };
      const mcpConfig = { mcpServers: { test: { command: "test" } } };
      const hooksConfig = { UserPromptSubmit: [] };

      vi.mocked(PluginLoader.loadManifest).mockResolvedValue(
        manifest as PluginManifest,
      );
      vi.mocked(PluginLoader.loadCommands).mockReturnValue(
        commands as unknown as CustomSlashCommand[],
      );
      vi.mocked(PluginLoader.loadSkills).mockResolvedValue(
        skills as unknown as Skill[],
      );
      vi.mocked(PluginLoader.loadLspConfig).mockResolvedValue(
        lspConfig as unknown as LspConfig,
      );
      vi.mocked(PluginLoader.loadMcpConfig).mockResolvedValue(
        mcpConfig as unknown as McpConfig,
      );
      vi.mocked(PluginLoader.loadHooksConfig).mockResolvedValue(
        hooksConfig as unknown as PartialHookConfiguration,
      );

      await pluginManager.loadPlugins(configs);

      const plugins = pluginManager.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toMatchObject({
        ...manifest,
        path: path.resolve(workdir, configs[0].path),
        commands,
        skills,
        lspConfig,
        mcpConfig,
        hooksConfig,
      });

      expect(
        mockSlashCommandManager.registerPluginCommands,
      ).toHaveBeenCalledWith("test-plugin", commands);
      expect(mockSkillManager.registerPluginSkills).toHaveBeenCalledWith(
        skills,
      );
      expect(mockLspManager.registerServer).toHaveBeenCalledWith(
        "go",
        lspConfig.go,
      );
      expect(mockMcpManager.addServer).toHaveBeenCalledWith(
        "test",
        mcpConfig.mcpServers.test,
      );
      expect(mockHookManager.registerPluginHooks).toHaveBeenCalledWith(
        hooksConfig,
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Loaded plugin: test-plugin"),
      );
    });

    it("should skip unsupported plugin types", async () => {
      const configs: PluginConfig[] = [
        { type: "remote" as unknown as "local", path: "http://example.com" },
      ];

      await pluginManager.loadPlugins(configs);

      expect(pluginManager.getPlugins()).toHaveLength(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Unsupported plugin type: remote"),
      );
    });

    it("should skip already loaded plugins", async () => {
      const configs: PluginConfig[] = [
        { type: "local", path: "plugins/test-plugin" },
        { type: "local", path: "plugins/test-plugin-duplicate" },
      ];
      const manifest = {
        name: "test-plugin",
        version: "1.0.0",
        description: "A test plugin",
      };

      vi.mocked(PluginLoader.loadManifest).mockResolvedValue(
        manifest as PluginManifest,
      );
      vi.mocked(PluginLoader.loadCommands).mockReturnValue([]);
      vi.mocked(PluginLoader.loadSkills).mockResolvedValue([]);

      await pluginManager.loadPlugins(configs);

      expect(pluginManager.getPlugins()).toHaveLength(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "Plugin with name 'test-plugin' is already loaded",
        ),
      );
    });

    it("should handle errors during plugin loading", async () => {
      const configs: PluginConfig[] = [
        { type: "local", path: "plugins/invalid-plugin" },
      ];
      const error = new Error("Manifest not found");

      vi.mocked(PluginLoader.loadManifest).mockRejectedValue(error);

      await pluginManager.loadPlugins(configs);

      expect(pluginManager.getPlugins()).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          "Failed to load plugin from plugins/invalid-plugin",
        ),
        error,
      );
    });
  });

  describe("getPlugins and getPlugin", () => {
    it("should return all loaded plugins", async () => {
      const configs: PluginConfig[] = [
        { type: "local", path: "plugins/p1" },
        { type: "local", path: "plugins/p2" },
      ];

      vi.mocked(PluginLoader.loadManifest)
        .mockResolvedValueOnce({
          name: "p1",
          version: "1.0.0",
          description: "d1",
        } as PluginManifest)
        .mockResolvedValueOnce({
          name: "p2",
          version: "1.0.0",
          description: "d2",
        } as PluginManifest);
      vi.mocked(PluginLoader.loadCommands).mockReturnValue([]);
      vi.mocked(PluginLoader.loadSkills).mockResolvedValue([]);

      await pluginManager.loadPlugins(configs);

      const plugins = pluginManager.getPlugins();
      expect(plugins).toHaveLength(2);
      expect(pluginManager.getPlugin("p1")).toBeDefined();
      expect(pluginManager.getPlugin("p2")).toBeDefined();
      expect(pluginManager.getPlugin("p3")).toBeUndefined();
    });
  });
});

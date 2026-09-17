import { describe, it, expect, vi, beforeEach } from "vitest";
import { PluginManager } from "../../src/managers/pluginManager.js";
import { Container } from "../../src/utils/container.js";
import { PluginLoader } from "../../src/services/pluginLoader.js";
import {
  PluginConfig,
  PluginManifest,
  CustomSlashCommand,
  Skill,
  LspConfig,
  McpConfig,
  PartialHookConfiguration,
} from "../../src/types/index.js";
import * as path from "path";
import { existsSync, readdirSync } from "fs";
import { SkillManager } from "../../src/managers/skillManager.js";
import { HookManager } from "../../src/managers/hookManager.js";
import { LspManager } from "../../src/managers/lspManager.js";
import { McpManager } from "../../src/managers/mcpManager.js";
import { SlashCommandManager } from "../../src/managers/slashCommandManager.js";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import { MarketplaceService } from "../../src/services/MarketplaceService.js";
import { logger } from "../../src/utils/globalLogger.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/services/pluginLoader.js");
vi.mock("../../src/services/MarketplaceService.js");
vi.mock("../../src/utils/builtinEmbed.js", () => ({
  ensureBuiltinMaterialized: () => "/fake-builtin-root",
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return { ...actual, existsSync: vi.fn(), readdirSync: vi.fn() };
});

describe("PluginManager", () => {
  let pluginManager: PluginManager;
  let container: Container;
  let mockSkillManager: SkillManager;
  let mockHookManager: HookManager;
  let mockLspManager: LspManager;
  let mockMcpManager: McpManager;
  let mockSlashCommandManager: SlashCommandManager;
  let mockPermissionManager: PermissionManager;
  /** 每个用例里 PluginManager 构造的 MarketplaceService 替身（守卫「加载插件不刷市场」）。 */
  let createdMarketplaceServices: {
    getInstalledPlugins: ReturnType<typeof vi.fn>;
    listMarketplaces: ReturnType<typeof vi.fn>;
    refreshMarketplaces: ReturnType<typeof vi.fn>;
  }[];
  const workdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();

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
    mockPermissionManager = {
      addInstanceAllowedRule: vi.fn(),
    } as unknown as PermissionManager;

    const mockConfigurationService = {
      getMergedEnabledPlugins: vi.fn().mockReturnValue({}),
    };

    container = new Container();
    container.register("SkillManager", mockSkillManager);
    container.register("HookManager", mockHookManager);
    container.register("LspManager", mockLspManager);
    container.register("McpManager", mockMcpManager);
    container.register("SlashCommandManager", mockSlashCommandManager);
    container.register("PermissionManager", mockPermissionManager);
    container.register(
      "ConfigurationService",
      mockConfigurationService as unknown as Record<string, unknown>,
    );

    createdMarketplaceServices = [];
    vi.mocked(MarketplaceService).mockImplementation(function () {
      const instance = {
        getInstalledPlugins: vi.fn().mockResolvedValue({ plugins: [] }),
        listMarketplaces: vi.fn().mockResolvedValue([]),
        refreshMarketplaces: vi.fn().mockResolvedValue(undefined),
      };
      createdMarketplaceServices.push(instance);
      return instance as unknown as MarketplaceService;
    });

    pluginManager = new PluginManager(container, {
      workdir,
    });
    // Expose mockConfigurationService for tests
    (
      pluginManager as unknown as {
        mockConfigurationService: typeof mockConfigurationService;
      }
    ).mockConfigurationService = mockConfigurationService;
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
        "test-plugin",
        skills,
      );
      expect(mockLspManager.registerServer).toHaveBeenCalledWith("go", {
        ...lspConfig.go,
        pluginRoot: path.resolve(workdir, configs[0].path),
      });
      expect(mockMcpManager.addServer).toHaveBeenCalledWith("test", {
        ...mcpConfig.mcpServers.test,
        pluginRoot: path.resolve(workdir, configs[0].path),
      });
      expect(mockHookManager.registerPluginHooks).toHaveBeenCalledWith(
        path.resolve(workdir, configs[0].path),
        hooksConfig,
      );

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Loaded plugin: test-plugin"),
      );
    });

    it("should skip unsupported plugin types", async () => {
      const configs: PluginConfig[] = [
        { type: "remote" as unknown as "local", path: "http://example.com" },
      ];

      await pluginManager.loadPlugins(configs);

      expect(pluginManager.getPlugins()).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith(
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
      expect(logger.warn).toHaveBeenCalledWith(
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
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          `Failed to load plugin from ${path.resolve(workdir, configs[0].path)}`,
        ),
        error,
      );
    });

    it("should only load explicitly enabled plugins from marketplace", async () => {
      const installedPlugins = [
        { name: "plugin1", marketplace: "m1", cachePath: "/path/1" },
        { name: "plugin2", marketplace: "m1", cachePath: "/path/2" },
        { name: "plugin3", marketplace: "m1", cachePath: "/path/3" },
      ];

      vi.mocked(MarketplaceService).mockImplementation(function () {
        return {
          getInstalledPlugins: vi
            .fn()
            .mockResolvedValue({ plugins: installedPlugins }),
          listMarketplaces: vi.fn().mockResolvedValue([]),
          refreshMarketplaces: vi.fn().mockResolvedValue(undefined),
        } as unknown as MarketplaceService;
      });

      const enabledPlugins = {
        "plugin1@m1": true,
        "plugin2@m1": false,
        // plugin3@m1 is not mentioned
      };
      (
        pluginManager as unknown as {
          mockConfigurationService: {
            getMergedEnabledPlugins: ReturnType<typeof vi.fn>;
          };
        }
      ).mockConfigurationService.getMergedEnabledPlugins.mockReturnValue(
        enabledPlugins,
      );

      vi.mocked(PluginLoader.loadManifest).mockImplementation(
        async function (p) {
          return {
            name:
              p === "/path/1"
                ? "plugin1"
                : p === "/path/2"
                  ? "plugin2"
                  : "plugin3",
            version: "1.0.0",
            description: "desc",
          } as PluginManifest;
        },
      );
      vi.mocked(PluginLoader.loadCommands).mockReturnValue([]);
      vi.mocked(PluginLoader.loadSkills).mockResolvedValue([]);

      await pluginManager.loadPlugins([]);

      expect(pluginManager.getPlugins()).toHaveLength(1);
      expect(pluginManager.getPlugin("plugin1")).toBeDefined();
      expect(pluginManager.getPlugin("plugin2")).toBeUndefined();
      expect(pluginManager.getPlugin("plugin3")).toBeUndefined();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining(
          "Plugin plugin2@m1 is not enabled via configuration",
        ),
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining(
          "Plugin plugin3@m1 is not enabled via configuration",
        ),
      );
    });

    it("should prioritize local plugins over marketplace plugins", async () => {
      const configs: PluginConfig[] = [
        { type: "local", path: "plugins/test-plugin" },
      ];
      const localManifest = {
        name: "test-plugin",
        version: "2.0.0-local",
        description: "Local version",
      };
      const marketplaceManifest = {
        name: "test-plugin",
        version: "1.0.0-marketplace",
        description: "Marketplace version",
      };

      const installedPlugins = [
        {
          name: "test-plugin",
          marketplace: "m1",
          cachePath: "/marketplace/path",
        },
      ];

      vi.mocked(MarketplaceService).mockImplementation(function () {
        return {
          getInstalledPlugins: vi
            .fn()
            .mockResolvedValue({ plugins: installedPlugins }),
          listMarketplaces: vi.fn().mockResolvedValue([]),
          refreshMarketplaces: vi.fn().mockResolvedValue(undefined),
        } as unknown as MarketplaceService;
      });

      const enabledPlugins = {
        "test-plugin@m1": true,
      };
      (
        pluginManager as unknown as {
          mockConfigurationService: {
            getMergedEnabledPlugins: ReturnType<typeof vi.fn>;
          };
        }
      ).mockConfigurationService.getMergedEnabledPlugins.mockReturnValue(
        enabledPlugins,
      );

      const localPluginPath = path.resolve(workdir, configs[0].path);
      vi.mocked(PluginLoader.loadManifest).mockImplementation(
        async function (p) {
          if (p === localPluginPath) {
            return localManifest as PluginManifest;
          }
          return marketplaceManifest as PluginManifest;
        },
      );
      vi.mocked(PluginLoader.loadCommands).mockReturnValue([]);
      vi.mocked(PluginLoader.loadSkills).mockResolvedValue([]);

      await pluginManager.loadPlugins(configs);

      const plugins = pluginManager.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0].version).toBe("2.0.0-local");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "Plugin with name 'test-plugin' is already loaded",
        ),
      );
    });

    it("should not refresh marketplace checkouts while loading plugins", async () => {
      // 清单刷新只由「打开插件市场界面」触发（spec 插件市场 A-013 场景 5）：
      // 插件加载路径（宿主启动 / 新建会话 / 配置重建）不得发起任何市场拉取。
      await pluginManager.loadPlugins([]);

      expect(createdMarketplaceServices.length).toBeGreaterThan(0);
      for (const service of createdMarketplaceServices) {
        expect(service.refreshMarketplaces).not.toHaveBeenCalled();
      }
    });

    it("should load a plugin once when several install records share the cache", async () => {
      // spec plugin A-015：同一插件在 user 作用域与某项目各有一条安装记录，
      // 记录指向同一份缓存 → 只按插件加载一次（否则会重复读 manifest 并误报
      // 「already loaded」）。
      const pluginId = "test-plugin@marketplace";
      (
        pluginManager as unknown as {
          mockConfigurationService: {
            getMergedEnabledPlugins: ReturnType<typeof vi.fn>;
          };
        }
      ).mockConfigurationService.getMergedEnabledPlugins.mockReturnValue({
        [pluginId]: true,
      });

      vi.mocked(PluginLoader.loadManifest).mockResolvedValue({
        name: "test-plugin",
        version: "1.0.0",
        description: "A test plugin",
      } as PluginManifest);
      vi.mocked(PluginLoader.loadCommands).mockReturnValue([]);
      vi.mocked(PluginLoader.loadSkills).mockResolvedValue([]);

      vi.mocked(MarketplaceService).mockImplementation(function () {
        const instance = {
          getInstalledPlugins: vi.fn().mockResolvedValue({
            plugins: [
              {
                name: "test-plugin",
                marketplace: "marketplace",
                version: "1.0.0",
                cachePath: "/cache/test-plugin/1.0.0",
                scope: "user",
              },
              {
                name: "test-plugin",
                marketplace: "marketplace",
                version: "1.0.0",
                cachePath: "/cache/test-plugin/1.0.0",
                scope: "project",
                projectPath: "/repo/a",
              },
            ],
          }),
          listMarketplaces: vi.fn().mockResolvedValue([]),
          refreshMarketplaces: vi.fn().mockResolvedValue(undefined),
        };
        createdMarketplaceServices.push(instance);
        return instance as unknown as MarketplaceService;
      });

      await pluginManager.loadPlugins([]);

      expect(pluginManager.getPlugins()).toHaveLength(1);
      expect(PluginLoader.loadManifest).toHaveBeenCalledTimes(1);
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("already loaded"),
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

  describe("loadBuiltinPlugins", () => {
    const dirEntries = (names: string[], dirs: string[]) =>
      names.map((name) => ({
        name,
        isDirectory: () => dirs.includes(name),
      })) as unknown as Awaited<ReturnType<typeof readdirSync>>;

    // Helper: enable a set of <name>@builtin plugins via the merged config.
    const enableBuiltins = (...names: string[]) => {
      const enabled: Record<string, boolean> = {};
      for (const n of names) enabled[`${n}@builtin`] = true;
      (
        pluginManager as unknown as {
          mockConfigurationService: {
            getMergedEnabledPlugins: ReturnType<typeof vi.fn>;
          };
        }
      ).mockConfigurationService.getMergedEnabledPlugins.mockReturnValue(
        enabled,
      );
    };

    beforeEach(() => {
      // Default: builtin directory absent so existing flows stay isolated.
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(readdirSync).mockReturnValue([]);
    });

    it("should load a built-in plugin when enabled via <name>@builtin", async () => {
      enableBuiltins("sdd");
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(
        dirEntries(["sdd", "README.md"], ["sdd"]),
      );

      const manifest = {
        name: "sdd",
        version: "1.0.0",
        description: "Spec-first workflow",
      };
      vi.mocked(PluginLoader.loadManifest).mockResolvedValue(
        manifest as PluginManifest,
      );
      vi.mocked(PluginLoader.loadCommands).mockReturnValue([]);
      vi.mocked(PluginLoader.loadSkills).mockResolvedValue([]);

      await pluginManager.loadPlugins([]);

      expect(pluginManager.getPlugins()).toHaveLength(1);
      expect(pluginManager.getPlugin("sdd")).toBeDefined();
      // Non-directory entries (e.g. README.md) are skipped.
      expect(PluginLoader.loadManifest).toHaveBeenCalledTimes(1);
      expect(existsSync).toHaveBeenCalledWith(
        expect.stringContaining(path.join("/fake-builtin-root", "plugins")),
      );
    });

    it("should NOT load built-in plugins when not enabled (default off)", async () => {
      // enabledPlugins is empty by default (getMergedEnabledPlugins returns {})
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(dirEntries(["sdd"], ["sdd"]));

      vi.mocked(PluginLoader.loadManifest).mockResolvedValue({
        name: "sdd",
        version: "1.0.0",
        description: "d",
      } as PluginManifest);

      await pluginManager.loadPlugins([]);

      expect(pluginManager.getPlugins()).toHaveLength(0);
      expect(PluginLoader.loadManifest).not.toHaveBeenCalled();
    });

    it("should skip loading when builtin directory does not exist", async () => {
      enableBuiltins("sdd");
      vi.mocked(existsSync).mockReturnValue(false);

      await pluginManager.loadPlugins([]);

      expect(pluginManager.getPlugins()).toHaveLength(0);
      expect(readdirSync).not.toHaveBeenCalled();
    });

    it("should give config plugins priority over enabled builtins on name conflict", async () => {
      enableBuiltins("sdd");
      const configs: PluginConfig[] = [{ type: "local", path: "plugins/sdd" }];
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(dirEntries(["sdd"], ["sdd"]));

      vi.mocked(PluginLoader.loadManifest).mockResolvedValue({
        name: "sdd",
        version: "1.0.0",
        description: "d",
      } as PluginManifest);
      vi.mocked(PluginLoader.loadCommands).mockReturnValue([]);
      vi.mocked(PluginLoader.loadSkills).mockResolvedValue([]);

      await pluginManager.loadPlugins(configs);

      expect(pluginManager.getPlugins()).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("'sdd' is already loaded"),
      );
    });

    it("should log error and continue when an enabled builtin plugin fails to load", async () => {
      enableBuiltins("broken");
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(
        dirEntries(["broken"], ["broken"]),
      );

      vi.mocked(PluginLoader.loadManifest).mockRejectedValue(
        new Error("Manifest not found"),
      );

      await pluginManager.loadPlugins([]);

      expect(pluginManager.getPlugins()).toHaveLength(0);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load plugin from"),
        expect.any(Error),
      );
    });

    it("should not treat <name>@builtin entries as unknown marketplaces", async () => {
      // An enabled builtin must not trip the marketplace auto-install "unknown"
      // warning in loadInstalledPlugins — @builtin entries are skipped there.
      enableBuiltins("sdd");
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(dirEntries(["sdd"], ["sdd"]));
      vi.mocked(PluginLoader.loadManifest).mockResolvedValue({
        name: "sdd",
        version: "1.0.0",
        description: "d",
      } as PluginManifest);
      vi.mocked(PluginLoader.loadCommands).mockReturnValue([]);
      vi.mocked(PluginLoader.loadSkills).mockResolvedValue([]);

      await pluginManager.loadPlugins([]);

      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("marketplace builtin is unknown"),
      );
    });

    it("should register spec-count allow rule when sdd@builtin is enabled and loaded", async () => {
      enableBuiltins("sdd");
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(dirEntries(["sdd"], ["sdd"]));
      vi.mocked(PluginLoader.loadManifest).mockResolvedValue({
        name: "sdd",
        version: "1.0.0",
        description: "Spec-first workflow",
      } as PluginManifest);
      vi.mocked(PluginLoader.loadCommands).mockReturnValue([]);
      vi.mocked(PluginLoader.loadSkills).mockResolvedValue([]);

      await pluginManager.loadPlugins([]);

      expect(mockPermissionManager.addInstanceAllowedRule).toHaveBeenCalledWith(
        "Bash(node *spec-count.js*)",
      );
    });

    it("should not register allow rules when sdd@builtin is not enabled", async () => {
      // enabledPlugins is empty by default (getMergedEnabledPlugins returns {})
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(dirEntries(["sdd"], ["sdd"]));
      vi.mocked(PluginLoader.loadManifest).mockResolvedValue({
        name: "sdd",
        version: "1.0.0",
        description: "d",
      } as PluginManifest);

      await pluginManager.loadPlugins([]);

      expect(
        mockPermissionManager.addInstanceAllowedRule,
      ).not.toHaveBeenCalled();
    });

    it("should not register allow rules when the enabled builtin plugin fails to load", async () => {
      enableBuiltins("broken");
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(
        dirEntries(["broken"], ["broken"]),
      );
      vi.mocked(PluginLoader.loadManifest).mockRejectedValue(
        new Error("Manifest not found"),
      );

      await pluginManager.loadPlugins([]);

      expect(
        mockPermissionManager.addInstanceAllowedRule,
      ).not.toHaveBeenCalled();
    });

    it("should not register allow rules for builtin plugins without declared rules", async () => {
      enableBuiltins("other");
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(dirEntries(["other"], ["other"]));
      vi.mocked(PluginLoader.loadManifest).mockResolvedValue({
        name: "other",
        version: "1.0.0",
        description: "d",
      } as PluginManifest);
      vi.mocked(PluginLoader.loadCommands).mockReturnValue([]);
      vi.mocked(PluginLoader.loadSkills).mockResolvedValue([]);

      await pluginManager.loadPlugins([]);

      expect(pluginManager.getPlugin("other")).toBeDefined();
      expect(
        mockPermissionManager.addInstanceAllowedRule,
      ).not.toHaveBeenCalled();
    });
  });
});

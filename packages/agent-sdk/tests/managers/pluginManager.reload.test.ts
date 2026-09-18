import { describe, it, expect, vi, beforeEach } from "vitest";
import { PluginManager } from "../../src/managers/pluginManager.js";
import { Container } from "../../src/utils/container.js";
import { PluginLoader } from "../../src/services/pluginLoader.js";
import {
  PluginConfig,
  PluginManifest,
  CustomSlashCommand,
  Skill,
} from "../../src/types/index.js";
import * as path from "path";
import { existsSync, readdirSync } from "fs";
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

/**
 * 插件变更的就地重载（docs/specs/ecosystem/plugin.md「插件变更的就地重载」）：
 * 反注册 → 重新读取 → 重新注册。此处覆盖六类能力的换装、幂等、按磁盘启用
 * 记录换装、失败上报，以及更新后指向新缓存目录（场景 3 / 6 / 10 / 11 / 12）。
 */
describe("PluginManager in-place reload", () => {
  let pluginManager: PluginManager;
  let container: Container;
  const workdir = "/test/workdir";
  const localRoot = path.resolve(workdir, "plugins/p1");

  let mockSkillManager: {
    registerPluginSkills: ReturnType<typeof vi.fn>;
    unregisterPluginSkills: ReturnType<typeof vi.fn>;
  };
  let mockHookManager: {
    registerPluginHooks: ReturnType<typeof vi.fn>;
    unregisterPluginHooks: ReturnType<typeof vi.fn>;
  };
  let mockLspManager: {
    registerServer: ReturnType<typeof vi.fn>;
    unregisterServersForPlugin: ReturnType<typeof vi.fn>;
  };
  let mockMcpManager: {
    addServer: ReturnType<typeof vi.fn>;
    removeServersForPlugin: ReturnType<typeof vi.fn>;
  };
  let mockSlashCommandManager: {
    registerPluginCommands: ReturnType<typeof vi.fn>;
    unregisterPluginCommands: ReturnType<typeof vi.fn>;
  };
  let mockSubagentManager: {
    registerPluginAgents: ReturnType<typeof vi.fn>;
    unregisterPluginAgents: ReturnType<typeof vi.fn>;
  };
  let mockPermissionManager: {
    addInstanceAllowedRule: ReturnType<typeof vi.fn>;
    removeInstanceAllowedRule: ReturnType<typeof vi.fn>;
  };
  let mockConfigurationService: {
    getMergedEnabledPlugins: ReturnType<typeof vi.fn>;
  };

  /** 一次 loadSinglePlugin 所需的完整插件工件（顺序与 loadManifest 的调用顺序对应）。 */
  function stubPluginArtifacts(manifest: PluginManifest) {
    vi.mocked(PluginLoader.loadManifest).mockResolvedValue(manifest);
    vi.mocked(PluginLoader.loadCommands).mockReturnValue([
      { name: "hello", description: "hi", run: vi.fn() },
    ] as unknown as CustomSlashCommand[]);
    vi.mocked(PluginLoader.loadSkills).mockResolvedValue([
      { name: "sk" },
    ] as unknown as Skill[]);
    vi.mocked(PluginLoader.loadAgents).mockResolvedValue([]);
    vi.mocked(PluginLoader.loadLspConfig).mockResolvedValue({
      go: { command: "gopls" },
    } as unknown as Awaited<ReturnType<typeof PluginLoader.loadLspConfig>>);
    vi.mocked(PluginLoader.loadMcpConfig).mockResolvedValue({
      mcpServers: { srv: { command: "srv" } },
    } as unknown as Awaited<ReturnType<typeof PluginLoader.loadMcpConfig>>);
    vi.mocked(PluginLoader.loadHooksConfig).mockResolvedValue({
      UserPromptSubmit: [],
    } as unknown as Awaited<ReturnType<typeof PluginLoader.loadHooksConfig>>);
  }

  beforeEach(() => {
    vi.clearAllMocks();

    mockSkillManager = {
      registerPluginSkills: vi.fn(),
      unregisterPluginSkills: vi.fn(),
    };
    mockHookManager = {
      registerPluginHooks: vi.fn(),
      unregisterPluginHooks: vi.fn(),
    };
    mockLspManager = {
      registerServer: vi.fn(),
      unregisterServersForPlugin: vi.fn().mockResolvedValue(0),
    };
    mockMcpManager = {
      addServer: vi.fn(),
      removeServersForPlugin: vi.fn().mockReturnValue(0),
    };
    mockSlashCommandManager = {
      registerPluginCommands: vi.fn(),
      unregisterPluginCommands: vi.fn().mockReturnValue(0),
    };
    mockSubagentManager = {
      registerPluginAgents: vi.fn(),
      unregisterPluginAgents: vi.fn().mockReturnValue(0),
    };
    mockPermissionManager = {
      addInstanceAllowedRule: vi.fn(),
      removeInstanceAllowedRule: vi.fn(),
    };
    mockConfigurationService = {
      getMergedEnabledPlugins: vi.fn().mockReturnValue({}),
    };

    container = new Container();
    container.register("SkillManager", mockSkillManager);
    container.register("HookManager", mockHookManager);
    container.register("LspManager", mockLspManager);
    container.register("McpManager", mockMcpManager);
    container.register("SlashCommandManager", mockSlashCommandManager);
    container.register("SubagentManager", mockSubagentManager);
    container.register("PermissionManager", mockPermissionManager);
    container.register(
      "ConfigurationService",
      mockConfigurationService as unknown as Record<string, unknown>,
    );

    // 内置插件目录不存在，避免污染这些用例。
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([]);

    vi.mocked(MarketplaceService).mockImplementation(function () {
      return {
        getInstalledPlugins: vi.fn().mockResolvedValue({ plugins: [] }),
        listMarketplaces: vi.fn().mockResolvedValue([]),
        refreshMarketplaces: vi.fn().mockResolvedValue(undefined),
      } as unknown as MarketplaceService;
    });

    vi.mocked(PluginLoader.loadManifest).mockResolvedValue({
      name: "p1",
      version: "1.0.0",
      description: "d",
    } as PluginManifest);
    vi.mocked(PluginLoader.loadCommands).mockReturnValue([]);
    vi.mocked(PluginLoader.loadSkills).mockResolvedValue([]);
    vi.mocked(PluginLoader.loadAgents).mockResolvedValue([]);

    pluginManager = new PluginManager(container, { workdir });
  });

  describe("unloadPlugin", () => {
    it("drops all six capability kinds with the key each manager registers under", async () => {
      stubPluginArtifacts({
        name: "p1",
        version: "1.0.0",
        description: "d",
      } as PluginManifest);
      await pluginManager.loadPlugins([
        { type: "local", path: "plugins/p1" } as PluginConfig,
      ]);

      const unloaded = await pluginManager.unloadPlugin("p1");

      expect(unloaded).toBe(true);
      // 命令 / 技能 / 子代理按插件名寻址，钩子 / LSP / MCP 按插件根路径寻址。
      expect(
        mockSlashCommandManager.unregisterPluginCommands,
      ).toHaveBeenCalledWith("p1");
      expect(mockSkillManager.unregisterPluginSkills).toHaveBeenCalledWith(
        "p1",
      );
      expect(mockSubagentManager.unregisterPluginAgents).toHaveBeenCalledWith(
        "p1",
      );
      expect(mockHookManager.unregisterPluginHooks).toHaveBeenCalledWith(
        localRoot,
      );
      expect(mockLspManager.unregisterServersForPlugin).toHaveBeenCalledWith(
        localRoot,
      );
      expect(mockMcpManager.removeServersForPlugin).toHaveBeenCalledWith(
        localRoot,
      );
      expect(pluginManager.getPlugin("p1")).toBeUndefined();
      expect(pluginManager.getPlugins()).toHaveLength(0);
    });

    it("revokes the builtin helper-script grants the plugin added", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        { name: "sdd", isDirectory: () => true },
      ] as unknown as Awaited<ReturnType<typeof readdirSync>>);
      mockConfigurationService.getMergedEnabledPlugins.mockReturnValue({
        "sdd@builtin": true,
      });
      vi.mocked(PluginLoader.loadManifest).mockResolvedValue({
        name: "sdd",
        version: "1.0.0",
        description: "d",
      } as PluginManifest);
      await pluginManager.loadPlugins([]);

      await pluginManager.unloadPlugin("sdd");

      expect(
        mockPermissionManager.removeInstanceAllowedRule,
      ).toHaveBeenCalledWith("Bash(node *spec-count.js*)");
    });

    it("is a no-op for a plugin that is not loaded", async () => {
      const unloaded = await pluginManager.unloadPlugin("nope");

      expect(unloaded).toBe(false);
      expect(
        mockSlashCommandManager.unregisterPluginCommands,
      ).not.toHaveBeenCalled();
      expect(mockHookManager.unregisterPluginHooks).not.toHaveBeenCalled();
    });
  });

  describe("reloadAllPlugins", () => {
    it("unloads the old state and registers the new content in place", async () => {
      stubPluginArtifacts({
        name: "p1",
        version: "1.0.0",
        description: "d",
      } as PluginManifest);
      const configs = [{ type: "local", path: "plugins/p1" } as PluginConfig];
      await pluginManager.loadPlugins(configs);

      // 磁盘上的内容变了：多出一条命令。
      const updatedCommands = [
        { name: "hello", description: "hi", run: vi.fn() },
        { name: "world", description: "new", run: vi.fn() },
      ] as unknown as CustomSlashCommand[];
      vi.mocked(PluginLoader.loadCommands).mockReturnValue(updatedCommands);

      const result = await pluginManager.reloadAllPlugins();

      expect(result.plugins).toEqual(["p1"]);
      expect(result.failures).toEqual([]);
      // 先反注册旧的，再注册新的（顺序保证不会出现「旧条目指向新内容」的中间态）。
      expect(
        mockSlashCommandManager.unregisterPluginCommands,
      ).toHaveBeenCalledWith("p1");
      expect(
        mockSlashCommandManager.registerPluginCommands,
      ).toHaveBeenLastCalledWith("p1", updatedCommands);
      expect(mockSkillManager.unregisterPluginSkills).toHaveBeenCalledWith(
        "p1",
      );
      expect(pluginManager.getPlugin("p1")?.commands).toEqual(updatedCommands);
    });

    it("points the reloaded capabilities at the new cache directory after an update", async () => {
      // 场景 12：更新会换用新的版本目录，重载后六类能力必须指向新目录。
      const oldRoot = "/cache/p1/1.0.0";
      const newRoot = "/cache/p1/2.0.0";
      const installedAt = (cachePath: string) =>
        vi.mocked(MarketplaceService).mockImplementation(function () {
          return {
            getInstalledPlugins: vi.fn().mockResolvedValue({
              plugins: [{ name: "p1", marketplace: "m1", cachePath }],
            }),
            listMarketplaces: vi.fn().mockResolvedValue([]),
            refreshMarketplaces: vi.fn().mockResolvedValue(undefined),
          } as unknown as MarketplaceService;
        });
      mockConfigurationService.getMergedEnabledPlugins.mockReturnValue({
        "p1@m1": true,
      });
      installedAt(oldRoot);
      stubPluginArtifacts({
        name: "p1",
        version: "1.0.0",
        description: "d",
      } as PluginManifest);
      await pluginManager.loadPlugins([]);
      expect(mockHookManager.registerPluginHooks).toHaveBeenCalledWith(
        oldRoot,
        expect.anything(),
      );

      installedAt(newRoot);
      await pluginManager.reloadAllPlugins();

      expect(mockHookManager.unregisterPluginHooks).toHaveBeenCalledWith(
        oldRoot,
      );
      expect(mockHookManager.registerPluginHooks).toHaveBeenLastCalledWith(
        newRoot,
        expect.anything(),
      );
      expect(mockMcpManager.removeServersForPlugin).toHaveBeenCalledWith(
        oldRoot,
      );
      expect(mockMcpManager.addServer).toHaveBeenLastCalledWith(
        "srv",
        expect.objectContaining({ pluginRoot: newRoot }),
      );
      expect(mockLspManager.registerServer).toHaveBeenLastCalledWith(
        "go",
        expect.objectContaining({ pluginRoot: newRoot }),
      );
    });

    it("is idempotent when nothing changed on disk", async () => {
      stubPluginArtifacts({
        name: "p1",
        version: "1.0.0",
        description: "d",
      } as PluginManifest);
      const configs = [{ type: "local", path: "plugins/p1" } as PluginConfig];
      await pluginManager.loadPlugins(configs);

      const first = await pluginManager.reloadAllPlugins();
      const second = await pluginManager.reloadAllPlugins();

      expect(second).toEqual(first);
      expect(second.plugins).toEqual(["p1"]);
      expect(second.failures).toEqual([]);
      // 不重复装载：插件列表长度不变，也不出现「already loaded」告警。
      expect(pluginManager.getPlugins()).toHaveLength(1);
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("already loaded"),
      );
      expect(PluginLoader.loadManifest).toHaveBeenCalledTimes(3);
    });

    it("honors an edited enabledPlugins record instead of the startup snapshot", async () => {
      // 场景 10：重载读的是磁盘当前的插件状态，不只是插件内容。
      vi.mocked(MarketplaceService).mockImplementation(function () {
        return {
          getInstalledPlugins: vi.fn().mockResolvedValue({
            plugins: [
              { name: "p1", marketplace: "m1", cachePath: "/cache/p1" },
            ],
          }),
          listMarketplaces: vi.fn().mockResolvedValue([]),
          refreshMarketplaces: vi.fn().mockResolvedValue(undefined),
        } as unknown as MarketplaceService;
      });
      mockConfigurationService.getMergedEnabledPlugins.mockReturnValue({});
      await pluginManager.loadPlugins([]);
      expect(pluginManager.getPlugin("p1")).toBeUndefined();

      mockConfigurationService.getMergedEnabledPlugins.mockReturnValue({
        "p1@m1": true,
      });
      const result = await pluginManager.reloadAllPlugins();

      expect(result.plugins).toEqual(["p1"]);
      expect(pluginManager.getPlugin("p1")).toBeDefined();

      mockConfigurationService.getMergedEnabledPlugins.mockReturnValue({
        "p1@m1": false,
      });
      const disabled = await pluginManager.reloadAllPlugins();

      expect(disabled.plugins).toEqual([]);
      expect(pluginManager.getPlugin("p1")).toBeUndefined();
      expect(mockMcpManager.removeServersForPlugin).toHaveBeenCalledWith(
        "/cache/p1",
      );
    });

    it("reports a broken plugin without rolling back the healthy ones", async () => {
      // 场景 11：不因单点失败回滚已成功的其它类，也不使会话不可用。
      const badRoot = path.resolve(workdir, "plugins/bad");
      const loadManifest = vi.mocked(PluginLoader.loadManifest);
      loadManifest.mockImplementation(async (pluginPath: string) => {
        if (pluginPath === badRoot) {
          throw new Error("manifest boom");
        }
        return {
          name: pluginPath === localRoot ? "p1" : "p2",
          version: "1.0.0",
          description: "d",
        } as PluginManifest;
      });
      vi.mocked(PluginLoader.loadCommands).mockReturnValue([]);
      vi.mocked(PluginLoader.loadSkills).mockResolvedValue([]);
      vi.mocked(PluginLoader.loadAgents).mockResolvedValue([]);
      const configs = [
        { type: "local", path: "plugins/p1" } as PluginConfig,
        { type: "local", path: "plugins/bad" } as PluginConfig,
      ];

      const first = await pluginManager.loadPlugins(configs);
      expect(first).toEqual([{ path: badRoot, error: "manifest boom" }]);

      const result = await pluginManager.reloadAllPlugins();

      expect(result.plugins).toEqual(["p1"]);
      expect(result.failures).toEqual([
        { path: badRoot, error: "manifest boom" },
      ]);
      expect(pluginManager.getPlugin("p1")).toBeDefined();
    });

    it("reports a plugin that broke since it was loaded and leaves nothing stale behind", async () => {
      stubPluginArtifacts({
        name: "p1",
        version: "1.0.0",
        description: "d",
      } as PluginManifest);
      const configs = [{ type: "local", path: "plugins/p1" } as PluginConfig];
      await pluginManager.loadPlugins(configs);

      vi.mocked(PluginLoader.loadManifest).mockRejectedValue(
        new Error("bad json"),
      );
      const result = await pluginManager.reloadAllPlugins();

      expect(result.plugins).toEqual([]);
      expect(result.failures).toEqual([{ path: localRoot, error: "bad json" }]);
      // 卸载在前：失败插件贡献的能力不得残留在注册表里。
      expect(
        mockSlashCommandManager.unregisterPluginCommands,
      ).toHaveBeenCalledWith("p1");
      expect(pluginManager.getPlugins()).toHaveLength(0);
    });
  });
});

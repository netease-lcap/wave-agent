import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "../src/agent.js";
import { MarketplaceService } from "../src/services/MarketplaceService.js";
import { PluginLoader } from "../src/services/pluginLoader.js";
import * as configPaths from "../src/utils/configPaths.js";
import type { WaveConfiguration } from "../src/types/configuration.js";
import * as fs from "fs";

vi.mock("../src/services/MarketplaceService.js");
vi.mock("../src/services/GitService.js");
vi.mock("../src/services/pluginLoader.js");
vi.mock("fs");

/** 用例控制的托管层（远端托管设置）：null = 本机没同步过任何托管配置。 */
const managedRemote = vi.hoisted(() => ({
  current: null as unknown,
}));

vi.mock("../src/services/remoteSettingsService.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../src/services/remoteSettingsService.js")
    >();
  const getRemoteSettingsSync = () =>
    managedRemote.current as WaveConfiguration | null;
  return {
    ...actual,
    getRemoteSettingsSync,
    // 配置链与插件加载读的是这个对象上的同名方法（spec enterprise
    // server-managed-config「托管配置下发插件市场与启用列表」）：初始化与后台
    // 抓取在测试里不需要真跑，读值统一由用例注入。
    remoteSettingsService: {
      ...actual.remoteSettingsService,
      getRemoteSettingsSync,
      initialize: () => undefined,
      startBackgroundFetch: () => undefined,
      onSettingsUpdate: () => () => undefined,
    },
  };
});

describe("Agent Plugin Loading Integration", () => {
  const workdir = "/test/workdir";
  let activeAgent: Agent | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    managedRemote.current = null;

    // Mock Marketplace to return 3 installed plugins
    vi.mocked(MarketplaceService).mockImplementation(function () {
      return {
        getInstalledPlugins: vi.fn().mockResolvedValue({
          plugins: [
            { name: "plugin-user", marketplace: "m1", cachePath: "/path/user" },
            {
              name: "plugin-project",
              marketplace: "m1",
              cachePath: "/path/project",
            },
            { name: "plugin-none", marketplace: "m1", cachePath: "/path/none" },
          ],
        }),
        listMarketplaces: vi.fn().mockResolvedValue([]),
        refreshMarketplaces: vi.fn().mockResolvedValue(undefined),
      } as unknown as MarketplaceService;
    });

    // Mock PluginLoader
    vi.mocked(PluginLoader.loadManifest).mockImplementation(async function (p) {
      return {
        name: p.split("/").pop()!,
        version: "1.0.0",
      } as unknown as Awaited<ReturnType<typeof PluginLoader.loadManifest>>;
    });
    vi.mocked(PluginLoader.loadCommands).mockReturnValue([]);
    vi.mocked(PluginLoader.loadSkills).mockResolvedValue([]);
    vi.mocked(PluginLoader.loadAgents).mockResolvedValue([]);
    vi.mocked(PluginLoader.loadLspConfig).mockResolvedValue(undefined);
    vi.mocked(PluginLoader.loadMcpConfig).mockResolvedValue(undefined);
    vi.mocked(PluginLoader.loadHooksConfig).mockResolvedValue(undefined);

    // Mock config paths
    vi.spyOn(configPaths, "getUserConfigPaths").mockReturnValue([
      "/user/settings.json",
    ]);
    vi.spyOn(configPaths, "getProjectConfigPaths").mockReturnValue([
      "/project/settings.local.json",
      "/project/settings.json",
    ]);

    // Mock fs.existsSync to simulate config files existence
    vi.mocked(fs.existsSync).mockImplementation(function (p: string) {
      if (p === "/user/settings.json") return true;
      if (p === "/project/settings.json") return true;
      return false;
    } as unknown as typeof fs.existsSync);

    // Mock fs.readFileSync to return different configs
    vi.mocked(fs.readFileSync).mockImplementation(function (p: string) {
      if (p === "/user/settings.json") {
        return JSON.stringify({
          enabledPlugins: { "plugin-user@m1": true },
        });
      }
      if (p === "/project/settings.json") {
        return JSON.stringify({
          enabledPlugins: { "plugin-project@m1": true },
        });
      }
      return "";
    } as unknown as typeof fs.readFileSync);
  });

  afterEach(async () => {
    if (activeAgent) {
      await activeAgent.destroy();
      activeAgent = undefined;
    }
  });

  it("should load plugins from both user and project configurations and skip unmentioned ones", async () => {
    const agent = await Agent.create({ workdir });
    activeAgent = agent;

    const loadedPlugins = agent["pluginManager"].getPlugins();
    const pluginNames = loadedPlugins.map((p) => p.name);
    // Should contain both enabled plugins
    expect(pluginNames).toContain("user");
    expect(pluginNames).toContain("project");

    // Should NOT contain the one not mentioned in any config
    expect(pluginNames).not.toContain("none");

    expect(loadedPlugins).toHaveLength(2);
  });

  /* 托管插件（spec enterprise server-managed-config「托管配置下发插件市场与启用
     列表」场景 2/4/5）：托管层的键压过本机同名键，本机独有的键照常生效，托管
     关掉的插件在本机怎么启用都不会加载。 */
  it("applies the managed enabledPlugins on top of the local files, per key", async () => {
    // 本机把 plugin-project@m1 显式禁用，托管层却要求它启用；plugin-user 是托管
    // 层没提过的本机插件（不得被托管下发挤掉）；plugin-none 托管层也没提，照旧
    // 不加载。
    vi.mocked(fs.readFileSync).mockImplementation(function (p: string) {
      if (p === "/user/settings.json") {
        return JSON.stringify({
          enabledPlugins: { "plugin-user@m1": true },
        });
      }
      if (p === "/project/settings.json") {
        return JSON.stringify({
          enabledPlugins: { "plugin-project@m1": false },
        });
      }
      return "";
    } as unknown as typeof fs.readFileSync);
    managedRemote.current = {
      enabledPlugins: { "plugin-project@m1": true },
    };

    const agent = await Agent.create({ workdir });
    activeAgent = agent;

    const pluginNames = agent["pluginManager"].getPlugins().map((p) => p.name);
    expect(pluginNames).toContain("project");
    expect(pluginNames).toContain("user");
    expect(pluginNames).not.toContain("none");
  });

  it("keeps a managed false force-disabled even when the local chain enables it", async () => {
    managedRemote.current = {
      enabledPlugins: { "plugin-user@m1": false },
    };

    const agent = await Agent.create({ workdir });
    activeAgent = agent;

    const pluginNames = agent["pluginManager"].getPlugins().map((p) => p.name);
    expect(pluginNames).not.toContain("user");
    expect(pluginNames).toContain("project");
  });
});

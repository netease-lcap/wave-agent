import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "../src/agent.js";
import { MarketplaceService } from "../src/services/MarketplaceService.js";
import { PluginLoader } from "../src/services/pluginLoader.js";
import * as configPaths from "../src/utils/configPaths.js";
import * as fs from "fs";

vi.mock("../src/services/MarketplaceService.js");
vi.mock("../src/services/pluginLoader.js");
vi.mock("../src/utils/configPaths.js");
vi.mock("fs");

describe("Agent Plugin Loading Integration", () => {
  const workdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();

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
    vi.mocked(PluginLoader.loadLspConfig).mockResolvedValue(undefined);
    vi.mocked(PluginLoader.loadMcpConfig).mockResolvedValue(undefined);
    vi.mocked(PluginLoader.loadHooksConfig).mockResolvedValue(undefined);

    // Mock config paths
    vi.mocked(configPaths.getUserConfigPaths).mockReturnValue([
      "/user/settings.local.json",
      "/user/settings.json",
    ]);
    vi.mocked(configPaths.getProjectConfigPaths).mockReturnValue([
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

  it("should load plugins from both user and project configurations and skip unmentioned ones", async () => {
    const agent = await Agent.create({ workdir });

    const loadedPlugins = agent["pluginManager"].getPlugins();
    const pluginNames = loadedPlugins.map((p) => p.name);
    // Should contain both enabled plugins
    expect(pluginNames).toContain("user");
    expect(pluginNames).toContain("project");

    // Should NOT contain the one not mentioned in any config
    expect(pluginNames).not.toContain("none");

    expect(loadedPlugins).toHaveLength(2);
  });
});

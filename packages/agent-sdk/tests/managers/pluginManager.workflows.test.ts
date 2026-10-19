import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PluginManager } from "../../src/managers/pluginManager.js";
import { PluginLoader } from "../../src/services/pluginLoader.js";
import { Container } from "../../src/utils/container.js";
import { WorkflowRegistry } from "../../src/workflow/workflowRegistry.js";

describe("PluginManager workflows registration", () => {
  let container: Container;
  let registry: WorkflowRegistry;
  let manager: PluginManager;

  beforeEach(() => {
    container = new Container();
    container.register("Workdir", "/test/workdir");
    registry = new WorkflowRegistry("/test/workdir");
    container.register("WorkflowRegistry", registry);

    vi.spyOn(PluginLoader, "loadManifest").mockResolvedValue({
      name: "test-plugin",
      description: "A test plugin",
      version: "1.0.0",
    });
    vi.spyOn(PluginLoader, "loadCommands").mockReturnValue([]);
    vi.spyOn(PluginLoader, "loadSkills").mockResolvedValue([]);
    vi.spyOn(PluginLoader, "loadAgents").mockResolvedValue([]);
    vi.spyOn(PluginLoader, "loadLspConfig").mockResolvedValue(undefined);
    vi.spyOn(PluginLoader, "loadMcpConfig").mockResolvedValue(undefined);
    vi.spyOn(PluginLoader, "loadHooksConfig").mockResolvedValue(undefined);
    vi.spyOn(PluginLoader, "loadWorkflows").mockResolvedValue([
      {
        name: "scan",
        description: "Scan a repo",
        path: "/test/plugin/workflows/scan.js",
        meta: { name: "scan", description: "Scan a repo" },
      },
    ]);

    manager = new PluginManager(container, { workdir: "/test/workdir" });
    // Only the local-config path matters here.
    vi.spyOn(
      manager as unknown as { loadInstalledPlugins: () => Promise<void> },
      "loadInstalledPlugins",
    ).mockResolvedValue(undefined);
    vi.spyOn(
      manager as unknown as { loadBuiltinPlugins: () => Promise<void> },
      "loadBuiltinPlugins",
    ).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a plugin's workflows under `<plugin>:<name>`", async () => {
    await manager.loadPlugins([{ type: "local", path: "/test/plugin" }]);

    const resolved = registry.resolve("test-plugin:scan");
    expect(resolved?.source).toBe("plugin");
    expect(resolved?.path).toBe("/test/plugin/workflows/scan.js");
    expect(resolved?.pluginName).toBe("test-plugin");
  });

  it("drops them when the plugin is unloaded", async () => {
    await manager.loadPlugins([{ type: "local", path: "/test/plugin" }]);
    expect(registry.resolve("test-plugin:scan")).toBeDefined();

    await manager.unloadPlugin("test-plugin");
    expect(registry.resolve("test-plugin:scan")).toBeUndefined();
  });
});

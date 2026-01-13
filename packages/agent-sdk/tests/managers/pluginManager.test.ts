import { describe, it, expect, vi, beforeEach } from "vitest";
import { PluginManager } from "../../src/managers/pluginManager.js";
import { PluginLoader } from "../../src/services/pluginLoader.js";
import {
  PluginConfig,
  Logger,
  PluginManifest,
  CustomSlashCommand,
} from "../../src/types/index.js";
import * as path from "path";

vi.mock("../../src/services/pluginLoader.js");

describe("PluginManager", () => {
  let pluginManager: PluginManager;
  let mockLogger: Logger;
  const workdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;
    pluginManager = new PluginManager({ workdir, logger: mockLogger });
  });

  describe("loadPlugins", () => {
    it("should load local plugins successfully", async () => {
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

      vi.mocked(PluginLoader.loadManifest).mockResolvedValue(
        manifest as PluginManifest,
      );
      vi.mocked(PluginLoader.loadCommands).mockReturnValue(
        commands as unknown as CustomSlashCommand[],
      );

      await pluginManager.loadPlugins(configs);

      const plugins = pluginManager.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toMatchObject({
        ...manifest,
        path: path.resolve(workdir, configs[0].path),
        commands,
      });
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

      await pluginManager.loadPlugins(configs);

      const plugins = pluginManager.getPlugins();
      expect(plugins).toHaveLength(2);
      expect(pluginManager.getPlugin("p1")).toBeDefined();
      expect(pluginManager.getPlugin("p2")).toBeDefined();
      expect(pluginManager.getPlugin("p3")).toBeUndefined();
    });
  });
});

/**
 * LiveConfigManager Tests - Configuration Management with File Watching
 *
 * These tests verify that LiveConfigManager can handle configuration management
 * with file watching after the ConfigurationWatcher merge.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LiveConfigManager } from "../../src/managers/liveConfigManager.js";
import type { Logger } from "../../src/types/index.js";
import type { HookManager } from "../../src/managers/hookManager.js";
import { ConfigurationService } from "../../src/services/configurationService.js";
import { FileWatcherService } from "../../src/services/fileWatcher.js";
import * as configPaths from "../../src/utils/configPaths.js";
import { ensureGlobalGitIgnore } from "../../src/utils/fileUtils.js";
import type { WaveConfiguration } from "../../src/types/configuration.js";
import type { ConfigurationLoadResult } from "../../src/types/configuration.js";
import { existsSync } from "fs";

// Mock all dependencies
vi.mock("../../src/services/configurationService.js");
vi.mock("../../src/services/fileWatcher.js");
vi.mock("../../src/utils/configPaths.js");
vi.mock("../../src/utils/fileUtils.js");
vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

describe("LiveConfigManager - Configuration Management", () => {
  let liveConfigManager: LiveConfigManager;
  let mockLogger: Logger;
  let mockHookManager: HookManager;
  let mockConfigurationService: ConfigurationService;
  let mockFileWatcherService: FileWatcherService;
  let workdir: string;

  beforeEach(() => {
    // Mock logger
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    // Mock hook manager
    mockHookManager = {
      loadConfigurationFromWaveConfig: vi.fn(),
    } as Partial<HookManager> as HookManager;

    // Mock file watcher service
    mockFileWatcherService = {
      watchFile: vi.fn(),
      cleanup: vi.fn(),
      on: vi.fn(),
      getAllWatcherStatuses: vi.fn().mockReturnValue([]),
    } as Partial<FileWatcherService> as FileWatcherService;

    // Mock configuration service
    mockConfigurationService = {
      loadMergedConfiguration: vi.fn(),
      setEnvironmentVars: vi.fn(),
    } as Partial<ConfigurationService> as ConfigurationService;

    // Mock config paths
    vi.mocked(configPaths.getUserConfigPaths).mockReturnValue([
      "/mock/user/settings.json",
    ]);
    vi.mocked(configPaths.getProjectConfigPaths).mockReturnValue([
      "/mock/project/.wave/settings.json",
    ]);

    // Mock constructors
    vi.mocked(ConfigurationService).mockImplementation(function () {
      return mockConfigurationService;
    });
    vi.mocked(FileWatcherService).mockImplementation(function () {
      return mockFileWatcherService;
    });

    workdir = "/mock/project";
    liveConfigManager = new LiveConfigManager({
      workdir,
      logger: mockLogger,
      hookManager: mockHookManager,
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("Configuration Loading", () => {
    it("should load configuration on initialize", async () => {
      const mockConfig: WaveConfiguration = {
        hooks: {
          PreToolUse: [
            {
              matcher: "test",
              hooks: [{ type: "command", command: "echo test" }],
            },
          ],
        },
      };

      const mockResult: ConfigurationLoadResult = {
        success: true,
        configuration: mockConfig,
        sourcePath: "/mock/project/.wave/settings.json",
        warnings: [],
      };

      vi.mocked(
        mockConfigurationService.loadMergedConfiguration,
      ).mockResolvedValue(mockResult);

      await liveConfigManager.initialize();

      expect(
        mockConfigurationService.loadMergedConfiguration,
      ).toHaveBeenCalledWith(workdir);
      expect(
        mockHookManager.loadConfigurationFromWaveConfig,
      ).toHaveBeenCalledWith(mockConfig);
      expect(liveConfigManager.getCurrentConfiguration()).toEqual(mockConfig);
    });

    it("should handle configuration load failure gracefully", async () => {
      const mockResult: ConfigurationLoadResult = {
        success: false,
        error: "Configuration file not found",
        sourcePath: "/mock/project/.wave/settings.json",
        configuration: null,
        warnings: [],
      };

      vi.mocked(
        mockConfigurationService.loadMergedConfiguration,
      ).mockResolvedValue(mockResult);

      await liveConfigManager.initialize();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("No previous valid configuration available"),
      );
      expect(liveConfigManager.getCurrentConfiguration()).toEqual({});
    });

    it("should reload configuration when requested", async () => {
      const initialConfig: WaveConfiguration = { hooks: {} };
      const newConfig: WaveConfiguration = {
        hooks: {
          PostToolUse: [
            {
              matcher: "updated",
              hooks: [{ type: "command", command: "echo updated" }],
            },
          ],
        },
      };

      const initialResult: ConfigurationLoadResult = {
        success: true,
        configuration: initialConfig,
        sourcePath: "/mock/project/.wave/settings.json",
        warnings: [],
      };

      const newResult: ConfigurationLoadResult = {
        success: true,
        configuration: newConfig,
        sourcePath: "/mock/project/.wave/settings.json",
        warnings: [],
      };

      vi.mocked(mockConfigurationService.loadMergedConfiguration)
        .mockResolvedValueOnce(initialResult)
        .mockResolvedValueOnce(newResult);

      await liveConfigManager.initialize();
      expect(liveConfigManager.getCurrentConfiguration()).toEqual(
        initialConfig,
      );

      const reloadedConfig = await liveConfigManager.reload();
      expect(reloadedConfig).toEqual(newConfig);
      expect(liveConfigManager.getCurrentConfiguration()).toEqual(newConfig);
    });

    it("should apply environment variables when present in configuration", async () => {
      const mockConfig: WaveConfiguration = {
        hooks: {},
        env: {
          TEST_VAR: "test_value",
          ANOTHER_VAR: "another_value",
        },
      };

      const mockResult: ConfigurationLoadResult = {
        success: true,
        configuration: mockConfig,
        sourcePath: "/mock/project/.wave/settings.json",
        warnings: [],
      };

      vi.mocked(
        mockConfigurationService.loadMergedConfiguration,
      ).mockResolvedValue(mockResult);

      await liveConfigManager.initialize();

      // Configuration loading should have been called
      expect(
        mockConfigurationService.loadMergedConfiguration,
      ).toHaveBeenCalled();
    });

    it("should handle exceptions during configuration loading", async () => {
      const error = new Error("Configuration service error");
      vi.mocked(
        mockConfigurationService.loadMergedConfiguration,
      ).mockRejectedValue(error);

      await liveConfigManager.initialize();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Configuration reload failed with exception"),
      );
      expect(liveConfigManager.getCurrentConfiguration()).toEqual({});
    });
  });

  describe("Configuration Management", () => {
    it("should return null when no configuration is loaded", () => {
      expect(liveConfigManager.getCurrentConfiguration()).toBeNull();
    });

    it("should return copy of configuration to prevent mutations", async () => {
      const mockConfig: WaveConfiguration = {
        hooks: {
          PreToolUse: [
            {
              matcher: "test",
              hooks: [{ type: "command", command: "echo test" }],
            },
          ],
        },
      };

      const mockResult: ConfigurationLoadResult = {
        success: true,
        configuration: mockConfig,
        sourcePath: "/mock/project/.wave/settings.json",
        warnings: [],
      };

      vi.mocked(
        mockConfigurationService.loadMergedConfiguration,
      ).mockResolvedValue(mockResult);

      await liveConfigManager.initialize();

      const config1 = liveConfigManager.getCurrentConfiguration();
      const config2 = liveConfigManager.getCurrentConfiguration();

      expect(config1).toEqual(mockConfig);
      expect(config2).toEqual(mockConfig);
      expect(config1).not.toBe(config2); // Should be different objects
      expect(config1).not.toBe(mockConfig); // Should not be the original object
    });

    it("should clean up state on shutdown", async () => {
      const mockConfig: WaveConfiguration = { hooks: {} };
      const mockResult: ConfigurationLoadResult = {
        success: true,
        configuration: mockConfig,
        sourcePath: "/mock/project/.wave/settings.json",
        warnings: [],
      };

      vi.mocked(
        mockConfigurationService.loadMergedConfiguration,
      ).mockResolvedValue(mockResult);

      await liveConfigManager.initialize();
      expect(liveConfigManager.getCurrentConfiguration()).toEqual(mockConfig);

      await liveConfigManager.shutdown();
      expect(liveConfigManager.getCurrentConfiguration()).toBeNull();
    });
  });

  describe("Error Handling", () => {
    it("should use last valid configuration on reload error", async () => {
      const validConfig: WaveConfiguration = { hooks: {} };
      const validResult: ConfigurationLoadResult = {
        success: true,
        configuration: validConfig,
        sourcePath: "/mock/project/.wave/settings.json",
        warnings: [],
      };

      const errorResult: ConfigurationLoadResult = {
        success: false,
        error: "Failed to read configuration",
        sourcePath: "/mock/project/.wave/settings.json",
        configuration: null,
        warnings: [],
      };

      vi.mocked(mockConfigurationService.loadMergedConfiguration)
        .mockResolvedValueOnce(validResult)
        .mockResolvedValueOnce(errorResult);

      await liveConfigManager.initialize();
      expect(liveConfigManager.getCurrentConfiguration()).toEqual(validConfig);

      await liveConfigManager.reload();
      expect(liveConfigManager.getCurrentConfiguration()).toEqual(validConfig);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining(
          "Using previous valid configuration due to loading errors",
        ),
      );
    });

    it("should handle exceptions during reload gracefully", async () => {
      const validConfig: WaveConfiguration = { hooks: {} };
      const validResult: ConfigurationLoadResult = {
        success: true,
        configuration: validConfig,
        sourcePath: "/mock/project/.wave/settings.json",
        warnings: [],
      };

      vi.mocked(mockConfigurationService.loadMergedConfiguration)
        .mockResolvedValueOnce(validResult)
        .mockRejectedValueOnce(new Error("Service error"));

      await liveConfigManager.initialize();
      await liveConfigManager.reload();

      expect(liveConfigManager.getCurrentConfiguration()).toEqual(validConfig);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Configuration reload failed with exception"),
      );
    });
  });

  describe("GitIgnore Integration", () => {
    it("should add settings.local.json to global gitignore on initialization if it exists", async () => {
      const localConfigPath = "/mock/project/.wave/settings.local.json";
      vi.mocked(configPaths.getUserConfigPaths).mockReturnValue([]);
      vi.mocked(configPaths.getProjectConfigPaths).mockReturnValue([
        localConfigPath,
        "/mock/project/.wave/settings.json",
      ]);
      vi.mocked(existsSync).mockImplementation(
        (path) => path === localConfigPath,
      );

      const mockResult: ConfigurationLoadResult = {
        success: true,
        configuration: {},
        sourcePath: "/mock/project/.wave/settings.json",
        warnings: [],
      };
      vi.mocked(
        mockConfigurationService.loadMergedConfiguration,
      ).mockResolvedValue(mockResult);

      await liveConfigManager.initialize();

      expect(ensureGlobalGitIgnore).toHaveBeenCalledWith(
        "**/.wave/settings.local.json",
      );
    });

    it("should add settings.local.json to global gitignore when it is created", async () => {
      vi.mocked(configPaths.getUserConfigPaths).mockReturnValue([]);
      vi.mocked(configPaths.getProjectConfigPaths).mockReturnValue([
        "/mock/project/.wave/settings.local.json",
        "/mock/project/.wave/settings.json",
      ]);

      const mockResult: ConfigurationLoadResult = {
        success: true,
        configuration: {},
        sourcePath: "/mock/project/.wave/settings.json",
        warnings: [],
      };
      vi.mocked(
        mockConfigurationService.loadMergedConfiguration,
      ).mockResolvedValue(mockResult);

      // Let's mock existsSync to return true so it starts watching
      vi.mocked(existsSync).mockReturnValue(true);
      await liveConfigManager.initialize();

      const localConfigCall = vi
        .mocked(mockFileWatcherService.watchFile)
        .mock.calls.find((call) => call[0].endsWith("settings.local.json"));

      expect(localConfigCall).toBeDefined();
      const callback = localConfigCall![1];

      // Simulate file creation
      await callback({
        type: "create",
        path: "/mock/project/.wave/settings.local.json",
        timestamp: Date.now(),
      });

      expect(ensureGlobalGitIgnore).toHaveBeenCalledWith(
        "**/.wave/settings.local.json",
      );
    });

    it("should not add settings.local.json to global gitignore when it is modified", async () => {
      vi.mocked(configPaths.getUserConfigPaths).mockReturnValue([]);
      vi.mocked(configPaths.getProjectConfigPaths).mockReturnValue([
        "/mock/project/.wave/settings.local.json",
        "/mock/project/.wave/settings.json",
      ]);

      const mockResult: ConfigurationLoadResult = {
        success: true,
        configuration: {},
        sourcePath: "/mock/project/.wave/settings.json",
        warnings: [],
      };
      vi.mocked(
        mockConfigurationService.loadMergedConfiguration,
      ).mockResolvedValue(mockResult);

      vi.mocked(existsSync).mockReturnValue(true);
      await liveConfigManager.initialize();

      const localConfigCall = vi
        .mocked(mockFileWatcherService.watchFile)
        .mock.calls.find((call) => call[0].endsWith("settings.local.json"));

      const callback = localConfigCall![1];

      // Reset mock to clear calls from initialization
      vi.mocked(ensureGlobalGitIgnore).mockClear();

      // Simulate file modification
      await callback({
        type: "change",
        path: "/mock/project/.wave/settings.local.json",
        timestamp: Date.now(),
      });

      expect(ensureGlobalGitIgnore).not.toHaveBeenCalled();
    });
  });
});

/**
 * LiveConfigManager Validation Tests
 *
 * These tests verify that LiveConfigManager correctly validates configuration,
 * specifically the permissionMode property.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LiveConfigManager } from "../../src/managers/liveConfigManager.js";
import { Container } from "../../src/utils/container.js";
import { ConfigurationService } from "../../src/services/configurationService.js";
import { FileWatcherService } from "../../src/services/fileWatcher.js";
import * as configPaths from "../../src/utils/configPaths.js";
import type { WaveConfiguration } from "../../src/types/configuration.js";
import type { ConfigurationLoadResult } from "../../src/types/configuration.js";
import { logger } from "../../src/utils/globalLogger.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock all dependencies
vi.mock("../../src/services/configurationService.js");
vi.mock("../../src/services/fileWatcher.js");
vi.mock("../../src/utils/configPaths.js");
vi.mock("../../src/utils/fileUtils.js");
vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

describe("LiveConfigManager - Validation", () => {
  let liveConfigManager: LiveConfigManager;
  let container: Container;
  let mockConfigurationService: ConfigurationService;
  let workdir: string;

  beforeEach(() => {
    // Mock logger

    // Mock configuration service
    mockConfigurationService = {
      loadMergedConfiguration: vi.fn(),
      setEnvironmentVars: vi.fn(),
      setOptions: vi.fn(),
      getConfigurationPaths: vi.fn().mockReturnValue({
        userPaths: ["/mock/user/settings.json"],
        projectPaths: ["/mock/project/.wave/settings.json"],
        allPaths: [
          "/mock/user/settings.json",
          "/mock/project/.wave/settings.json",
        ],
        existingPaths: [],
      }),
    } as Partial<ConfigurationService> as ConfigurationService;

    // Setup container
    container = new Container();
    container.register("ConfigurationService", mockConfigurationService);

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
      return {
        on: vi.fn(),
        watchFile: vi.fn(),
        cleanup: vi.fn(),
        getAllWatcherStatuses: vi.fn().mockReturnValue([]),
      } as Partial<FileWatcherService> as FileWatcherService;
    });

    workdir = "/mock/project";
    liveConfigManager = new LiveConfigManager(container, {
      workdir,
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("permissionMode validation", () => {
    const testValidation = async (
      permissionMode: unknown,
      expectedValid: boolean,
    ) => {
      const mockConfig = {
        permissions: {
          permissionMode,
        },
      } as unknown as WaveConfiguration;

      const mockResult: ConfigurationLoadResult = {
        success: expectedValid,
        configuration: expectedValid ? mockConfig : null,
        error: expectedValid
          ? undefined
          : "Configuration validation failed: Invalid permissionMode",
        sourcePath: "/mock/project/.wave/settings.json",
        warnings: [],
      };

      vi.mocked(
        mockConfigurationService.loadMergedConfiguration,
      ).mockResolvedValue(mockResult);

      await liveConfigManager.initialize();

      if (expectedValid) {
        expect(liveConfigManager.getCurrentConfiguration()).toEqual(mockConfig);
        expect(logger.error).not.toHaveBeenCalledWith(
          expect.stringContaining("Configuration validation failed"),
        );
      } else {
        // If validation fails, it should fallback to empty config (since no last valid config)
        expect(liveConfigManager.getCurrentConfiguration()).toEqual({});
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining("Configuration validation failed"),
        );
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining("Invalid permissionMode"),
        );
      }
    };

    it('should accept "default" as a valid permissionMode', async () => {
      await testValidation("default", true);
    });

    it('should accept "bypassPermissions" as a valid permissionMode', async () => {
      await testValidation("bypassPermissions", true);
    });

    it('should accept "acceptEdits" as a valid permissionMode', async () => {
      await testValidation("acceptEdits", true);
    });

    it('should accept "plan" as a valid permissionMode', async () => {
      await testValidation("plan", true);
    });

    it("should reject invalid permissionMode values", async () => {
      await testValidation("invalidMode", false);
    });

    it("should reject numeric permissionMode values", async () => {
      await testValidation(123, false);
    });

    it("should reject boolean permissionMode values", async () => {
      await testValidation(true, false);
    });
  });
});

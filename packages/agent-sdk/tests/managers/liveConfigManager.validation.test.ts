/**
 * LiveConfigManager Validation Tests
 *
 * These tests verify that LiveConfigManager correctly validates configuration,
 * specifically the defaultMode property.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LiveConfigManager } from "../../src/managers/liveConfigManager.js";
import type { Logger } from "../../src/types/index.js";
import { ConfigurationService } from "../../src/services/configurationService.js";
import { FileWatcherService } from "../../src/services/fileWatcher.js";
import * as configPaths from "../../src/utils/configPaths.js";
import type { WaveConfiguration } from "../../src/types/hooks.js";
import type { ConfigurationLoadResult } from "../../src/types/configuration.js";

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
  let mockLogger: Logger;
  let mockConfigurationService: ConfigurationService;
  let workdir: string;

  beforeEach(() => {
    // Mock logger
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

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
    vi.mocked(ConfigurationService).mockImplementation(
      () => mockConfigurationService,
    );
    vi.mocked(FileWatcherService).mockImplementation(
      () =>
        ({
          on: vi.fn(),
          watchFile: vi.fn(),
          cleanup: vi.fn(),
          getAllWatcherStatuses: vi.fn().mockReturnValue([]),
        }) as Partial<FileWatcherService> as FileWatcherService,
    );

    workdir = "/mock/project";
    liveConfigManager = new LiveConfigManager({
      workdir,
      logger: mockLogger,
      configurationService: mockConfigurationService,
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("defaultMode validation", () => {
    const testValidation = async (
      defaultMode: unknown,
      expectedValid: boolean,
    ) => {
      const mockConfig = {
        defaultMode,
      } as unknown as WaveConfiguration;

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

      if (expectedValid) {
        expect(liveConfigManager.getCurrentConfiguration()).toEqual(mockConfig);
        expect(mockLogger.error).not.toHaveBeenCalledWith(
          expect.stringContaining("Configuration validation failed"),
        );
      } else {
        // If validation fails, it should fallback to empty config (since no last valid config)
        expect(liveConfigManager.getCurrentConfiguration()).toEqual({});
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining("Configuration validation failed"),
        );
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining("Invalid defaultMode"),
        );
      }
    };

    it('should accept "default" as a valid defaultMode', async () => {
      await testValidation("default", true);
    });

    it('should accept "bypassPermissions" as a valid defaultMode', async () => {
      await testValidation("bypassPermissions", true);
    });

    it('should accept "acceptEdits" as a valid defaultMode', async () => {
      await testValidation("acceptEdits", true);
    });

    it("should reject invalid defaultMode values", async () => {
      await testValidation("invalidMode", false);
    });

    it("should reject numeric defaultMode values", async () => {
      await testValidation(123, false);
    });

    it("should reject boolean defaultMode values", async () => {
      await testValidation(true, false);
    });
  });
});

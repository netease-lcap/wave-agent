import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";
import { existsSync, readFileSync, promises as fs } from "fs";
import * as path from "path";
import { ConfigurationService } from "../../src/services/configurationService.js";
import { WaveConfiguration } from "../../src/types/configuration.js";

vi.mock("os", async () => {
  const actual = await vi.importActual("os");
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue("/test/userhome"),
  };
});

vi.mock("fs", async () => {
  return {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    promises: {
      mkdir: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
    },
  };
});

describe("ConfigurationService - Plugins", () => {
  let configService: ConfigurationService;
  const workdir = "/test/workdir";
  const userHome = "/test/userhome";
  const mockStdout = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
  const mockStderr = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);
  const mockConsoleWarn = vi
    .spyOn(console, "warn")
    .mockImplementation(() => {});
  const mockConsoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue(userHome);
    configService = new ConfigurationService();
    vi.mocked(existsSync).mockImplementation(
      (p) => p === workdir || p === userHome || p === "/test",
    );
  });

  afterEach(() => {
    mockStdout.mockReset();
    mockStderr.mockReset();
    mockConsoleWarn.mockReset();
    mockConsoleError.mockReset();
  });

  describe("updateEnabledPlugin", () => {
    it("should update enabledPlugins in user scope", async () => {
      const userConfigPath = path.join(userHome, ".wave", "settings.json");
      vi.mocked(existsSync).mockImplementation(
        (p) => p === userConfigPath || p === workdir || p === userHome,
      );
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ enabledPlugins: { "old-plugin": true } }),
      );

      await configService.updateEnabledPlugin(
        workdir,
        "user",
        "test-plugin",
        false,
      );

      expect(fs.mkdir).toHaveBeenCalledWith(path.dirname(userConfigPath), {
        recursive: true,
      });
      expect(fs.writeFile).toHaveBeenCalledWith(
        userConfigPath,
        expect.stringContaining('"test-plugin": false'),
        "utf-8",
      );
      const writtenConfig = JSON.parse(
        vi.mocked(fs.writeFile).mock.calls[0][1] as string,
      );
      expect(writtenConfig.enabledPlugins).toEqual({
        "old-plugin": true,
        "test-plugin": false,
      });
    });

    it("should update enabledPlugins in project scope", async () => {
      const projectConfigPath = path.join(workdir, ".wave", "settings.json");
      vi.mocked(existsSync).mockImplementation(
        (p) => p === projectConfigPath || p === workdir,
      );
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));

      await configService.updateEnabledPlugin(
        workdir,
        "project",
        "test-plugin",
        true,
      );

      expect(fs.mkdir).toHaveBeenCalledWith(path.dirname(projectConfigPath), {
        recursive: true,
      });
      expect(fs.writeFile).toHaveBeenCalledWith(
        projectConfigPath,
        expect.stringContaining('"test-plugin": true'),
        "utf-8",
      );
    });

    it("should update enabledPlugins in local scope", async () => {
      const localConfigPath = path.join(
        workdir,
        ".wave",
        "settings.local.json",
      );
      vi.mocked(existsSync).mockImplementation(
        (p) => p === localConfigPath || p === workdir,
      );
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));

      await configService.updateEnabledPlugin(
        workdir,
        "local",
        "test-plugin",
        true,
      );

      expect(fs.mkdir).toHaveBeenCalledWith(path.dirname(localConfigPath), {
        recursive: true,
      });
      expect(fs.writeFile).toHaveBeenCalledWith(
        localConfigPath,
        expect.stringContaining('"test-plugin": true'),
        "utf-8",
      );
    });

    it("should handle missing config file by creating a new one", async () => {
      const localConfigPath = path.join(
        workdir,
        ".wave",
        "settings.local.json",
      );
      vi.mocked(existsSync).mockImplementation((p) => p === workdir);

      await configService.updateEnabledPlugin(
        workdir,
        "local",
        "test-plugin",
        true,
      );

      expect(fs.writeFile).toHaveBeenCalledWith(
        localConfigPath,
        expect.stringContaining('"test-plugin": true'),
        "utf-8",
      );
    });
  });

  describe("getMergedEnabledPlugins", () => {
    it("should merge enabledPlugins with correct priority (local > project > user)", () => {
      const userJsonPath = path.join(userHome, ".wave", "settings.json");
      const projectJsonPath = path.join(workdir, ".wave", "settings.json");
      const projectLocalPath = path.join(
        workdir,
        ".wave",
        "settings.local.json",
      );

      vi.mocked(existsSync).mockImplementation((p) => {
        return [userJsonPath, projectJsonPath, projectLocalPath].includes(
          p.toString(),
        );
      });

      vi.mocked(readFileSync).mockImplementation((p) => {
        const pathStr = p.toString();
        if (pathStr === userJsonPath) {
          return JSON.stringify({
            enabledPlugins: { p1: true, p2: true, p3: true },
          });
        }
        if (pathStr === projectJsonPath) {
          return JSON.stringify({ enabledPlugins: { p2: false, p3: true } });
        }
        if (pathStr === projectLocalPath) {
          return JSON.stringify({ enabledPlugins: { p3: false } });
        }
        return "";
      });

      const merged = configService.getMergedEnabledPlugins(workdir);

      expect(merged).toEqual({
        p1: true, // from user
        p2: false, // from project (overrides user)
        p3: false, // from local (overrides project and user)
      });
    });
  });

  describe("findPluginScope", () => {
    it("should find plugin in local scope", () => {
      const projectLocalPath = path.join(
        workdir,
        ".wave",
        "settings.local.json",
      );
      vi.mocked(existsSync).mockImplementation((p) => p === projectLocalPath);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ enabledPlugins: { "test-plugin": true } }),
      );

      const scope = configService.findPluginScope(workdir, "test-plugin");
      expect(scope).toBe("local");
    });

    it("should find plugin in project scope", () => {
      const projectJsonPath = path.join(workdir, ".wave", "settings.json");
      vi.mocked(existsSync).mockImplementation((p) => p === projectJsonPath);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ enabledPlugins: { "test-plugin": true } }),
      );

      const scope = configService.findPluginScope(workdir, "test-plugin");
      expect(scope).toBe("project");
    });

    it("should find plugin in user scope", () => {
      const userJsonPath = path.join(userHome, ".wave", "settings.json");
      vi.mocked(existsSync).mockImplementation((p) => p === userJsonPath);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ enabledPlugins: { "test-plugin": true } }),
      );

      const scope = configService.findPluginScope(workdir, "test-plugin");
      expect(scope).toBe("user");
    });

    it("should return null if plugin not found in any scope", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const scope = configService.findPluginScope(workdir, "test-plugin");
      expect(scope).toBeNull();
    });
  });

  describe("validateConfiguration", () => {
    it("should validate enabledPlugins correctly", () => {
      const validConfig = {
        enabledPlugins: {
          "plugin-1": true,
          "plugin-2": false,
        },
      };
      const result = configService.validateConfiguration(
        validConfig as WaveConfiguration,
      );
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return error if enabledPlugins is not an object", () => {
      const invalidConfig = {
        enabledPlugins: "not-an-object",
      };
      const result = configService.validateConfiguration(
        invalidConfig as unknown as WaveConfiguration,
      );
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "enabledPlugins configuration must be an object",
      );
    });

    it("should return error if enabledPlugins values are not booleans", () => {
      const invalidConfig = {
        enabledPlugins: {
          "plugin-1": "true", // string instead of boolean
        },
      };
      const result = configService.validateConfiguration(
        invalidConfig as unknown as WaveConfiguration,
      );
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Value for plugin 'plugin-1' in enabledPlugins must be a boolean",
      );
    });
  });
});

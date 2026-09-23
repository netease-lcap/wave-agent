import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";
import { existsSync, readFileSync, promises as fs } from "fs";
import * as path from "path";
import { ConfigurationService } from "../../src/services/configurationService.js";
import { getRemoteSettingsSync } from "../../src/services/remoteSettingsService.js";
import { WaveConfiguration } from "../../src/types/configuration.js";

// 托管层来自远端设置的磁盘缓存（spec enterprise server-managed-config）；默认
// 返回 null = 从未同步过，本机配置说了算，不影响本文件其余用例。
vi.mock("../../src/services/remoteSettingsService.js", () => ({
  getRemoteSettingsSync: vi.fn(),
  mergeRemoteSettings: vi.fn(),
}));

vi.mock("fs", async () => {
  return {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    promises: {
      mkdir: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      rename: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
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
        expect.any(String),
        expect.stringContaining('"test-plugin": false'),
        "utf-8",
      );
      expect(fs.rename).toHaveBeenCalledWith(
        expect.any(String),
        userConfigPath,
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
        expect.any(String),
        expect.stringContaining('"test-plugin": true'),
        "utf-8",
      );
      expect(fs.rename).toHaveBeenCalledWith(
        expect.any(String),
        projectConfigPath,
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
        expect.any(String),
        expect.stringContaining('"test-plugin": true'),
        "utf-8",
      );
      expect(fs.rename).toHaveBeenCalledWith(
        expect.any(String),
        localConfigPath,
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
        expect.any(String),
        expect.stringContaining('"test-plugin": true'),
        "utf-8",
      );
      expect(fs.rename).toHaveBeenCalledWith(
        expect.any(String),
        localConfigPath,
      );
    });
  });

  describe("removeEnabledPlugin", () => {
    it("should remove plugin from user scope", async () => {
      const userConfigPath = path.join(userHome, ".wave", "settings.json");
      vi.mocked(existsSync).mockImplementation(
        (p) => p === userConfigPath || p === workdir || p === userHome,
      );
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          enabledPlugins: { "test-plugin": true, "other-plugin": false },
        }),
      );

      await configService.removeEnabledPlugin(workdir, "user", "test-plugin");

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"other-plugin"'),
        "utf-8",
      );
      expect(fs.rename).toHaveBeenCalledWith(
        expect.any(String),
        userConfigPath,
      );
      const writtenConfig = JSON.parse(
        vi.mocked(fs.writeFile).mock.calls[0][1] as string,
      );
      expect(writtenConfig.enabledPlugins).toEqual({
        "other-plugin": false,
      });
      expect(writtenConfig.enabledPlugins["test-plugin"]).toBeUndefined();
    });

    it("should remove plugin from project scope", async () => {
      const projectConfigPath = path.join(workdir, ".wave", "settings.json");
      vi.mocked(existsSync).mockImplementation(
        (p) => p === projectConfigPath || p === workdir,
      );
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          enabledPlugins: { "test-plugin": true },
        }),
      );

      await configService.removeEnabledPlugin(
        workdir,
        "project",
        "test-plugin",
      );

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("enabledPlugins"),
        "utf-8",
      );
      expect(fs.rename).toHaveBeenCalledWith(
        expect.any(String),
        projectConfigPath,
      );
      const writtenConfig = JSON.parse(
        vi.mocked(fs.writeFile).mock.calls[0][1] as string,
      );
      expect(writtenConfig.enabledPlugins).toEqual({});
    });

    it("should not fail if config file doesn't exist", async () => {
      vi.mocked(existsSync).mockImplementation((p) => p === workdir);

      await configService.removeEnabledPlugin(
        workdir,
        "project",
        "test-plugin",
      );

      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it("should not fail if plugin is not in config", async () => {
      const userConfigPath = path.join(userHome, ".wave", "settings.json");
      vi.mocked(existsSync).mockImplementation(
        (p) => p === userConfigPath || p === workdir || p === userHome,
      );
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          enabledPlugins: { "other-plugin": true },
        }),
      );

      await configService.removeEnabledPlugin(
        workdir,
        "user",
        "nonexistent-plugin",
      );

      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it("should handle corrupted config file gracefully", async () => {
      const userConfigPath = path.join(userHome, ".wave", "settings.json");
      vi.mocked(existsSync).mockImplementation(
        (p) => p === userConfigPath || p === workdir || p === userHome,
      );
      vi.mocked(fs.readFile).mockResolvedValue("invalid json{");

      await configService.removeEnabledPlugin(workdir, "user", "test-plugin");

      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe("getMergedEnabledPlugins", () => {
    it("should merge enabledPlugins with correct priority (local > project > user)", () => {
      const userJsonPath = path.join(userHome, ".wave", "settings.json");
      const projectJsonPath = path.join(workdir, ".wave", "settings.json");
      const localConfigPath = path.join(
        workdir,
        ".wave",
        "settings.local.json",
      );

      vi.mocked(existsSync).mockImplementation((p) => {
        return [userJsonPath, projectJsonPath, localConfigPath].includes(
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
        if (pathStr === localConfigPath) {
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

  /* 托管层（远端托管设置）与三个本机 settings.json 的合并（spec enterprise
     server-managed-config「托管配置下发插件市场与启用列表」场景 2/4/5）。 */
  describe("managed layer", () => {
    const userConfigPath = path.join(userHome, ".wave", "settings.json");

    beforeEach(() => {
      vi.mocked(getRemoteSettingsSync).mockReturnValue(null);
    });

    it("merges per key: managed wins on a clash, local-only keys survive", () => {
      vi.mocked(existsSync).mockImplementation(
        (p) => p === userConfigPath || p === workdir || p === userHome,
      );
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          enabledPlugins: { "local-only@mkt": true, "managed@mkt": false },
          marketplaces: {
            shared: { source: "local-url" },
            "local-only": { source: "local-url" },
          },
        }),
      );
      vi.mocked(getRemoteSettingsSync).mockReturnValue({
        enabledPlugins: { "managed@mkt": true },
        marketplaces: { shared: { source: "remote-url" } },
      } as unknown as WaveConfiguration);

      // 管理者只下发一个插件，成员本机已有的插件与市场照常生效
      expect(configService.getMergedEnabledPlugins(workdir)).toEqual({
        "local-only@mkt": true,
        "managed@mkt": true,
      });
      expect(configService.getMergedMarketplaces(workdir)).toEqual({
        shared: { source: "remote-url" },
        "local-only": { source: "local-url" },
      });
      // 托管取值单独可取：判定「是否受组织管理」只看这一份
      expect(configService.getManagedEnabledPlugins()).toEqual({
        "managed@mkt": true,
      });
    });

    it("reports no managed entries when the remote cache is empty", () => {
      // 缓存未加载（未登录 / 从未同步）时托管层不存在，本机配置说了算
      expect(configService.getManagedEnabledPlugins()).toBeNull();
      expect(configService.getManagedMarketplaces()).toBeNull();
    });
  });
});

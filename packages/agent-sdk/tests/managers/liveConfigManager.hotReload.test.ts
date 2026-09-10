/**
 * 热重载三处边界（docs/specs/core/agent-config.md「设置实时重载」场景 5–7）：
 *
 * - 场景 7：会话启动时用户级 settings.json 不存在，也不得漏掉「首次保存」——
 *   监视目标要落到「父目录已存在」的最深节点，而不是跳过不存在的路径。
 * - 场景 5：一轮对话内保持进入本轮时的配置快照，变更在下一轮开始时生效。
 * - 场景 6：自动记忆开关随 settings.json 变更幂等地增删系统级安全区白名单。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LiveConfigManager } from "../../src/managers/liveConfigManager.js";
import { Container } from "../../src/utils/container.js";
import type { HookManager } from "../../src/managers/hookManager.js";
import { ConfigurationService } from "../../src/services/configurationService.js";
import { FileWatcherService } from "../../src/services/fileWatcher.js";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import * as configPaths from "../../src/utils/configPaths.js";
import * as fs from "fs";
import type { WaveConfiguration } from "../../src/types/configuration.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../src/services/fileWatcher.js");
vi.mock("../../src/services/configurationService.js");
vi.mock("../../src/utils/configPaths.js");
// fs 由每个用例按需给 existsSync 装实现（监视目标解析依赖它）。
vi.mock("fs", () => ({ existsSync: vi.fn() }));

const USER_PATH = "/mock/home/.wave/settings.json";
const PROJECT_PATH = "/mock/project/.wave/settings.json";

describe("LiveConfigManager 热重载边界", () => {
  let liveConfigManager: LiveConfigManager;
  let container: Container;
  let mockPermissionManager: PermissionManager;
  let mockConfigurationService: ConfigurationService;
  let mockFileWatcherService: FileWatcherService;
  let currentConfig: WaveConfiguration | null;
  const existsSync = vi.mocked(fs.existsSync);

  /** 让监视目标解析看到「这些路径存在」。 */
  function existingPaths(paths: string[]): void {
    existsSync.mockImplementation((p) => paths.includes(String(p)));
  }

  function watchTargets(): string[] {
    return vi
      .mocked(mockFileWatcherService.watchFile)
      .mock.calls.map((c) => c[0]);
  }

  beforeEach(() => {
    currentConfig = null;
    existsSync.mockReset();

    mockPermissionManager = {
      updateConfiguredPermissionMode: vi.fn(),
      updateAllowedRules: vi.fn(),
      updateDeniedRules: vi.fn(),
      updateAdditionalDirectories: vi.fn(),
      addSystemAdditionalDirectory: vi.fn(),
      removeSystemAdditionalDirectory: vi.fn(),
    } as Partial<PermissionManager> as PermissionManager;

    mockFileWatcherService = {
      watchFile: vi.fn(),
      cleanup: vi.fn(),
      on: vi.fn(),
      getAllWatcherStatuses: vi.fn().mockReturnValue([]),
    } as Partial<FileWatcherService> as FileWatcherService;

    mockConfigurationService = {
      loadMergedConfiguration: vi.fn(async () => ({
        configuration: currentConfig,
        success: true,
        warnings: [],
      })),
      setEnvironmentVars: vi.fn(),
      setOptions: vi.fn(),
      resolveAutoMemoryEnabledNow: vi.fn().mockReturnValue(true),
      getConfigurationPaths: vi.fn().mockReturnValue({
        userPaths: [USER_PATH],
        projectPaths: [PROJECT_PATH],
        allPaths: [USER_PATH, PROJECT_PATH],
        existingPaths: [],
      }),
    } as Partial<ConfigurationService> as ConfigurationService;

    const mockHookManager = {
      loadConfigurationFromWaveConfig: vi.fn(),
    } as Partial<HookManager> as HookManager;

    container = new Container();
    container.register("HookManager", mockHookManager);
    container.register("PermissionManager", mockPermissionManager);
    container.register("ConfigurationService", mockConfigurationService);
    container.register("MemoryService", {
      getAutoMemoryDirectory: vi.fn((workdir: string) => `${workdir}/memory`),
    });

    vi.mocked(configPaths.getUserConfigPaths).mockReturnValue([USER_PATH]);
    vi.mocked(configPaths.getProjectConfigPaths).mockReturnValue([
      PROJECT_PATH,
    ]);
    vi.mocked(ConfigurationService).mockImplementation(function () {
      return mockConfigurationService;
    });
    vi.mocked(FileWatcherService).mockImplementation(function () {
      return mockFileWatcherService;
    });

    liveConfigManager = new LiveConfigManager(container, {
      workdir: "/mock/project",
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("场景 7：settings.json 启动时不存在也要接住首次保存", () => {
    it("文件不存在但父目录存在时，直接监视该文件路径", async () => {
      existingPaths(["/mock/home/.wave", "/mock/project/.wave"]);

      await liveConfigManager.initialize();

      expect(watchTargets()).toEqual([USER_PATH, PROJECT_PATH]);
    });

    it("父目录也缺失时，监视「父目录已存在」的最深节点（chokidar 才会接住新建）", async () => {
      existingPaths(["/mock/home", "/mock/project"]);

      await liveConfigManager.initialize();

      expect(watchTargets()).toEqual([
        "/mock/home/.wave",
        "/mock/project/.wave",
      ]);
    });

    it("文件已存在时监视文件本身", async () => {
      existingPaths([USER_PATH, PROJECT_PATH, "/mock/home/.wave"]);

      await liveConfigManager.initialize();

      expect(watchTargets()).toEqual([USER_PATH, PROJECT_PATH]);
    });
  });

  describe("场景 5：每轮开始取一次快照", () => {
    beforeEach(async () => {
      currentConfig = { language: "Chinese", autoMemoryFrequency: 5 };
      await liveConfigManager.initialize();
    });

    /**
     * 解析链读配置的语义（真实链路见 configurationService 的快照用例）：
     * 轮中有快照就读快照，否则读实时合并配置。
     */
    function readFrequency(): number | undefined {
      const snapshot = liveConfigManager.getTurnSnapshot();
      return snapshot
        ? snapshot.configuration?.autoMemoryFrequency
        : currentConfig?.autoMemoryFrequency;
    }

    it("轮次外没有快照（解析链读实时配置）", () => {
      expect(liveConfigManager.getTurnSnapshot()).toBeNull();
      expect(readFrequency()).toBe(5);
    });

    it("轮中落地的变更不改变本轮的读取结果，下一轮才生效", async () => {
      liveConfigManager.onTurnStart();
      expect(readFrequency()).toBe(5);

      // 轮中落地一次新配置（模拟 settings.json 被保存后 watcher 回读）
      currentConfig = { language: "Chinese", autoMemoryFrequency: 9 };
      await (
        liveConfigManager as unknown as {
          reloadConfiguration(): Promise<unknown>;
        }
      ).reloadConfiguration();

      expect(
        liveConfigManager.getCurrentConfiguration()?.autoMemoryFrequency,
      ).toBe(9);
      expect(readFrequency()).toBe(5); // 本轮固定

      liveConfigManager.onTurnEnd();
      expect(liveConfigManager.getTurnSnapshot()).toBeNull();
      expect(readFrequency()).toBe(9); // 下一轮起读到新值
    });

    it("嵌套轮次共享外层快照（子代理轮不重新取快照）", () => {
      liveConfigManager.onTurnStart();
      const outer = liveConfigManager.getTurnSnapshot();
      liveConfigManager.onTurnStart();
      expect(liveConfigManager.getTurnSnapshot()).toEqual(outer);

      liveConfigManager.onTurnEnd();
      // 外层仍在执行：快照不释放
      expect(liveConfigManager.getTurnSnapshot()).not.toBeNull();
      liveConfigManager.onTurnEnd();
      expect(liveConfigManager.getTurnSnapshot()).toBeNull();
    });

    it("多余的 onTurnEnd 不抛错（中止/异常路径可能不配对）", () => {
      liveConfigManager.onTurnEnd();
      expect(liveConfigManager.getTurnSnapshot()).toBeNull();
    });
  });

  describe("场景 6：自动记忆安全区随开关热更新", () => {
    const memoryDir = "/mock/project/memory";

    it("关闭自动记忆 → 移除自动记忆目录与用户记忆文件", async () => {
      currentConfig = { autoMemoryEnabled: true };
      vi.mocked(
        mockConfigurationService.resolveAutoMemoryEnabledNow,
      ).mockReturnValue(false);
      await liveConfigManager.initialize();

      expect(
        vi
          .mocked(mockPermissionManager.removeSystemAdditionalDirectory)
          .mock.calls.map((c) => c[0]),
      ).toEqual([memoryDir, expect.stringContaining("AGENTS.md")]);
      expect(
        mockPermissionManager.addSystemAdditionalDirectory,
      ).not.toHaveBeenCalled();
    });

    it("重新开启 → 两项都加回（幂等，重复调用不报错）", async () => {
      currentConfig = {};
      vi.mocked(
        mockConfigurationService.resolveAutoMemoryEnabledNow,
      ).mockReturnValue(true);
      await liveConfigManager.initialize();
      await (
        liveConfigManager as unknown as {
          reloadConfiguration(): Promise<unknown>;
        }
      ).reloadConfiguration();

      expect(
        vi
          .mocked(mockPermissionManager.addSystemAdditionalDirectory)
          .mock.calls.map((c) => c[0]),
      ).toEqual([
        memoryDir,
        expect.stringContaining("AGENTS.md"),
        memoryDir,
        expect.stringContaining("AGENTS.md"),
      ]);
    });
  });
});

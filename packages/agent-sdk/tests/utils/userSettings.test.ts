/**
 * 用户偏好读写（三端设置页保存路径的唯一实现）：
 * - 落点 = 用户级 `~/.wave/settings.json`，K↔`env.WAVE_MAX_INPUT_TOKENS` 换算只在此处
 * - 写入是读-改-写：只覆盖四个偏好键，其余顶层键与 `env` 其它键原样保留
 * - 文件缺失/损坏只影响回读（返回空对象），但**绝不覆盖**用户文件（写入报错）
 *
 * 见 docs/specs/core/agent-config.md「设置实时重载」场景 4/7 与
 * 「IDE 插件配置入口」场景 3/6。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("../../src/utils/atomicWrite.js", () => ({
  atomicWriteFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/utils/configPaths.js", () => ({
  getUserConfigPaths: vi.fn(() => ["/mock/home/.wave/settings.json"]),
}));

import { existsSync, mkdirSync, readFileSync } from "fs";
import { atomicWriteFile } from "../../src/utils/atomicWrite.js";
import {
  MAX_INPUT_TOKENS_ENV_KEY,
  contextLengthToMaxInputTokens,
  maxInputTokensToContextLength,
  readUserPreferenceSettings,
  readUserPreferenceView,
  updateUserPreferenceSettings,
  userSettingsFilePath,
} from "../../src/utils/userSettings.js";

const FILE = "/mock/home/.wave/settings.json";
const mockExists = vi.mocked(existsSync);
const mockRead = vi.mocked(readFileSync);
const mockMkdir = vi.mocked(mkdirSync);
const mockWrite = vi.mocked(atomicWriteFile);

/** 让回读看到的是一份既有的 settings.json 内容。 */
function seedFile(content: unknown): void {
  mockExists.mockReturnValue(true);
  mockRead.mockReturnValue(
    typeof content === "string" ? content : JSON.stringify(content),
  );
}

/** 取写入落盘的内容（`atomicWriteFile(filePath, content)`）。 */
function writtenJson(): Record<string, unknown> {
  expect(mockWrite).toHaveBeenCalledTimes(1);
  const [filePath, content] = mockWrite.mock.calls[0];
  expect(filePath).toBe(FILE);
  return JSON.parse(content as string) as Record<string, unknown>;
}

describe("userSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("路径与换算", () => {
    it("用户偏好文件的落点是用户级 settings.json", () => {
      expect(userSettingsFilePath()).toBe(FILE);
    });

    it("K 值 ↔ env.WAVE_MAX_INPUT_TOKENS 是同一套换算（K×1000）", () => {
      expect(contextLengthToMaxInputTokens(200)).toBe(200000);
      expect(contextLengthToMaxInputTokens(16.4)).toBe(16400);
      expect(maxInputTokensToContextLength("200000")).toBe(200);
      expect(maxInputTokensToContextLength("128000")).toBe(128);
    });

    it("无意义/缺失的 token 值回读为 undefined（不编造上下文长度）", () => {
      expect(maxInputTokensToContextLength(undefined)).toBeUndefined();
      expect(maxInputTokensToContextLength("")).toBeUndefined();
      expect(maxInputTokensToContextLength("abc")).toBeUndefined();
      expect(maxInputTokensToContextLength("0")).toBeUndefined();
      expect(maxInputTokensToContextLength("-1000")).toBeUndefined();
    });
  });

  describe("读取", () => {
    it("文件不存在 → 空对象（首次保存前的初始值）", () => {
      mockExists.mockReturnValue(false);
      expect(readUserPreferenceSettings(FILE)).toEqual({});
      expect(mockRead).not.toHaveBeenCalled();
    });

    it("读回四个偏好键，上下文长度按 K 展示", () => {
      seedFile({
        model: "m1",
        language: "English",
        autoMemoryEnabled: false,
        autoMemoryFrequency: 7,
        env: { WAVE_MAX_INPUT_TOKENS: "128000", OTHER: "keep" },
      });

      expect(readUserPreferenceSettings(FILE)).toEqual({
        language: "English",
        contextLength: 128,
        autoMemoryEnabled: false,
        autoMemoryFrequency: 7,
      });
    });

    it("损坏的 JSON → 空对象（读失败不阻塞设置页渲染）", () => {
      seedFile("{ this is not json");
      expect(readUserPreferenceSettings(FILE)).toEqual({});
    });

    it("顶层不是对象 → 空对象", () => {
      seedFile([1, 2, 3]);
      expect(readUserPreferenceSettings(FILE)).toEqual({});
    });

    it("env 被手写成非对象时不炸（按无值处理）", () => {
      seedFile({ env: "oops", language: "Chinese" });
      expect(readUserPreferenceSettings(FILE)).toEqual({ language: "Chinese" });
    });
  });

  /**
   * `readUserPreferenceView` = 设置页 `getUserSettings` 回包的形状来源：用户级文件
   * 只是**落点**，生效值可能来自更高层（Remote 组织下发 > 用户文件 > 机器环境变量）。
   * 见 spec core/agent-config.md 场景 8 与边界说明「用户偏好的层与来源」。
   */
  describe("生效值与来源层", () => {
    it("Remote 顶层键盖过用户文件（mergeRemoteSettings：标量远程赢）", () => {
      seedFile({ language: "Chinese" });
      expect(readUserPreferenceView({ language: "English" }, FILE, {})).toEqual(
        {
          values: { language: "English" },
          sources: {
            language: "remote",
            contextLength: "default",
            autoMemoryEnabled: "default",
            autoMemoryFrequency: "default",
          },
        },
      );
    });

    it("没有任何层提供时：四个键都缺失 + source 全为 default（设置页显示「未设置」）", () => {
      mockExists.mockReturnValue(false);
      expect(readUserPreferenceView(null, FILE, {})).toEqual({
        // 值语义与「只读用户文件」完全一致：没有提供者就不编造值（开关的默认
        // 「开」由设置页按 SDK 默认展示，不靠回包补一个 true）。
        values: {},
        sources: {
          language: "default",
          contextLength: "default",
          autoMemoryEnabled: "default",
          autoMemoryFrequency: "default",
        },
      });
    });

    it("用户文件键的归因是 user", () => {
      seedFile({
        language: "Chinese",
        autoMemoryEnabled: false,
        autoMemoryFrequency: 3,
        env: { WAVE_MAX_INPUT_TOKENS: "128000" },
      });
      expect(readUserPreferenceView(null, FILE, {})).toEqual({
        values: {
          language: "Chinese",
          contextLength: 128,
          autoMemoryEnabled: false,
          autoMemoryFrequency: 3,
        },
        sources: {
          language: "user",
          contextLength: "user",
          autoMemoryEnabled: "user",
          autoMemoryFrequency: "user",
        },
      });
    });

    it("上下文长度的归因层 = env.WAVE_MAX_INPUT_TOKENS 所在的层（remote > user > 机器 env）", () => {
      seedFile({ env: { WAVE_MAX_INPUT_TOKENS: "128000" } });
      const remoteEnv = { env: { WAVE_MAX_INPUT_TOKENS: "256000" } };
      expect(readUserPreferenceView(remoteEnv, FILE, {})).toEqual({
        values: { contextLength: 256 },
        sources: {
          language: "default",
          contextLength: "remote",
          autoMemoryEnabled: "default",
          autoMemoryFrequency: "default",
        },
      });
      expect(
        readUserPreferenceView(null, FILE, { WAVE_MAX_INPUT_TOKENS: "64000" }),
      ).toEqual({
        values: { contextLength: 128 },
        sources: {
          language: "default",
          contextLength: "user",
          autoMemoryEnabled: "default",
          autoMemoryFrequency: "default",
        },
      });
      mockExists.mockReturnValue(false);
      expect(
        readUserPreferenceView(null, FILE, { WAVE_MAX_INPUT_TOKENS: "64000" }),
      ).toEqual({
        values: { contextLength: 64 },
        sources: {
          language: "default",
          contextLength: "env",
          autoMemoryEnabled: "default",
          autoMemoryFrequency: "default",
        },
      });
    });

    it("自动记忆开关的两条 Remote 路径都归因 remote（顶层标量 + env.WAVE_DISABLE_AUTO_MEMORY）", () => {
      seedFile({ autoMemoryEnabled: true });
      expect(
        readUserPreferenceView({ autoMemoryEnabled: false }, FILE, {}),
      ).toEqual({
        values: { autoMemoryEnabled: false },
        sources: {
          language: "default",
          contextLength: "default",
          autoMemoryEnabled: "remote",
          autoMemoryFrequency: "default",
        },
      });

      // 用户文件没有该顶层键时，Remote 的 env 路径才轮到
      seedFile({});
      expect(
        readUserPreferenceView(
          { env: { WAVE_DISABLE_AUTO_MEMORY: "1" } },
          FILE,
          {},
        ),
      ).toEqual({
        values: { autoMemoryEnabled: false },
        sources: {
          language: "default",
          contextLength: "default",
          autoMemoryEnabled: "remote",
          autoMemoryFrequency: "default",
        },
      });
    });

    it("顶层标量整层优先于 env（用户文件顶层键 > Remote 的 env 键）", () => {
      seedFile({ autoMemoryEnabled: true, autoMemoryFrequency: 3 });
      expect(
        readUserPreferenceView(
          {
            env: {
              WAVE_DISABLE_AUTO_MEMORY: "1",
              WAVE_AUTO_MEMORY_FREQUENCY: "9",
            },
          },
          FILE,
          {},
        ),
      ).toEqual({
        values: { autoMemoryEnabled: true, autoMemoryFrequency: 3 },
        sources: {
          language: "default",
          contextLength: "default",
          autoMemoryEnabled: "user",
          autoMemoryFrequency: "user",
        },
      });
    });

    it("开关的机器 env 层与用户文件 env 层各自归因（user > env）", () => {
      seedFile({ env: { WAVE_DISABLE_AUTO_MEMORY: "true" } });
      expect(
        readUserPreferenceView(null, FILE, {
          WAVE_DISABLE_AUTO_MEMORY: "true",
        }),
      ).toEqual({
        values: { autoMemoryEnabled: false },
        sources: {
          language: "default",
          contextLength: "default",
          autoMemoryEnabled: "user",
          autoMemoryFrequency: "default",
        },
      });
      mockExists.mockReturnValue(false);
      expect(
        readUserPreferenceView(null, FILE, {
          WAVE_DISABLE_AUTO_MEMORY: "true",
        }),
      ).toEqual({
        values: { autoMemoryEnabled: false },
        sources: {
          language: "default",
          contextLength: "default",
          autoMemoryEnabled: "env",
          autoMemoryFrequency: "default",
        },
      });
      expect(
        readUserPreferenceView(null, FILE, { WAVE_DISABLE_AUTO_MEMORY: "no" }),
      ).toEqual({
        values: {},
        sources: {
          language: "default",
          contextLength: "default",
          autoMemoryEnabled: "default",
          autoMemoryFrequency: "default",
        },
      });
    });

    it("轮次频率的四层归因与开关同构（含 remote env 路径）", () => {
      seedFile({ autoMemoryFrequency: 5 });
      expect(
        readUserPreferenceView({ autoMemoryFrequency: 9 }, FILE, {}),
      ).toEqual({
        values: { autoMemoryFrequency: 9 },
        sources: {
          language: "default",
          contextLength: "default",
          autoMemoryEnabled: "default",
          autoMemoryFrequency: "remote",
        },
      });
      // 用户文件没有该顶层键时才轮到 Remote 的 env 路径（非正数的机器 env 被忽略）
      seedFile({});
      expect(
        readUserPreferenceView(
          { env: { WAVE_AUTO_MEMORY_FREQUENCY: "12" } },
          FILE,
          { WAVE_AUTO_MEMORY_FREQUENCY: "0" },
        ),
      ).toEqual({
        values: { autoMemoryFrequency: 12 },
        sources: {
          language: "default",
          contextLength: "default",
          autoMemoryEnabled: "default",
          autoMemoryFrequency: "remote",
        },
      });
      expect(
        readUserPreferenceView(null, FILE, { WAVE_AUTO_MEMORY_FREQUENCY: "4" }),
      ).toEqual({
        values: { autoMemoryFrequency: 4 },
        sources: {
          language: "default",
          contextLength: "default",
          autoMemoryEnabled: "default",
          autoMemoryFrequency: "env",
        },
      });
    });

    it("文件损坏时只丢用户层，更高/更低层照常生效", () => {
      seedFile("{ broken");
      expect(
        readUserPreferenceView({ language: "English" }, FILE, {
          WAVE_MAX_INPUT_TOKENS: "64000",
        }),
      ).toEqual({
        values: {
          language: "English",
          contextLength: 64,
        },
        sources: {
          language: "remote",
          contextLength: "env",
          autoMemoryEnabled: "default",
          autoMemoryFrequency: "default",
        },
      });
    });
  });

  describe("写入（读-改-写）", () => {
    it("只落用户偏好键，其余顶层键与 env 其它键原样保留", async () => {
      seedFile({
        permissions: { allow: ["Bash(ls:*)"], defaultMode: "acceptEdits" },
        env: { EXISTING: "1" },
        language: "Chinese",
      });

      const result = await updateUserPreferenceSettings(
        { language: "English", contextLength: 200 },
        FILE,
      );

      expect(writtenJson()).toEqual({
        permissions: { allow: ["Bash(ls:*)"], defaultMode: "acceptEdits" },
        env: { EXISTING: "1", [MAX_INPUT_TOKENS_ENV_KEY]: "200000" },
        language: "English",
      });
      // 回读值即写入后的完整偏好（保存回执直接用这份刷新展示）
      expect(result).toEqual({ language: "English", contextLength: 200 });
    });

    it("自动记忆开关与轮次落顶层键", async () => {
      seedFile({});
      const result = await updateUserPreferenceSettings(
        { autoMemoryEnabled: false, autoMemoryFrequency: 12 },
        FILE,
      );

      expect(writtenJson()).toEqual({
        autoMemoryEnabled: false,
        autoMemoryFrequency: 12,
      });
      expect(result).toEqual({
        autoMemoryEnabled: false,
        autoMemoryFrequency: 12,
      });
    });

    it("未提供的键保持文件现值（部分更新不丢另一端设置）", async () => {
      seedFile({
        language: "English",
        autoMemoryEnabled: false,
        autoMemoryFrequency: 5,
      });

      const result = await updateUserPreferenceSettings(
        { contextLength: 64 },
        FILE,
      );

      expect(writtenJson()).toMatchObject({
        language: "English",
        autoMemoryEnabled: false,
        autoMemoryFrequency: 5,
      });
      expect(result).toEqual({
        language: "English",
        autoMemoryEnabled: false,
        autoMemoryFrequency: 5,
        contextLength: 64,
      });
    });

    it("空 patch 只回读、不落盘（无差异保存不写文件）", async () => {
      seedFile({ language: "English" });

      const result = await updateUserPreferenceSettings({}, FILE);

      expect(result).toEqual({ language: "English" });
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it("非有限数（NaN/Infinity）不作为上下文长度/轮次落盘", async () => {
      seedFile({ language: "Chinese", env: { KEEP: "1" } });

      await updateUserPreferenceSettings(
        { contextLength: Number.NaN, autoMemoryFrequency: Infinity },
        FILE,
      );

      expect(writtenJson()).toEqual({
        language: "Chinese",
        env: { KEEP: "1" },
      });
    });

    it("文件损坏时写入报错且不覆盖用户文件", async () => {
      seedFile("{ broken");

      await expect(
        updateUserPreferenceSettings({ language: "English" }, FILE),
      ).rejects.toThrow(/JSON/);
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it("首次保存会建父目录（~/.wave 可能尚不存在）", async () => {
      mockExists.mockReturnValue(false);

      await updateUserPreferenceSettings({ language: "English" }, FILE);

      expect(mockMkdir).toHaveBeenCalledWith("/mock/home/.wave", {
        recursive: true,
      });
      expect(writtenJson()).toEqual({ language: "English" });
    });
  });
});

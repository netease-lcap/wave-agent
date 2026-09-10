/**
 * 用户偏好设置（三端设置页读写的子集）的读写工具。
 *
 * 落点唯一 = 用户级 `~/.wave/settings.json`（`getUserConfigPaths()[0]`）：
 * 三端（VS Code 扩展 / JetBrains 插件 / 桌面端）设置页保存的 AI 回复语言、
 * 上下文长度、自动记忆开关/轮次都写这个文件，由 SDK 的实时重载
 * （LiveConfigManager）在各会话下一轮开始时生效——不经 `AgentOptions`
 * 覆盖层下发（覆盖层优先级高于 settings.json，会永久遮蔽实时配置，
 * 见 docs/specs/core/agent-config.md「设置实时重载」「分层职责」）。
 *
 * 上下文长度的键 = `env.WAVE_MAX_INPUT_TOKENS`（全局默认，K×1000 落盘、
 * 回读按同一换算），UI 与线协议都传 K 值。
 *
 * 写入是「读-改-写」：只覆盖这四个键，其余顶层键与 `env` 下其它键原样保留。
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname } from "path";
import { atomicWriteFile } from "./atomicWrite.js";
import { getUserConfigPaths } from "./configPaths.js";
import type { UserPreferenceSettings } from "../types/configuration.js";

export type { UserPreferenceSettings };

/** 上下文长度在 settings.json 中的落点（全局默认，spec 边界说明「上下文长度的落点」）。 */
export const MAX_INPUT_TOKENS_ENV_KEY = "WAVE_MAX_INPUT_TOKENS";

/** UI 的 K 值 → settings.json 的 token 数（K×1000）。 */
export function contextLengthToMaxInputTokens(contextLengthK: number): number {
  return Math.round(contextLengthK * 1000);
}

/** settings.json 的 token 数 → UI 的 K 值（回读按同一换算）。 */
export function maxInputTokensToContextLength(
  maxInputTokens: string | undefined,
): number | undefined {
  if (maxInputTokens === undefined) return undefined;
  const parsed = Number.parseInt(maxInputTokens, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed / 1000);
}

/** 用户级 settings.json 路径（`~/.wave/settings.json`）。 */
export function userSettingsFilePath(): string {
  return getUserConfigPaths()[0];
}

function parseSettingsFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, "utf-8");
  if (raw.trim() === "") return {};
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${filePath} 的顶层必须是 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

/** settings.json 的 `env`（用户手写文件，须容忍非对象值）。 */
function asEnvBlock(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toSettings(data: Record<string, unknown>): UserPreferenceSettings {
  const rawMax = asEnvBlock(data.env)[MAX_INPUT_TOKENS_ENV_KEY];
  const settings: UserPreferenceSettings = {};
  if (typeof data.language === "string") settings.language = data.language;
  const contextLength = maxInputTokensToContextLength(
    typeof rawMax === "string" ? rawMax : undefined,
  );
  if (contextLength !== undefined) settings.contextLength = contextLength;
  if (typeof data.autoMemoryEnabled === "boolean") {
    settings.autoMemoryEnabled = data.autoMemoryEnabled;
  }
  if (typeof data.autoMemoryFrequency === "number") {
    settings.autoMemoryFrequency = data.autoMemoryFrequency;
  }
  return settings;
}

/**
 * 读取当前用户偏好。文件缺失或损坏时返回空对象（与
 * `loadWaveConfigFromFile` 的容错一致：损坏只影响展示，不阻塞设置页渲染）；
 * 写入路径则会明确报错而不是覆盖用户文件。
 */
export function readUserPreferenceSettings(
  filePath: string = userSettingsFilePath(),
): UserPreferenceSettings {
  try {
    return toSettings(parseSettingsFile(filePath));
  } catch {
    return {};
  }
}

/**
 * 把 `patch` 里的键合并进用户级 settings.json，返回写入后的完整用户偏好。
 * 未提供的键保持文件中现值；`patch` 为空时只回读、不落盘（无差异保存）。
 */
export async function updateUserPreferenceSettings(
  patch: UserPreferenceSettings,
  filePath: string = userSettingsFilePath(),
): Promise<UserPreferenceSettings> {
  const data = parseSettingsFile(filePath);

  const hasLanguage = patch.language !== undefined;
  const hasContextLength = patch.contextLength !== undefined;
  const hasEnabled = patch.autoMemoryEnabled !== undefined;
  const hasFrequency = patch.autoMemoryFrequency !== undefined;
  if (!hasLanguage && !hasContextLength && !hasEnabled && !hasFrequency) {
    return toSettings(data);
  }

  if (hasLanguage) data.language = patch.language;

  if (
    typeof patch.contextLength === "number" &&
    Number.isFinite(patch.contextLength)
  ) {
    const env = asEnvBlock(data.env);
    env[MAX_INPUT_TOKENS_ENV_KEY] = String(
      contextLengthToMaxInputTokens(patch.contextLength),
    );
    data.env = env;
  }

  if (hasEnabled) data.autoMemoryEnabled = patch.autoMemoryEnabled;
  if (
    typeof patch.autoMemoryFrequency === "number" &&
    Number.isFinite(patch.autoMemoryFrequency)
  ) {
    data.autoMemoryFrequency = patch.autoMemoryFrequency;
  }

  // 首次保存时 `~/.wave` 可能尚不存在（会话启动时文件不存在，场景 7），
  // 原子写需要同目录可写，先确保目录存在。
  mkdirSync(dirname(filePath), { recursive: true });
  await atomicWriteFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
  return toSettings(data);
}

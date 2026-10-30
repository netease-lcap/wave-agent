/**
 * 用户偏好设置（三端设置页读写的子集）的读写工具。
 *
 * 落点唯一 = 用户级 `~/.wave/settings.json`（`getUserConfigPaths()[0]`）：
 * 三端（VS Code 扩展 / JetBrains 插件 / 桌面端）设置页保存的 AI 回复语言、
 * 上下文长度、自动记忆开关/轮次、服务端地址都写这个文件，由 SDK 的实时重载
 * （LiveConfigManager）在各会话下一轮开始时生效——不经 `AgentOptions`
 * 覆盖层下发（覆盖层优先级高于 settings.json，会永久遮蔽实时配置，
 * 见 docs/specs/core/agent-config.md「设置实时重载」「分层职责」）。
 *
 * 上下文长度的键 = `env.WAVE_MAX_INPUT_TOKENS`（全局默认，K×1000 落盘、
 * 回读按同一换算），UI 与线协议都传 K 值。
 *
 * 服务端地址的键 = `env.WAVE_SERVER_URL`（SDK 既有键，解析链
 * `options.serverUrl > process.env.WAVE_SERVER_URL > DEFAULT_SERVER_URL`；
 * settings `env` 的值经 `setEnvironmentVars` 特例镜像到 `process.env`，
 * 见 docs/specs/core/agent-config.md 边界说明「服务端地址的落点」）。
 *
 * 行内补全的键 = 顶层 `completionModel` / `completionEnabled`（与 `model` 同一层，
 * 解析链见 `ConfigurationService.resolveModelConfig`；补全模型另有
 * `env.WAVE_COMPLETION_MODEL` 逃生口），见 docs/specs/ide/code-completion.md 故事 4/5。
 *
 * 企业知识库的开关 = 顶层 `enableKnowledgeBase`（缺省关，托管层可覆盖），
 * 生效判定见 `services/knowledgeBaseAvailability.ts`，见
 * docs/specs/core/agent-config.md「企业知识库开关」。
 *
 * 写入是「读-改-写」：只覆盖这些键，其余顶层键与 `env` 下其它键原样保留。
 *
 * `readUserPreferenceView` 额外回答**当前生效值来自哪一层**：用户级文件是用户
 * 偏好的**落点**，但企业下发的 remote-settings（或机器上的环境变量）可以盖过它，
 * 此时只读用户文件会得到「显示值 ≠ 生效值」（spec core/agent-config.md
 * 边界说明「用户偏好的层与来源」）。设置页据此对「由组织配置管理」的键置灰。
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname } from "path";
import { atomicWriteFile } from "./atomicWrite.js";
import { getUserConfigPaths } from "./configPaths.js";
import { getRemoteSettingsSync } from "../services/remoteSettingsService.js";
import type {
  UserPreferenceKey,
  UserPreferenceSettings,
  UserPreferenceSource,
  WaveConfiguration,
} from "../types/configuration.js";

export type { UserPreferenceSettings };

/** 上下文长度在 settings.json 中的落点（全局默认，spec 边界说明「上下文长度的落点」）。 */
export const MAX_INPUT_TOKENS_ENV_KEY = "WAVE_MAX_INPUT_TOKENS";

/**
 * 自动记忆的 env 键，与 `ConfigurationService.resolveAutoMemoryEnabledFrom` /
 * `resolveAutoMemoryFrequency` 读取的键名一致（本视图只按同一优先级归因，
 * 不改变解析行为）。
 */
export const DISABLE_AUTO_MEMORY_ENV_KEY = "WAVE_DISABLE_AUTO_MEMORY";
export const AUTO_MEMORY_FREQUENCY_ENV_KEY = "WAVE_AUTO_MEMORY_FREQUENCY";

/**
 * 服务端地址的 env 键（SDK 既有键，见文件头与
 * `ConfigurationService.setEnvironmentVars` 的镜像特例）。
 */
export const SERVER_URL_ENV_KEY = "WAVE_SERVER_URL";

/**
 * 补全模型的 env 键（`WAVE_COMPLETION_MODEL`）。顶层 `completionModel` 优先，
 * 与 `model` / `WAVE_MODEL` 的关系一致。
 */
export const COMPLETION_MODEL_ENV_KEY = "WAVE_COMPLETION_MODEL";

/** 用户偏好键（设置页控件）。 */
export type { UserPreferenceKey, UserPreferenceSource };

/** 生效偏好 + 每个键的来源。 */
export interface UserPreferenceView {
  /** 生效值；键缺失 = 该偏好没有任何提供者（落 SDK 默认/未设置态）。 */
  values: UserPreferenceSettings;
  /** 每个键恒有来源（缺省即 `default`）。 */
  sources: Record<UserPreferenceKey, UserPreferenceSource>;
}

/**
 * 上下文长度的 env 值（token 字符串）→ UI 的 K 值；非数字/非正数视作未提供。
 */
function envContextLength(raw: unknown): number | undefined {
  return typeof raw === "string"
    ? maxInputTokensToContextLength(raw)
    : undefined;
}

/** `WAVE_DISABLE_AUTO_MEMORY` → 关闭(false) / 未提供(undefined)。 */
function envDisableAutoMemory(raw: unknown): boolean | undefined {
  return raw === "1" || raw === "true" ? false : undefined;
}

/** `WAVE_AUTO_MEMORY_FREQUENCY` → 正数轮次 / 未提供。 */
function envAutoMemoryFrequency(raw: unknown): number | undefined {
  const parsed = Number.parseInt(typeof raw === "string" ? raw : "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** 非空字符串 / 未提供（空串视作未提供，不编造默认值）。 */
function nonEmptyString(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim() !== "" ? raw : undefined;
}

/** 按优先级取第一个提供了值的层。 */
function selectPreference<T>(
  candidates: Array<[UserPreferenceSource, T | undefined]>,
): { value: T; source: UserPreferenceSource } | undefined {
  for (const [source, value] of candidates) {
    if (value !== undefined) return { value, source };
  }
  return undefined;
}

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
  const env = asEnvBlock(data.env);
  const rawMax = env[MAX_INPUT_TOKENS_ENV_KEY];
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
  const serverUrl = nonEmptyString(env[SERVER_URL_ENV_KEY]);
  if (serverUrl !== undefined) settings.serverUrl = serverUrl;
  // 补全模型 / 开关落顶层键（与 `model` 同一层，spec ui/code-completion 故事 4/5）。
  const completionModel = nonEmptyString(data.completionModel);
  if (completionModel !== undefined) settings.completionModel = completionModel;
  if (typeof data.completionEnabled === "boolean") {
    settings.completionEnabled = data.completionEnabled;
  }
  // 下一步编辑建议的开关同样落顶层键（缺省为关，故只有显式布尔值才算「设置过」）。
  if (typeof data.nextEditEnabled === "boolean") {
    settings.nextEditEnabled = data.nextEditEnabled;
  }
  // 企业知识库开关（顶层键，缺省为关；spec core/agent-config.md「企业知识库开关」）。
  if (typeof data.enableKnowledgeBase === "boolean") {
    settings.enableKnowledgeBase = data.enableKnowledgeBase;
  }
  return settings;
}

/** 容忍损坏的读取：文件缺失或损坏时视作没有设置（只影响展示，不阻塞设置页）。 */
function readSettingsFileTolerant(filePath: string): Record<string, unknown> {
  try {
    return parseSettingsFile(filePath);
  } catch {
    return {};
  }
}

/**
 * 读取当前用户偏好。文件缺失或损坏时返回空对象（与
 * `loadWaveConfigFromFile` 的容错一致：损坏只影响展示，不阻塞设置页渲染）；
 * 写入路径则会明确报错而不是覆盖用户文件。
 */
export function readUserPreferenceSettings(
  filePath: string = userSettingsFilePath(),
): UserPreferenceSettings {
  return toSettings(readSettingsFileTolerant(filePath));
}

/**
 * 读取**生效**用户偏好及其来源层。
 *
 * 优先级与各 resolve 链一致（只按**进程级可达**的层归因）：Remote 组织下发
 * （顶层键，以及其 `env` 的 `WAVE_MAX_INPUT_TOKENS` / `WAVE_DISABLE_AUTO_MEMORY` /
 * `WAVE_AUTO_MEMORY_FREQUENCY`）> 用户级文件（同样两种落点）> 机器环境变量
 * （`process.env`）> 默认。Remote 胜出与 `mergeRemoteSettings` 的「标量远程赢、
 * env 逐键远程赢」一致（remoteSettingsService.ts）。
 *
 * `values` 的语义**与只读用户文件时完全一致**：只有真的有提供者才会出现该键，
 * 没有任何层提供时键缺失（设置页据此显示「未设置」态、按 SDK 默认值展示）。
 * 新增信息只在 `sources`：每个键恒有来源（缺省 `default`）。
 *
 * 注意归因范围：`project`（`.wave/settings.json`）/ `local`（`.wave/settings.local.json`）
 * 需要 workdir，而本 RPC 是刻意的无会话全局请求；`override` / `options` 是会话级
 * 语义。三者都不在本视图的归因范围内——被它们覆盖时这里仍按进程级各层给出
 * 「本层值」，见 spec core/agent-config.md 边界说明「用户偏好的层与来源」。
 *
 * @param remote - Remote 组织下发配置（默认取进程内缓存）
 * @param filePath - 用户级 settings.json 路径
 * @param env - 机器环境变量（默认 `process.env`，便于测试注入）
 */
export function readUserPreferenceView(
  remote: WaveConfiguration | null = getRemoteSettingsSync(),
  filePath: string = userSettingsFilePath(),
  env: Record<string, string | undefined> = process.env,
): UserPreferenceView {
  const fileData = readSettingsFileTolerant(filePath);
  const user = toSettings(fileData);
  const userEnv = asEnvBlock(fileData.env);
  const remoteEnv = asEnvBlock(remote?.env);

  const values: UserPreferenceSettings = {};
  const sources: Record<UserPreferenceKey, UserPreferenceSource> = {
    language: "default",
    contextLength: "default",
    autoMemoryEnabled: "default",
    autoMemoryFrequency: "default",
    serverUrl: "default",
    completionModel: "default",
    completionEnabled: "default",
    nextEditEnabled: "default",
    enableKnowledgeBase: "default",
  };

  // language 没有 env 落点（`resolveLanguage` 只读合并后的顶层键）。
  const language = selectPreference<string>([
    ["remote", remote?.language],
    ["user", user.language],
  ]);
  if (language) {
    values.language = language.value;
    sources.language = language.source;
  }

  // 上下文长度的归因层 = `env.WAVE_MAX_INPUT_TOKENS` 这个 env key 所在的层
  // （不是「模型配置」那层：模型自带上限时以模型配置为准是 SDK 既有行为，
  // 设置页那一行可见说明已交代）。
  const contextLength = selectPreference<number>([
    ["remote", envContextLength(remoteEnv[MAX_INPUT_TOKENS_ENV_KEY])],
    ["user", user.contextLength],
    ["env", envContextLength(env[MAX_INPUT_TOKENS_ENV_KEY])],
  ]);
  if (contextLength) {
    values.contextLength = contextLength.value;
    sources.contextLength = contextLength.source;
  }

  // 自动记忆开关每层有两条路径：顶层标量，以及 `env.WAVE_DISABLE_AUTO_MEMORY`。
  // 顶层标量整层优先于 env（`resolveAutoMemoryEnabledFrom` 先看 config 再看 env）。
  // 没有任何层提供时**不编造**值（与其余三个键一致：键缺失 = 无提供者），
  // 设置页按 SDK 默认显示为「开」，与生效值一致。
  const autoMemoryEnabled = selectPreference<boolean>([
    ["remote", remote?.autoMemoryEnabled],
    ["user", user.autoMemoryEnabled],
    ["remote", envDisableAutoMemory(remoteEnv[DISABLE_AUTO_MEMORY_ENV_KEY])],
    ["user", envDisableAutoMemory(userEnv[DISABLE_AUTO_MEMORY_ENV_KEY])],
    ["env", envDisableAutoMemory(env[DISABLE_AUTO_MEMORY_ENV_KEY])],
  ]);
  if (autoMemoryEnabled) {
    values.autoMemoryEnabled = autoMemoryEnabled.value;
    sources.autoMemoryEnabled = autoMemoryEnabled.source;
  }

  const autoMemoryFrequency = selectPreference<number>([
    ["remote", remote?.autoMemoryFrequency],
    ["user", user.autoMemoryFrequency],
    [
      "remote",
      envAutoMemoryFrequency(remoteEnv[AUTO_MEMORY_FREQUENCY_ENV_KEY]),
    ],
    ["user", envAutoMemoryFrequency(userEnv[AUTO_MEMORY_FREQUENCY_ENV_KEY])],
    ["env", envAutoMemoryFrequency(env[AUTO_MEMORY_FREQUENCY_ENV_KEY])],
  ]);
  if (autoMemoryFrequency) {
    values.autoMemoryFrequency = autoMemoryFrequency.value;
    sources.autoMemoryFrequency = autoMemoryFrequency.source;
  }

  // 服务端地址的落点 = `env.WAVE_SERVER_URL`，来源只可能是 user / env / default——
  // 不归因 remote（远端托管配置本身取自该地址，不存在「组织下发服务端地址」的闭环，
  // 见 spec core/agent-config.md 边界说明「服务端地址的落点」）。
  const serverUrl = selectPreference<string>([
    ["user", user.serverUrl],
    ["env", nonEmptyString(env[SERVER_URL_ENV_KEY])],
  ]);
  if (serverUrl) {
    values.serverUrl = serverUrl.value;
    sources.serverUrl = serverUrl.source;
  }

  // 补全模型的落点 = 顶层 `completionModel`（或 `env.WAVE_COMPLETION_MODEL`），
  // 来源只可能是 user / env / default——不归因 remote：`mergeRemoteSettings` 尚未
  // 接管该键，远端下发不会进解析链（归因必须与解析链一致，否则设置页会把一个
  // 没生效的层标成生效值）。未设置时解析链回落到快速模型，那是**回退**而不是
  // 该键的提供者，故不在这里编造值。
  const completionModel = selectPreference<string>([
    ["user", user.completionModel],
    ["env", nonEmptyString(env[COMPLETION_MODEL_ENV_KEY])],
  ]);
  if (completionModel) {
    values.completionModel = completionModel.value;
    sources.completionModel = completionModel.source;
  }

  // 补全开关：顶层标量，没有 env 落点（`resolveModelConfig` 只读 config 与
  // 构造参数），故只归因 user；无提供者时键缺失，设置页按 SDK 默认显示为「开」，
  // 与 autoMemoryEnabled 同一处理。
  const completionEnabled = selectPreference<boolean>([
    ["user", user.completionEnabled],
  ]);
  if (completionEnabled) {
    values.completionEnabled = completionEnabled.value;
    sources.completionEnabled = completionEnabled.source;
  }

  // 下一步编辑建议开关：与补全开关同一条链路（只归因 user，缺省为关）。
  const nextEditEnabled = selectPreference<boolean>([
    ["user", user.nextEditEnabled],
  ]);
  if (nextEditEnabled) {
    values.nextEditEnabled = nextEditEnabled.value;
    sources.nextEditEnabled = nextEditEnabled.source;
  }

  // 企业知识库开关：托管层优先于用户级文件，与 `isKnowledgeBaseEnabled` 的判定
  // 顺序一致（remote → 本地合并 → 默认关；该键没有 env 落点）。
  const enableKnowledgeBase = selectPreference<boolean>([
    ["remote", remote?.enableKnowledgeBase],
    ["user", user.enableKnowledgeBase],
  ]);
  if (enableKnowledgeBase) {
    values.enableKnowledgeBase = enableKnowledgeBase.value;
    sources.enableKnowledgeBase = enableKnowledgeBase.source;
  }

  return { values, sources };
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
  // 空串视作未提供（与回读侧 `nonEmptyString` 同一判据）：写进去会在
  // `process.env` 镜像里遮蔽 OS 环境变量（解析链用 `||` 回落到默认值），而回读侧
  // 又按「未设置」展示 ⇒ 显示值与生效值分叉。省略键 = 不改该键。
  const serverUrl = nonEmptyString(patch.serverUrl);
  const hasCompletionEnabled = patch.completionEnabled !== undefined;
  const hasNextEditEnabled = patch.nextEditEnabled !== undefined;
  const hasKnowledgeBase = patch.enableKnowledgeBase !== undefined;
  // 补全模型与 serverUrl 同一判据：空串 = 未提供（省略键 = 不改该键，UI 也没有
  // 删键语义），避免把「清空下拉」翻译成写一个空模型名。
  const completionModel = nonEmptyString(patch.completionModel);
  if (
    !hasLanguage &&
    !hasContextLength &&
    !hasEnabled &&
    !hasFrequency &&
    serverUrl === undefined &&
    !hasCompletionEnabled &&
    !hasNextEditEnabled &&
    !hasKnowledgeBase &&
    completionModel === undefined
  ) {
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

  // 服务端地址落 `env.WAVE_SERVER_URL`（既有键）：原样写入，不做归一/清理
  // （格式校验在设置页，见 spec 边界说明「服务端地址的落点」）。
  if (serverUrl !== undefined) {
    const env = asEnvBlock(data.env);
    env[SERVER_URL_ENV_KEY] = serverUrl;
    data.env = env;
  }

  // 补全模型 / 开关落顶层键（与 `model` 同层）。
  if (completionModel !== undefined) data.completionModel = completionModel;
  if (hasCompletionEnabled) data.completionEnabled = patch.completionEnabled;
  if (hasNextEditEnabled) data.nextEditEnabled = patch.nextEditEnabled;
  // 企业知识库开关落顶层键（与 `enableArtifact` / `enableExec` 同一层，
  // 设置页的「企业知识库」行，spec core/agent-config.md「企业知识库开关」）。
  if (hasKnowledgeBase) data.enableKnowledgeBase = patch.enableKnowledgeBase;

  // 首次保存时 `~/.wave` 可能尚不存在（会话启动时文件不存在，场景 7），
  // 原子写需要同目录可写，先确保目录存在。
  mkdirSync(dirname(filePath), { recursive: true });
  await atomicWriteFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
  return toSettings(data);
}

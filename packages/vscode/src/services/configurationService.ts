import * as vscode from "vscode";
import type { StdioClient } from "../stdio/stdioClient";
import type { UserPreferenceSettings } from "wave-agent-sdk/types";

export interface ConfigurationData {
  model?: string;
  fastModel?: string;
  language?: string;
  serverUrl?: string;
  /** Per-model input context window in K tokens (e.g. 200 = 200K), 16–1000 */
  contextLength?: number;
  /** Whether auto-memory extraction is enabled */
  autoMemoryEnabled?: boolean;
  /** Auto-memory extraction turn frequency, 1–100 */
  autoMemoryFrequency?: number;
}

/**
 * 扩展本地配置（`model` / `fastModel` / `serverUrl`，落 globalState）与
 * 用户偏好（AI 回复语言 / 上下文长度 / 自动记忆开关与频率）的读写入口。
 *
 * 用户偏好落点唯一为用户级 `~/.wave/settings.json`：经共享 CLI 进程（即**会话
 * 所在进程**，VS Code Remote/SSH 下是远端机器上的该文件）的
 * `getUserSettings` / `updateUserSettings` 读写，SDK 侧热重载在**下一轮对话**
 * 生效——保存不再重建会话（spec core/agent-config.md「设置实时重载」与
 * 「IDE 插件配置入口」场景 6）。宿主私有存储（globalState）
 * **不得**作为用户偏好的第二真源。
 */
export class ConfigurationService {
  private client?: StdioClient;

  constructor(private context: vscode.ExtensionContext) {}

  /**
   * 绑定共享 CLI 客户端（init 里客户端 spawn 之后调用）。用户偏好读写都走它，
   * 避免「宿主进程写的文件 ≠ 会话进程读的文件」。
   */
  public attachClient(client: StdioClient): void {
    this.client = client;
  }

  private loadLocalConfiguration(): Omit<
    ConfigurationData,
    "language" | "contextLength" | "autoMemoryEnabled" | "autoMemoryFrequency"
  > {
    return {
      model: this.context.globalState.get<string>("model") || "",
      fastModel: this.context.globalState.get<string>("fastModel") || "",
      serverUrl: this.context.globalState.get<string>("serverUrl") || "",
    };
  }

  public async loadConfiguration(): Promise<ConfigurationData> {
    return {
      ...this.loadLocalConfiguration(),
      ...(await this.readUserPreferences()),
    };
  }

  public async saveConfiguration(
    configData: Partial<ConfigurationData>,
  ): Promise<void> {
    try {
      if (configData.model !== undefined)
        await this.context.globalState.update("model", configData.model);
      if (configData.fastModel !== undefined)
        await this.context.globalState.update(
          "fastModel",
          configData.fastModel,
        );
      if (configData.serverUrl !== undefined)
        await this.context.globalState.update(
          "serverUrl",
          configData.serverUrl,
        );

      const patch = pickUserPreferences(configData);
      // 无用户偏好键（如仅同步 serverUrl）不触碰 settings.json。
      if (Object.keys(patch).length > 0) {
        await this.userPreferenceClient().request("updateUserSettings", patch);
      }
    } catch (error) {
      console.error("Failed to save configuration:", error);
      throw error;
    }
  }

  /** 用户偏好经 CLI 进程读取（settings.json 是唯一真源）；失败降级为空。 */
  private async readUserPreferences(): Promise<UserPreferenceSettings> {
    if (!this.client) return {};
    try {
      const result = await this.client.request("getUserSettings");
      return (result as UserPreferenceSettings | undefined) ?? {};
    } catch (error) {
      console.error("Failed to load user preferences:", error);
      return {};
    }
  }

  private userPreferenceClient(): StdioClient {
    if (!this.client) {
      throw new Error("CLI 会话未就绪，无法写入用户设置");
    }
    return this.client;
  }
}

/** 只取用户偏好键，避免把扩展私有键写进 settings.json。 */
function pickUserPreferences(
  configData: Partial<ConfigurationData>,
): UserPreferenceSettings {
  const patch: UserPreferenceSettings = {};
  if (configData.language !== undefined) patch.language = configData.language;
  if (typeof configData.contextLength === "number")
    patch.contextLength = configData.contextLength;
  if (configData.autoMemoryEnabled !== undefined)
    patch.autoMemoryEnabled = configData.autoMemoryEnabled;
  if (typeof configData.autoMemoryFrequency === "number")
    patch.autoMemoryFrequency = configData.autoMemoryFrequency;
  return patch;
}

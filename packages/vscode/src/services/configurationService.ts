import * as vscode from "vscode";

export interface ConfigurationData {
  apiKey?: string;
  headers?: string;
  baseURL?: string;
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

export class ConfigurationService {
  constructor(private context: vscode.ExtensionContext) {}

  public async loadConfiguration(): Promise<ConfigurationData> {
    return {
      apiKey: this.context.globalState.get<string>("apiKey") || "",
      headers: this.context.globalState.get<string>("headers") || "",
      baseURL: this.context.globalState.get<string>("baseURL") || "",
      model: this.context.globalState.get<string>("model") || "",
      fastModel: this.context.globalState.get<string>("fastModel") || "",
      language: this.context.globalState.get<string>("language") || "Chinese",
      serverUrl: this.context.globalState.get<string>("serverUrl") || "",
      contextLength:
        this.context.globalState.get<number>("contextLength") ?? undefined,
      autoMemoryEnabled:
        this.context.globalState.get<boolean>("autoMemoryEnabled") ?? undefined,
      autoMemoryFrequency:
        this.context.globalState.get<number>("autoMemoryFrequency") ??
        undefined,
    };
  }

  public async saveConfiguration(
    configData: Partial<ConfigurationData>,
  ): Promise<void> {
    try {
      if (configData.apiKey !== undefined)
        await this.context.globalState.update("apiKey", configData.apiKey);
      if (configData.headers !== undefined)
        await this.context.globalState.update("headers", configData.headers);
      if (configData.baseURL !== undefined)
        await this.context.globalState.update("baseURL", configData.baseURL);
      if (configData.model !== undefined)
        await this.context.globalState.update("model", configData.model);
      if (configData.fastModel !== undefined)
        await this.context.globalState.update(
          "fastModel",
          configData.fastModel,
        );
      if (configData.language !== undefined)
        await this.context.globalState.update("language", configData.language);
      if (configData.serverUrl !== undefined)
        await this.context.globalState.update(
          "serverUrl",
          configData.serverUrl,
        );
      if (configData.contextLength !== undefined)
        await this.context.globalState.update(
          "contextLength",
          configData.contextLength,
        );
      if (configData.autoMemoryEnabled !== undefined)
        await this.context.globalState.update(
          "autoMemoryEnabled",
          configData.autoMemoryEnabled,
        );
      if (configData.autoMemoryFrequency !== undefined)
        await this.context.globalState.update(
          "autoMemoryFrequency",
          configData.autoMemoryFrequency,
        );
    } catch (error) {
      console.error("Failed to save configuration:", error);
      throw error;
    }
  }
}

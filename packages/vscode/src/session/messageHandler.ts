import * as vscode from "vscode";
import { ChatSession } from "./chatSession";
import {
  ConfigurationService,
  type ConfigurationData,
} from "../services/configurationService";
import { FileService } from "../services/fileService";
import { SessionService } from "../services/sessionService";
import { PluginService } from "../services/pluginService";
import type { StdioClient } from "../stdio/stdioClient";
import type {
  Scope,
  PermissionMode,
  PermissionDecision,
} from "wave-agent-sdk/types";

export interface MessageHandlerContext {
  getChatSession: (
    viewType: "sidebar" | "tab" | "window",
    windowId?: string,
  ) => ChatSession;
  postMessage: (
    message: unknown,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) => void;
  initializeAgent: (
    viewType: "sidebar" | "tab" | "window",
    windowId?: string,
    restoreSessionId?: string,
  ) => Promise<void>;
  listSessions: (
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) => Promise<void>;
  /** 重建所有会话的 agent（插件启停 / 登录登出后让新配置生效）。 */
  updateAllSessionsConfig: () => void;
  getVersion: () => string;
  /** Opens (or refreshes) the plan-preview panel for a session (claudePlanPreview
   *  equivalent) with the given plan markdown content. */
  openPlanPreview: (key: string, content: string) => void;
  /** Opens (or focuses) the editor-area settings tab (wave.openSettings).
   *  nav 可选（"subagents" | "skills"），/agents、/skills 斜杠命令经
   *  openSettings message 透传，host 随 settingsState 下发到设置页选中选项卡。 */
  openSettings: (nav?: string) => void | Promise<void>;
  /** Posts a message to the editor-area settings tab webview. */
  postSettingsMessage: (message: unknown) => void;
  /** Closes the editor-area settings tab (webview "closeSettings" message). */
  closeSettings: () => void;
}

export class MessageHandler {
  private configService: ConfigurationService;
  private fileService: FileService;
  private sessionService: SessionService;
  private pluginService: PluginService;
  private utilityClient: StdioClient;
  private context: MessageHandlerContext;

  constructor(
    configService: ConfigurationService,
    fileService: FileService,
    sessionService: SessionService,
    pluginService: PluginService,
    utilityClient: StdioClient,
    context: MessageHandlerContext,
  ) {
    this.configService = configService;
    this.fileService = fileService;
    this.sessionService = sessionService;
    this.pluginService = pluginService;
    this.utilityClient = utilityClient;
    this.context = context;
  }

  public async handleMessage(
    message: unknown,
    viewType: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const msg = message as Record<string, unknown>;
    switch (msg.command as string) {
      case "sendMessage":
        await this.sendMessageToAgent(
          msg.text as string,
          msg.images as Array<{ data: string; mediaType: string }>,
          msg.force as boolean,
          viewType,
          windowId,
        );
        break;
      case "clearChat":
        await this.clearChat(viewType, windowId);
        break;
      case "compact":
        await this.compactChat(
          msg.customInstructions as string | undefined,
          viewType,
          windowId,
        );
        break;
      case "abortMessage":
        await this.abortMessage(viewType, windowId);
        break;
      case "listSessions":
        await this.context.listSessions(viewType, windowId);
        break;
      case "restoreSession":
        await this.restoreSession(msg.sessionId as string, viewType, windowId);
        break;
      case "requestFileSuggestions":
        await this.handleFileSuggestionsRequest(
          msg.filterText as string,
          msg.requestId as string,
          viewType,
          windowId,
        );
        break;
      case "requestSlashCommands":
        await this.handleSlashCommandsRequest(
          msg.filterText as string,
          viewType,
          windowId,
        );
        break;
      case "planCommand":
        await this.handlePlanCommand(
          msg.args as string | undefined,
          viewType,
          windowId,
        );
        break;
      case "confirmationResponse":
        await this.handleConfirmationResponse(
          msg.confirmationId as string,
          msg.approved as boolean,
          msg.decision,
          viewType,
          windowId,
        );
        break;
      case "openSettings":
        await this.context.openSettings(
          (msg as { nav?: string }).nav as string | undefined,
        );
        break;
      case "getConfiguration":
        await this.handleGetConfiguration(viewType, windowId);
        break;
      case "updateConfiguration":
        await this.handleUpdateConfiguration(
          msg.configurationData,
          viewType,
          windowId,
        );
        await this.handleGetConfiguration(viewType, windowId);
        break;
      case "uploadFilesToArtifacts":
        await this.handleUploadFilesToArtifacts(
          msg.files as Array<{ name: string; data: ArrayBuffer }>,
          viewType,
          windowId,
        );
        break;
      case "showError":
        vscode.window.showErrorMessage(msg.message as string);
        break;
      case "webviewReady":
        await this.handleWebviewReady(viewType, windowId);
        break;
      case "updateInputContent":
        this.handleUpdateInputContent(
          msg.content as string,
          viewType,
          windowId,
        );
        break;
      case "setPermissionMode":
        await this.handleSetPermissionMode(
          msg.mode as string,
          viewType,
          windowId,
        );
        break;
      case "deleteQueuedMessage":
        await this.handleDeleteQueuedMessage(
          msg.index as number,
          viewType,
          windowId,
        );
        break;
      case "updateQueuedMessage":
        await this.handleUpdateQueuedMessage(
          msg.id as string,
          msg.text as string,
          msg.images as Array<{ path: string; mimeType: string }> | undefined,
          viewType,
          windowId,
        );
        break;
      case "deleteQueuedMessageById":
        await this.handleDeleteQueuedMessageById(
          msg.id as string,
          viewType,
          windowId,
        );
        break;
      case "getProjectSettings":
        await this.handleGetProjectSettings(viewType, windowId);
        break;
      case "setBuiltinPluginEnabled":
        await this.handleSetBuiltinPluginEnabled(
          msg.pluginId as string,
          msg.enabled as boolean,
          msg.scope as string,
          viewType,
          windowId,
        );
        break;
      case "openFile":
        await this.handleOpenFile(
          msg.path as string,
          msg.startLine as number,
          msg.endLine as number,
        );
        break;
      case "previewImage":
        await this.handlePreviewImage(msg.path as string);
        break;
      case "openExternal":
        await this.handleOpenExternal(msg.url as string);
        break;
      case "rewindToMessage":
        await this.handleRewindToMessage(
          msg.messageId as string,
          viewType,
          windowId,
        );
        break;
      case "listRewindCheckpoints":
        await this.handleListRewindCheckpoints(viewType, windowId);
        break;
      case "getConfiguredModels":
        await this.handleGetConfiguredModels(viewType, windowId);
        break;
      case "setModel":
        await this.handleSetModel(msg.model as string, viewType, windowId);
        break;
      case "askBtw":
        await this.handleAskBtw(msg.question as string, viewType, windowId);
        break;
      case "requestHistory":
        await this.handleRequestHistory(
          msg.requestId as string,
          viewType,
          windowId,
        );
        break;
      case "searchHistory":
        await this.handleSearchHistory(
          msg.query as string,
          msg.requestId as string,
          viewType,
          windowId,
        );
        break;
      case "getAuthStatus":
        await this.handleGetAuthStatus(viewType, windowId);
        break;
      case "login":
        await this.handleLogin(viewType, windowId);
        break;
      case "logout":
        await this.handleLogout(viewType, windowId);
        break;
      case "getAgentsContent":
        await this.handleGetAgentsContent(
          msg.scope as "user" | "project",
          msg.workdir as string | undefined,
          viewType,
          windowId,
        );
        break;
      case "setAgentsContent":
        await this.handleSetAgentsContent(
          msg.scope as "user" | "project",
          msg.content as string,
          msg.workdir as string | undefined,
          viewType,
          windowId,
        );
        break;
      case "getStatus":
        await this.handleGetStatus(viewType, windowId);
        break;
      case "getMcpServers":
        await this.handleGetMcpServers(viewType, windowId);
        break;
      case "getMcpConfigPaths":
        await this.handleGetMcpConfigPaths(viewType, windowId);
        break;
      case "removeMcpServer":
        await this.handleRemoveMcpServer(
          msg.scope as "user" | "project",
          msg.serverName as string,
          viewType,
          windowId,
        );
        break;
      case "deleteSkill":
        await this.handleDeleteSkill(msg.name as string, viewType, windowId);
        break;
      case "deleteSubagent":
        await this.handleDeleteSubagent(msg.name as string, viewType, windowId);
        break;
      case "getHooksByScope":
        await this.handleGetHooksByScope(
          msg.scope as "user" | "project" | "plugin",
          viewType,
          windowId,
        );
        break;
      case "deleteHook":
        await this.handleDeleteHook(
          msg.scope as "user" | "project",
          msg.hookName as string,
          viewType,
          windowId,
        );
        break;
      case "getSubagentConfigurations":
        await this.handleGetSubagentConfigurations(viewType, windowId);
        break;
      case "getSkillMetadata":
        await this.handleGetSkillMetadata(viewType, windowId);
        break;
      case "connectMcpServer":
        await this.handleConnectMcpServer(
          msg.serverName as string,
          viewType,
          windowId,
        );
        break;
      case "disconnectMcpServer":
        await this.handleDisconnectMcpServer(
          msg.serverName as string,
          viewType,
          windowId,
        );
        break;
      case "getBackgroundTaskOutput": {
        const session = this.context.getChatSession(
          viewType || "tab",
          windowId,
        );
        const taskId = msg.taskId as string;
        const output = await session.getBackgroundTaskOutput(taskId);
        this.context.postMessage(
          { command: "backgroundTaskOutput", taskId, output },
          viewType,
          windowId,
        );
        break;
      }
      case "stopBackgroundTask": {
        const session = this.context.getChatSession(
          viewType || "tab",
          windowId,
        );
        const taskId = msg.taskId as string;
        const success = await session.stopBackgroundTask(taskId);
        this.context.postMessage(
          { command: "backgroundTaskStopped", taskId, success },
          viewType,
          windowId,
        );
        break;
      }
      case "backgroundCurrentTask": {
        const session = this.context.getChatSession(
          viewType || "tab",
          windowId,
        );
        await session.backgroundCurrentTask();
        break;
      }
      case "getWorkflowRuns": {
        const session = this.context.getChatSession(
          viewType || "tab",
          windowId,
        );
        const runs = await session.getWorkflowRuns();
        this.context.postMessage(
          { command: "workflowRunsResponse", runs },
          viewType,
          windowId,
        );
        break;
      }
      case "stopWorkflowRun": {
        const session = this.context.getChatSession(
          viewType || "tab",
          windowId,
        );
        const runId = msg.runId as string;
        const success = await session.stopWorkflowRun(runId);
        this.context.postMessage(
          { command: "workflowRunStopped", runId, success },
          viewType,
          windowId,
        );
        break;
      }
    }
  }

  /**
   * Routes messages from the standalone editor-area settings tab (see
   * WebviewManager.getOrCreateSettingsPanel). The settings panel is independent
   * of any chat session — configuration + AGENTS.md RPCs are served by the
   * shared configService/utilityClient and responses are posted back to the
   * settings panel itself (never the chat webviews).
   */
  public async handleSettingsMessage(message: unknown) {
    const msg = message as Record<string, unknown>;
    switch (msg.command as string) {
      case "getConfiguration":
        await this.handleSettingsGetConfiguration();
        break;
      case "updateConfiguration":
        await this.handleSettingsUpdateConfiguration(msg.configurationData);
        break;
      case "getAgentsContent":
        await this.handleSettingsGetAgentsContent(
          msg.scope as "user" | "project",
          msg.workdir as string | undefined,
        );
        break;
      case "setAgentsContent":
        await this.handleSettingsSetAgentsContent(
          msg.scope as "user" | "project",
          msg.content as string,
          msg.workdir as string | undefined,
        );
        break;
      case "getProjectSettings":
        // 项目设置视图（内置插件 SDD 开关）：读取项目 .wave/settings.json 合并
        // 后的 enabledPlugins。chat 路由 handleMessage 也有同名命令，但设置页在
        // 独立 settings tab（settings-preview-entry）里渲染，必须走本路由并把
        // 回包发给设置面板本身（postSettingsMessage）——漏掉时 webview 的
        // projectSettings 恒为 undefined，SDD 开关被 !projectSettings 永久禁用。
        await this.handleSettingsGetProjectSettings();
        break;
      case "setBuiltinPluginEnabled":
        await this.handleSettingsSetBuiltinPluginEnabled(
          msg.pluginId as string,
          msg.enabled as boolean,
          msg.scope as string,
        );
        break;
      // 插件市场（设置页「AI 与扩展 → 插件市场」视图）：命令与回包都走设置
      // 面板路由——插件市场只在设置页渲染（PluginDialog 已删除，/plugin 变为
      // 唤起设置页该选项卡），聊天路由不再注册这批命令。
      case "listPlugins":
        await this.handleSettingsListPlugins();
        break;
      case "listMarketplaces":
        await this.handleSettingsListMarketplaces();
        break;
      case "installPlugin":
        await this.applyPluginChange(
          () =>
            this.pluginService.installPlugin(
              msg.pluginId as string,
              msg.scope as Scope,
            ),
          "安装插件失败",
        );
        break;
      case "uninstallPlugin":
        await this.applyPluginChange(
          () => this.pluginService.uninstallPlugin(msg.pluginId as string),
          "卸载插件失败",
        );
        break;
      case "updatePlugin":
        await this.applyPluginChange(
          () => this.pluginService.updatePlugin(msg.pluginId as string),
          "更新插件失败",
        );
        break;
      case "setPluginScope":
        await this.applyPluginChange(
          () =>
            this.pluginService.setPluginScope(
              msg.pluginId as string,
              msg.scope as Scope,
            ),
          "更换安装作用域失败",
        );
        break;
      case "addMarketplace":
        await this.applyMarketplaceChange(
          () => this.pluginService.addMarketplace(msg.input as string),
          "添加市场失败",
        );
        break;
      case "removeMarketplace":
        await this.applyMarketplaceChange(
          () => this.pluginService.removeMarketplace(msg.name as string),
          "移除市场失败",
        );
        break;
      case "updateMarketplace":
        await this.handleSettingsUpdateMarketplace(
          msg.name as string | undefined,
        );
        break;
      case "selectPluginMarketFolder":
        await this.handleSettingsSelectPluginMarketFolder(
          msg.requestId as string,
        );
        break;
      case "getHooksConfig":
        await this.handleSettingsGetHooksConfig(
          msg.scope as "user" | "project" | undefined,
          msg.workdir as string | undefined,
        );
        break;
      case "getMcpConfig":
        await this.handleSettingsGetMcpConfig(
          msg.scope as "user" | "project" | undefined,
          msg.workdir as string | undefined,
        );
        break;
      case "closeSettings":
        this.context.closeSettings();
        break;
      case "getSubagentConfigurations":
        await this.handleSettingsGetSubagentConfigurations();
        break;
      case "getSkillMetadata":
        await this.handleSettingsGetSkillMetadata();
        break;
      case "deleteSkill":
        await this.handleSettingsDeleteSkill(msg.name as string);
        break;
      case "deleteSubagent":
        await this.handleSettingsDeleteSubagent(msg.name as string);
        break;
      case "getHooksByScope":
        await this.handleSettingsGetHooksByScope(
          msg.scope as "user" | "project" | "plugin",
        );
        break;
      case "deleteHook":
        await this.handleSettingsDeleteHook(
          msg.scope as "user" | "project",
          msg.hookName as string,
        );
        break;
      case "getMcpServers":
        await this.handleSettingsGetMcpServers();
        break;
      case "getMcpConfigPaths":
        await this.handleSettingsGetMcpConfigPaths();
        break;
      case "getManagedSettings":
        // 设置页「服务端配置」区块：服务端下发的托管配置原文。与 chat 路由的
        // 同名命令无关——设置页在独立 settings tab 里渲染，回包必须发给设置
        // 面板本身（postSettingsMessage）。
        await this.handleSettingsGetManagedSettings(msg.requestId as string);
        break;
      case "connectMcpServer":
        await this.handleSettingsConnectMcpServer(msg.serverName as string);
        break;
      case "disconnectMcpServer":
        await this.handleSettingsDisconnectMcpServer(msg.serverName as string);
        break;
      case "removeMcpServer":
        await this.handleSettingsRemoveMcpServer(
          msg.scope as "user" | "project",
          msg.serverName as string,
        );
        break;
      case "openFile":
        await this.handleOpenFile(
          msg.path as string,
          msg.startLine as number,
          msg.endLine as number,
        );
        break;
      case "prefillPrompt":
        // 设置页「新建/编辑」预填提示词 → 关闭设置 tab 后转发给聊天 webview，
        // ChatApp 收到后 loadDraft（spec：AI 对话框在当前会话继续）。
        this.context.closeSettings();
        this.context.postMessage({
          command: "prefillPrompt",
          prompt: msg.prompt as string,
        });
        break;
    }
  }

  private async handleSettingsGetConfiguration(): Promise<void> {
    try {
      const config = await this.configService.loadConfiguration();
      this.context.postSettingsMessage({
        command: "configurationResponse",
        configurationData: config,
      });
    } catch (error) {
      console.error("Failed to get settings configuration:", error);
      this.context.postSettingsMessage({
        command: "configurationError",
        error: "Failed to load configuration: " + error,
      });
    }
  }

  private async handleSettingsUpdateConfiguration(
    configData: unknown,
  ): Promise<void> {
    try {
      await this.configService.saveConfiguration(
        configData as Partial<ConfigurationData>,
      );
      const config = await this.configService.loadConfiguration();
      // 用户偏好写入用户级 settings.json，由 SDK 实时重载在**下一轮对话**生效；
      // 保存不重建会话（spec agent-config「设置实时重载」/「配置变更的构造期
      // 副作用与重建」场景 1–2）：回执与界面刷新不等待任何重建。
      // 设置页保存结果经宿主原生通知提示（spec「设置页反馈语义」，webview 不再
      // 渲染页面内提示）；configurationResponse 仍回发以刷新设置页展示值。
      vscode.window.showInformationMessage("保存成功");
      this.context.postSettingsMessage({ command: "configurationUpdated" });
      this.context.postSettingsMessage({
        command: "configurationResponse",
        configurationData: config,
      });
    } catch (error) {
      console.error("Failed to save settings configuration:", error);
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`保存失败：${message}`);
      this.context.postSettingsMessage({
        command: "configurationError",
        error: "Failed to save configuration: " + error,
      });
    }
  }

  /** AGENTS.md settings UI: fetch user/project memory file content (settings tab). */
  private async handleSettingsGetAgentsContent(
    scope: "user" | "project",
    workdir: string | undefined,
  ): Promise<void> {
    try {
      const result = (await this.utilityClient.request("getAgentsContent", {
        scope,
        workdir,
      })) as { content: string; path?: string };
      this.context.postSettingsMessage({
        command: "agentsContentResponse",
        scope,
        content: result.content,
      });
    } catch (error) {
      console.error("获取 AGENTS.md 内容失败:", error);
      this.context.postSettingsMessage({
        command: "agentsContentResponse",
        scope,
        content: "",
      });
    }
  }

  /** Settings page hooks read-only view: fetch scope-scoped hooks config. */
  private async handleSettingsGetHooksConfig(
    scope: "user" | "project" | undefined,
    workdir: string | undefined,
  ): Promise<void> {
    try {
      const result = (await this.utilityClient.request("getHooksConfig", {
        scope,
        workdir,
      })) as { hooks?: Record<string, unknown> };
      this.context.postSettingsMessage({
        command: "hooksConfigResponse",
        scope: scope ?? "user",
        hooks: result.hooks,
      });
    } catch (error) {
      console.error("获取钩子配置失败:", error);
      this.context.postSettingsMessage({
        command: "hooksConfigResponse",
        scope: scope ?? "user",
        hooks: undefined,
      });
    }
  }

  /** Settings page MCP read-only view: fetch scope-scoped mcp.json config. */
  private async handleSettingsGetMcpConfig(
    scope: "user" | "project" | undefined,
    workdir: string | undefined,
  ): Promise<void> {
    try {
      const result = (await this.utilityClient.request("getMcpConfig", {
        scope,
        workdir,
      })) as { mcpServers: Record<string, unknown> };
      this.context.postSettingsMessage({
        command: "mcpConfigResponse",
        scope: scope ?? "user",
        mcpServers: result.mcpServers,
      });
    } catch (error) {
      console.error("获取 MCP 配置失败:", error);
      this.context.postSettingsMessage({
        command: "mcpConfigResponse",
        scope: scope ?? "user",
        mcpServers: {},
      });
    }
  }

  /** AGENTS.md settings UI: persist content via the stdio setAgentsContent RPC (settings tab). */
  private async handleSettingsSetAgentsContent(
    scope: "user" | "project",
    content: string,
    workdir: string | undefined,
  ): Promise<void> {
    try {
      await this.utilityClient.request("setAgentsContent", {
        scope,
        content,
        workdir,
      });
      // AGENTS.md 保存结果经宿主原生通知提示（spec「设置页反馈语义」）；
      // agentsContentSaved 仍回发以复位 webview 的保存中状态。
      vscode.window.showInformationMessage("保存成功");
      this.context.postSettingsMessage({
        command: "agentsContentSaved",
        scope,
        ok: true,
      });
    } catch (error) {
      console.error("保存 AGENTS.md 失败:", error);
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`保存失败：${message}`);
      this.context.postSettingsMessage({
        command: "agentsContentSaved",
        scope,
        ok: false,
        error: String(error),
      });
    }
  }

  /** 技能/子代理/钩子/MCP 管理 RPC 服务端：设置 tab 独立于会话，数据经
   *   sidebar 会话的 CLI agent 读取（getSubagentConfigurations 等同源）。 */
  private getSettingsSession(): ChatSession {
    return this.context.getChatSession("sidebar");
  }

  /** 项目设置视图（内置插件 SDD 开关）：读取项目 .wave/settings.json 合并后的
   *  enabledPlugins，回包发给设置面板（pluginService 以工作区根目录为 workdir，
   *  归属键随包回带；无工作区窗口回 ""——webview 按不匹配丢弃=未加载）。 */
  private async handleSettingsGetProjectSettings(): Promise<void> {
    try {
      const result = await this.pluginService.getProjectSettings();
      this.context.postSettingsMessage({
        command: "projectSettings",
        enabledPlugins: result.enabledPlugins,
        workdir: this.pluginService.getWorkdir() ?? "",
      });
    } catch (error) {
      console.error("获取项目设置失败:", error);
      vscode.window.showErrorMessage("获取项目设置失败: " + error);
    }
  }

  /** 切换项目级内置插件（sdd@builtin 等）：写回 .wave/settings.json 后回发
   *  projectSettings 刷新开关，并重载配置重建 agent 使插件立即生效
   *  （与 chat 路由 handleSetBuiltinPluginEnabled 同语义）。 */
  private async handleSettingsSetBuiltinPluginEnabled(
    pluginId: string,
    enabled: boolean,
    scope: string,
  ): Promise<void> {
    try {
      const result = await this.pluginService.setBuiltinPluginEnabled(
        pluginId,
        enabled,
        scope as Scope,
      );
      this.context.postSettingsMessage({
        command: "projectSettings",
        enabledPlugins: result.enabledPlugins,
        workdir: this.pluginService.getWorkdir() ?? "",
      });

      // Recreate agents so plugin changes take effect
      this.context.updateAllSessionsConfig();
    } catch (error) {
      console.error("修改项目设置失败:", error);
      vscode.window.showErrorMessage("修改项目设置失败: " + error);
    }
  }

  /** 插件市场：插件列表（回包发给设置面板，插件市场视图据此渲染）。 */
  private async handleSettingsListPlugins(): Promise<void> {
    try {
      const plugins = await this.pluginService.listPlugins();
      this.context.postSettingsMessage({
        command: "listPluginsResponse",
        plugins,
      });
    } catch (error) {
      console.error("获取插件列表失败:", error);
      vscode.window.showErrorMessage("获取插件列表失败: " + error);
    }
  }

  /** 插件市场：已注册市场列表（同上）。 */
  private async handleSettingsListMarketplaces(): Promise<void> {
    try {
      const marketplaces = await this.pluginService.listMarketplaces();
      this.context.postSettingsMessage({
        command: "listMarketplacesResponse",
        marketplaces,
      });
    } catch (error) {
      console.error("获取市场列表失败:", error);
      vscode.window.showErrorMessage("获取市场列表失败: " + error);
    }
  }

  /**
   * 执行一次插件变更（安装/卸载/更新/更换作用域）并收尾：刷新插件列表 +
   * 重建全部会话 agent。插件在 Agent 构造期注册技能/命令/子代理/MCP，属构造期
   * 副作用（spec agent-config「配置变更的构造期副作用与重建」），不重建则运行中
   * 的会话看不到变更。失败经宿主提示告知原因（spec 插件市场场景 17）。
   */
  private async applyPluginChange(
    change: () => Promise<unknown>,
    failureMessage: string,
  ): Promise<void> {
    try {
      await change();
      await this.handleSettingsListPlugins();
      this.context.updateAllSessionsConfig();
    } catch (error) {
      console.error(`${failureMessage}:`, error);
      vscode.window.showErrorMessage(`${failureMessage}: ${error}`);
    }
  }

  /**
   * 执行一次市场变更（新增/移除）并收尾：市场列表与插件列表都要刷新——插件按
   * 所属市场组织，市场增减会改变插件集合（spec 插件市场场景 15）。
   */
  private async applyMarketplaceChange(
    change: () => Promise<unknown>,
    failureMessage: string,
  ): Promise<void> {
    try {
      await change();
      await this.handleSettingsListMarketplaces();
      await this.handleSettingsListPlugins();
    } catch (error) {
      console.error(`${failureMessage}:`, error);
      vscode.window.showErrorMessage(`${failureMessage}: ${error}`);
    }
  }

  /**
   * 更新市场：拉取最新市场源并升级该市场内已安装且有新版本的插件（升级发生在
   * SDK 侧），按实际升级数量给出宿主提示——0 个时提示「已是最新」
   * （spec 插件市场场景 13）。
   */
  private async handleSettingsUpdateMarketplace(name?: string): Promise<void> {
    try {
      const { updated } = await this.pluginService.updateMarketplace(name);
      await this.handleSettingsListMarketplaces();
      await this.handleSettingsListPlugins();
      vscode.window.showInformationMessage(
        updated > 0 ? `已更新 ${updated} 个插件` : "当前市场已是最新",
      );
    } catch (error) {
      console.error("更新市场失败:", error);
      vscode.window.showErrorMessage("更新市场失败: " + error);
    }
  }

  /**
   * 新建市场「本地路径」的系统目录选择器（VS Code 原生 showOpenDialog）。
   * 选定即回 path，用户取消/失败时只回 requestId（webview 据此清掉等待态）。
   */
  private async handleSettingsSelectPluginMarketFolder(
    requestId: string,
  ): Promise<void> {
    try {
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: "选择插件市场目录",
      });
      this.context.postSettingsMessage({
        command: "pluginMarketFolderSelected",
        requestId,
        ...(selected && selected.length > 0
          ? { path: selected[0].fsPath }
          : {}),
      });
    } catch (error) {
      console.error("选择插件市场目录失败:", error);
      this.context.postSettingsMessage({
        command: "pluginMarketFolderSelected",
        requestId,
      });
    }
  }

  private async handleSettingsGetSubagentConfigurations(): Promise<void> {
    try {
      const session = this.getSettingsSession();
      const configurations = await session.getSubagentConfigurations();
      this.context.postSettingsMessage({
        command: "subagentConfigurationsResponse",
        configurations,
      });
    } catch (error) {
      console.error("Failed to get subagent configurations:", error);
    }
  }

  private async handleSettingsGetSkillMetadata(): Promise<void> {
    try {
      const session = this.getSettingsSession();
      const skills = await session.getSkillMetadata();
      this.context.postSettingsMessage({
        command: "skillMetadataResponse",
        skills,
      });
    } catch (error) {
      console.error("Failed to get skill metadata:", error);
    }
  }

  private async handleSettingsDeleteSkill(name: string): Promise<void> {
    try {
      const session = this.getSettingsSession();
      const success = await session.deleteSkill(name);
      // 写操作需 live agent（spec「设置页反馈语义」）：agent 缺失（deleteSkill
      // 静默返回 false）或对象不存在都不得无提示空转。
      if (success) {
        vscode.window.showInformationMessage(`已删除技能「${name}」`);
      } else {
        vscode.window.showErrorMessage(
          `删除技能失败: 未找到技能「${name}」或智能体未初始化`,
        );
      }
      const skills = await session.getSkillMetadata();
      this.context.postSettingsMessage({
        command: "skillMetadataResponse",
        skills,
      });
    } catch (error) {
      console.error("Failed to delete skill:", error);
      vscode.window.showErrorMessage("删除技能失败: " + error);
    }
  }

  private async handleSettingsDeleteSubagent(name: string): Promise<void> {
    try {
      const session = this.getSettingsSession();
      const success = await session.deleteSubagent(name);
      if (success) {
        vscode.window.showInformationMessage(`已删除子代理「${name}」`);
      } else {
        vscode.window.showErrorMessage(
          `删除子代理失败: 未找到子代理「${name}」或智能体未初始化`,
        );
      }
      const configurations = await session.getSubagentConfigurations();
      this.context.postSettingsMessage({
        command: "subagentConfigurationsResponse",
        configurations,
      });
    } catch (error) {
      console.error("Failed to delete subagent:", error);
      vscode.window.showErrorMessage("删除子代理失败: " + error);
    }
  }

  private async handleSettingsGetHooksByScope(
    scope: "user" | "project" | "plugin",
  ): Promise<void> {
    try {
      const session = this.getSettingsSession();
      const { hooks, configPath } = await session.getHooksByScope(scope);
      this.context.postSettingsMessage({
        command: "hooksResponse",
        // 归属键：请求 scope 恒回带（webview 切 Tab 过期即弃）
        scope,
        hooks,
        // 钩子所在 settings.json 的绝对路径（GUI「编辑」打开文件用）
        configPath,
      });
    } catch (error) {
      console.error("Failed to get hooks by scope:", error);
    }
  }

  private async handleSettingsDeleteHook(
    scope: "user" | "project",
    hookName: string,
  ): Promise<void> {
    const session = this.getSettingsSession();
    // deleteHook 无返回值：agent 缺失时 ChatSession 静默早退，须显式防御
    // （spec「设置页反馈语义」——写操作无 live agent 不得空转）。
    if (!session.agent) {
      vscode.window.showErrorMessage("删除钩子失败: 智能体未初始化");
      return;
    }
    try {
      await session.deleteHook(scope, hookName);
      vscode.window.showInformationMessage(`已删除钩子「${hookName}」`);
      const { hooks, configPath } = await session.getHooksByScope(scope);
      this.context.postSettingsMessage({
        command: "hooksResponse",
        // 归属键：请求 scope 恒回带（同 handleSettingsGetHooksByScope）
        scope,
        hooks,
        configPath,
      });
    } catch (error) {
      console.error("Failed to delete hook:", error);
      vscode.window.showErrorMessage("删除钩子失败: " + error);
    }
  }

  private async handleSettingsGetMcpServers(): Promise<void> {
    try {
      const session = this.getSettingsSession();
      const servers = await session.getMcpServers();
      this.context.postSettingsMessage({
        command: "mcpServersResponse",
        servers,
      });
    } catch (error) {
      console.error("Failed to get MCP servers:", error);
    }
  }

  private async handleSettingsGetMcpConfigPaths(): Promise<void> {
    try {
      const session = this.getSettingsSession();
      this.context.postSettingsMessage({
        command: "mcpConfigPathsResponse",
        userPath: await session.getUserMcpConfigPath(),
        projectPath: await session.getProjectMcpConfigPath(),
      });
    } catch (error) {
      console.error("Failed to get MCP config paths:", error);
    }
  }

  /**
   * 设置页「服务端配置」区块：回服务端下发的托管配置**原文**（spec
   * server-managed-config「在设置页查看服务端下发的配置」）。读会话所在进程最近
   * 一次成功下发的缓存（`getManagedSettings` RPC 只读进程内缓存、不发网络请求）；
   * 无下发内容（未登录 / 服务端未配置 / 已撤销 / 缓存损坏）或 RPC 失败回 null，
   * 设置页按空态展示，不编造空对象冒充「有下发」。全文不脱敏。
   */
  private async handleSettingsGetManagedSettings(
    requestId: string,
  ): Promise<void> {
    let managedSettings: Record<string, unknown> | null = null;
    try {
      const result = (await this.utilityClient.request(
        "getManagedSettings",
      )) as { managedSettings: Record<string, unknown> | null };
      managedSettings = result.managedSettings ?? null;
    } catch (error) {
      console.error("Failed to get managed settings:", error);
    }
    // 归属键 requestId 原样带回：多次进入该视图时晚到的旧回复被 webview 丢弃。
    this.context.postSettingsMessage({
      command: "managedSettingsResponse",
      requestId,
      managedSettings,
    });
  }

  private async handleSettingsConnectMcpServer(
    serverName: string,
  ): Promise<void> {
    try {
      const session = this.getSettingsSession();
      await session.connectMcpServer(serverName);
    } catch (error) {
      console.error("Failed to connect MCP server:", error);
      vscode.window.showErrorMessage("连接 MCP 服务器失败: " + error);
    }
  }

  private async handleSettingsDisconnectMcpServer(
    serverName: string,
  ): Promise<void> {
    try {
      const session = this.getSettingsSession();
      await session.disconnectMcpServer(serverName);
      // Refresh the list regardless of the return value: the SDK's
      // onMcpServersChange push may not fire on every path (early return /
      // teardown error), and without it the webview「断开中…」spinner never
      // settles. Mirrors handleSettingsRemoveMcpServer below.
      const servers = await session.getMcpServers();
      this.context.postSettingsMessage({
        command: "mcpServersResponse",
        servers,
      });
    } catch (error) {
      console.error("Failed to disconnect MCP server:", error);
      vscode.window.showErrorMessage("断开 MCP 服务器失败: " + error);
    }
  }

  private async handleSettingsRemoveMcpServer(
    scope: "user" | "project",
    serverName: string,
  ): Promise<void> {
    try {
      const session = this.getSettingsSession();
      const success = await session.removeMcpServer(scope, serverName);
      if (success) {
        vscode.window.showInformationMessage(
          `已移除 MCP 服务器「${serverName}」`,
        );
      } else {
        vscode.window.showErrorMessage(
          `移除 MCP 服务器失败: 未找到服务器「${serverName}」或智能体未初始化`,
        );
      }
      const servers = await session.getMcpServers();
      this.context.postSettingsMessage({
        command: "mcpServersResponse",
        servers,
      });
    } catch (error) {
      console.error("Failed to remove MCP server:", error);
      vscode.window.showErrorMessage("移除 MCP 服务器失败: " + error);
    }
  }

  private async handleRequestHistory(
    requestId: string,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    try {
      const result = (await this.utilityClient.request("getPromptHistory")) as {
        history: unknown[];
      };
      this.context.postMessage(
        {
          command: "historyResponse",
          // 归属键：请求 requestId 原样带回（webview 过期即弃）
          requestId,
          history: result.history,
        },
        viewType,
        windowId,
      );
    } catch (error) {
      console.error(`获取 ${viewType} 历史记录失败:`, error);
      this.context.postMessage(
        {
          command: "historyError",
          error: "获取历史记录失败: " + error,
        },
        viewType,
        windowId,
      );
    }
  }

  private async handleSearchHistory(
    query: string,
    requestId: string,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    try {
      const result = (await this.utilityClient.request("searchPromptHistory", {
        query,
      })) as { history: unknown[] };
      this.context.postMessage(
        {
          command: "historyResponse",
          // 归属键：请求 requestId 原样带回（webview 过期即弃）
          requestId,
          history: result.history,
        },
        viewType,
        windowId,
      );
    } catch (error) {
      console.error(`搜索 ${viewType} 历史记录失败:`, error);
      this.context.postMessage(
        {
          command: "historyError",
          error: "搜索历史记录失败: " + error,
        },
        viewType,
        windowId,
      );
    }
  }

  private async handleRewindToMessage(
    messageId: string,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    // The webview already showed the confirmation dialog — execute directly.
    const session = this.context.getChatSession(viewType || "tab", windowId);
    try {
      await session.rewindToMessage(messageId);
      // Notify frontend to update state (including inputContent)
      await this.handleWebviewReady(viewType, windowId);
      this.context.postMessage({ command: "focusInput" }, viewType, windowId);
      this.context.postMessage(
        { command: "scrollToBottom" },
        viewType,
        windowId,
      );
    } catch (error) {
      console.error(`回滚 ${viewType} 会话失败:`, error);
      vscode.window.showErrorMessage("回滚失败: " + error);
    }
  }

  private async handleListRewindCheckpoints(
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    try {
      const { checkpoints } =
        (await session.agent?.listRewindCheckpoints()) ?? { checkpoints: [] };
      this.context.postMessage(
        {
          command: "rewindCheckpoints",
          checkpoints,
        },
        viewType,
        windowId,
      );
    } catch (error) {
      console.error(`获取 ${viewType} 回退检查点失败:`, error);
      this.context.postMessage(
        {
          command: "rewindCheckpoints",
          checkpoints: [],
        },
        viewType,
        windowId,
      );
    }
  }

  private async handleGetConfiguredModels(
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    try {
      const result = (await session.agent?.getConfiguredModels()) ?? {
        models: [],
        currentModel: undefined,
      };
      this.context.postMessage(
        {
          command: "configuredModels",
          models: result.models,
          currentModel: result.currentModel,
        },
        viewType,
        windowId,
      );
    } catch (error) {
      console.error(`获取 ${viewType} 模型列表失败:`, error);
      this.context.postMessage(
        {
          command: "configuredModels",
          models: [],
          currentModel: undefined,
        },
        viewType,
        windowId,
      );
    }
  }

  private async handleSetModel(
    model: string,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    try {
      await session.agent?.setModel(model);
    } catch (error) {
      console.error(`设置 ${viewType} 模型失败:`, error);
    }
  }

  private async handleAskBtw(
    question: string,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    try {
      const answer = await session.askBtw(question);
      this.context.postMessage(
        {
          command: "btwResponse",
          question,
          answer,
        },
        viewType,
        windowId,
      );
    } catch (error) {
      console.error(`旁路提问 ${viewType} 失败:`, error);
      this.context.postMessage(
        {
          command: "btwError",
          question,
          error: error instanceof Error ? error.message : String(error),
        },
        viewType,
        windowId,
      );
    }
  }

  private async handleOpenFile(
    filePath: string,
    startLine?: number,
    endLine?: number,
  ) {
    if (!filePath) return;

    const uri = vscode.Uri.file(filePath);
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);

      if (startLine !== undefined) {
        const start = new vscode.Position(Math.max(0, startLine - 1), 0);
        const end = new vscode.Position(
          Math.max(0, (endLine || startLine) - 1),
          0,
        );
        editor.selection = new vscode.Selection(start, end);
        editor.revealRange(
          new vscode.Range(start, end),
          vscode.TextEditorRevealType.InCenter,
        );
      }
    } catch {
      // Binary files (images, PDFs, etc.) cannot be opened as text —
      // fall back to VS Code's built-in viewer.
      try {
        await vscode.commands.executeCommand("vscode.open", uri);
      } catch (fallbackError) {
        console.error("打开文件失败:", fallbackError);
        vscode.window.showErrorMessage("打开文件失败: " + fallbackError);
      }
    }
  }

  private async handleOpenExternal(url: string) {
    if (!url) return;

    try {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (error) {
      console.error("打开外部链接失败:", error);
      vscode.window.showErrorMessage("打开外部链接失败: " + error);
    }
  }

  private async handlePreviewImage(filePath: string) {
    if (!filePath) return;

    try {
      const uri = vscode.Uri.file(filePath);
      await vscode.commands.executeCommand("vscode.open", uri);
    } catch (error) {
      console.error("预览图片失败:", error);
      vscode.window.showErrorMessage("预览图片失败: " + error);
    }
  }

  private async handleGetProjectSettings(
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    try {
      const result = await this.pluginService.getProjectSettings();
      this.context.postMessage(
        {
          command: "projectSettings",
          enabledPlugins: result.enabledPlugins,
          // 归属键：请求所用 workdir（pluginService = 工作区根目录）恒回带
          workdir: this.pluginService.getWorkdir() ?? "",
        },
        viewType,
        windowId,
      );
    } catch (error) {
      vscode.window.showErrorMessage("获取项目设置失败: " + error);
    }
  }

  private async handleSetBuiltinPluginEnabled(
    pluginId: string,
    enabled: boolean,
    scope: string,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    try {
      const result = await this.pluginService.setBuiltinPluginEnabled(
        pluginId,
        enabled,
        scope as Scope,
      );
      this.context.postMessage(
        {
          command: "projectSettings",
          enabledPlugins: result.enabledPlugins,
          // 归属键：同 chat 路由 handleGetProjectSettings
          workdir: this.pluginService.getWorkdir() ?? "",
        },
        viewType,
        windowId,
      );

      // Recreate agents so plugin changes take effect
      this.context.updateAllSessionsConfig();
    } catch (error) {
      vscode.window.showErrorMessage("修改项目设置失败: " + error);
    }
  }

  private async handleSetPermissionMode(
    mode: string,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    try {
      await session.setPermissionMode(mode as PermissionMode);
    } catch (error) {
      console.error(`设置 ${viewType} 权限模式失败:`, error);
      vscode.window.showErrorMessage("设置权限模式失败: " + error);
    }
  }

  private async handleDeleteQueuedMessage(
    index: number,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    session.deleteQueuedMessage(index);
  }

  private async handleUpdateQueuedMessage(
    id: string,
    text: string,
    images: Array<{ path: string; mimeType: string }> | undefined,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    const ok = await session.updateQueuedMessage(id, text, images);
    if (!ok) {
      this.context.postMessage(
        {
          command: "updateQueuedMessageMissing",
          id,
        },
        viewType,
        windowId,
      );
    }
  }

  private async handleDeleteQueuedMessageById(
    id: string,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    await session.deleteQueuedMessageById(id);
  }

  private handleUpdateInputContent(
    content: string,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    session.inputContent = content;
  }

  private async sendMessageToAgent(
    text: string,
    images?: Array<{ data: string; mediaType: string }>,
    force?: boolean,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    try {
      await session.sendMessage(text, images, force);
    } catch (error) {
      console.error(`发送消息给 ${viewType} 智能体时出错:`, error);
      vscode.window.showErrorMessage(
        `发送消息失败: ${error}。详情见 CodeWave IDE 输出面板或 ~/.wave/logs/cli.log`,
      );
    }
  }

  private async abortMessage(
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    session.abortMessage();
  }

  private async clearChat(
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    // 单会话原地清空：存在正在运行的后台任务（shell/subagent/workflow）时静默
    // 忽略 —— webview 已禁用按钮，此为覆盖「通知在途」竞态窗口与其它调用方的
    // host 侧双防线（spec session-management.md「IDE 插件聊天头部」场景 6/7）。
    if (session.backgroundTasks.some((t) => t.status === "running")) return;
    try {
      await session.clearChat();
      // No full-snapshot push from the server — deliver the (now empty)
      // list so the webview actually clears.
      this.context.postMessage(
        { command: "updateMessages", messages: session.messages },
        viewType,
        windowId,
      );
    } catch (error) {
      console.error(`清除 ${viewType} 聊天会话失败:`, error);
      vscode.window.showErrorMessage("清除聊天失败: " + error);
    }
  }

  private async compactChat(
    customInstructions: string | undefined,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    try {
      await session.compact(customInstructions);
    } catch (error) {
      console.error(`压缩 ${viewType} 聊天会话失败:`, error);
      vscode.window.showErrorMessage("压缩对话失败: " + error);
    }
  }

  private async restoreSession(
    sessionId: string,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    if (!sessionId) return;
    const session = this.context.getChatSession(viewType || "tab", windowId);
    // 同 clearChat 守卫：后台任务运行期间禁止原地恢复历史会话。
    if (session.backgroundTasks.some((t) => t.status === "running")) return;
    try {
      await session.restoreSession(sessionId);
      // No full-snapshot push from the server — deliver the restored list
      // so the webview re-renders instead of keeping the welcome page.
      this.context.postMessage(
        { command: "updateMessages", messages: session.messages },
        viewType,
        windowId,
      );
    } catch (error) {
      console.error(`恢复 ${viewType} 会话失败:`, error);
      vscode.window.showErrorMessage("恢复会话失败: " + error);
    }
  }

  private async handleFileSuggestionsRequest(
    filterText: string,
    requestId: string,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    try {
      const files = await this.fileService.findWorkspaceFiles(filterText);
      this.context.postMessage(
        {
          command: "fileSuggestionsResponse",
          suggestions: files,
          filterText: filterText,
          requestId: requestId,
        },
        viewType,
        windowId,
      );
    } catch (error) {
      console.error(`获取 ${viewType} 文件建议失败:`, error);
      this.context.postMessage(
        {
          command: "fileSuggestionsError",
          error: "获取文件建议失败: " + error,
          requestId: requestId,
        },
        viewType,
        windowId,
      );
    }
  }

  private async handleUploadFilesToArtifacts(
    files: Array<{ name: string; data: ArrayBuffer }>,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    try {
      const { uploadedFiles, errors } =
        await this.fileService.uploadFilesToArtifacts(files);
      if (uploadedFiles.length > 0) {
        this.context.postMessage(
          {
            command: "uploadSuccess",
            uploadedFiles: uploadedFiles,
            message: `成功上传 ${uploadedFiles.length} 个文件到临时目录`,
          },
          viewType,
          windowId,
        );
        vscode.window.showInformationMessage(
          `成功上传 ${uploadedFiles.length} 个文件到临时目录`,
        );
      }
      if (errors.length > 0) {
        this.context.postMessage(
          {
            command: "uploadError",
            errors: errors,
            message: `部分文件上传失败: ${errors.length} 个错误`,
          },
          viewType,
          windowId,
        );
        vscode.window.showErrorMessage(
          `部分文件上传失败: ${errors.length} 个错误`,
        );
      }
    } catch (error) {
      console.error(`文件上传处理失败:`, error);
      this.context.postMessage(
        {
          command: "uploadError",
          error: "文件上传处理失败: " + error,
        },
        viewType,
        windowId,
      );
    }
  }

  private async handleConfirmationResponse(
    confirmationId: string,
    approved: boolean,
    decision: unknown,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    const pending = session.pendingConfirmations.get(confirmationId);
    if (!pending) {
      console.warn(`收到 ${viewType} 未知确认响应:`, confirmationId);
      return;
    }
    session.pendingConfirmations.delete(confirmationId);
    if (approved) {
      if (decision) {
        pending.resolve(decision as PermissionDecision);
      } else {
        pending.resolve({ behavior: "allow" } as PermissionDecision);
      }
    } else {
      pending.resolve({ behavior: "deny", message: "用户拒绝了操作" });
      session.abortMessage();
    }
    this.context.postMessage({ command: "focusInput" }, viewType, windowId);
    this.context.postMessage({ command: "scrollToBottom" }, viewType, windowId);
  }

  private async handleGetConfiguration(
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ): Promise<void> {
    try {
      const config = await this.configService.loadConfiguration();
      this.context.postMessage(
        {
          command: "configurationResponse",
          configurationData: config,
        },
        viewType,
        windowId,
      );
    } catch (error) {
      console.error(`Failed to get ${viewType} configuration:`, error);
      this.context.postMessage(
        {
          command: "configurationError",
          error: "Failed to load configuration: " + error,
        },
        viewType,
        windowId,
      );
    }
  }

  private async handleUpdateConfiguration(
    configData: unknown,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ): Promise<void> {
    try {
      await this.configService.saveConfiguration(
        configData as Partial<ConfigurationData>,
      );

      // 同 settings 路由：用户偏好经用户级 settings.json 实时重载生效，保存不
      // 重建会话（spec agent-config「配置变更的构造期副作用与重建」场景 1–2）。

      // 设置页保存结果经宿主原生通知提示（spec「设置页反馈语义」；chat 路由与
      // settings 路由同语义，避免双 switch 漂移）
      vscode.window.showInformationMessage("保存成功");
      this.context.postMessage(
        { command: "configurationUpdated" },
        viewType,
        windowId,
      );
      this.context.postMessage({ command: "focusInput" }, viewType, windowId);
      this.context.postMessage(
        { command: "scrollToBottom" },
        viewType,
        windowId,
      );
    } catch (error) {
      console.error(`Failed to update ${viewType} configuration:`, error);
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`保存失败：${message}`);
      this.context.postMessage(
        {
          command: "configurationError",
          error: "Failed to save configuration: " + error,
        },
        viewType,
        windowId,
      );
    }
  }

  private async handleWebviewReady(
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ): Promise<void> {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    if (!session.agent) {
      await this.context.initializeAgent(viewType || "tab", windowId);
    }
    // No full-snapshot push anymore — the webview pulls the message list on
    // demand (webviewReady / restore / rewind / clear / compact).
    await session.getMessages();
    const configurationData = await this.configService.loadConfiguration();
    const sessions = await this.sessionService.getSessionsList();
    let isAuthenticated = false;
    try {
      const authResult = (await this.utilityClient.request(
        "getAuthStatus",
      )) as {
        isAuthenticated: boolean;
        user?: { id: string; email?: string };
        serverUrl: string;
      };
      isAuthenticated = authResult.isAuthenticated;
      // 服务地址随认证响应下发（配置回包不再携带它）：webview 的「企业控制台 /
      // 帮助文档」按钮读 authStatusResponse.serverUrl。
      this.context.postMessage(
        {
          command: "authStatusResponse",
          isAuthenticated: authResult.isAuthenticated,
          user: authResult.user,
          serverUrl: authResult.serverUrl,
        },
        viewType,
        windowId,
      );
    } catch (error) {
      console.error("Failed to get auth status on webview ready:", error);
    }
    const pendingConfirmations = Array.from(
      session.pendingConfirmations.entries(),
    ).map(([confirmationId, pending]) => ({
      confirmationId,
      toolName: pending.toolName,
      confirmationType: pending.confirmationType,
      toolInput: pending.toolInput,
      suggestedPrefix: pending.suggestedPrefix,
      permissionMode: pending.permissionMode,
    }));

    this.context.postMessage(
      {
        command: "setInitialState",
        messages: session.messages,
        tasks: session.tasks,
        backgroundTasks: session.backgroundTasks,
        workflowRuns: session.workflowRuns,
        inputContent: session.inputContent,
        isStreaming: session.isStreaming,
        isCommandRunning: session.isCommandRunning,
        sessions: sessions,
        session:
          session.sessionId && session.agent
            ? {
                id: session.sessionId,
                sessionType: "main",
                workdir: session.agent.workingDirectory,
                lastActiveAt: new Date(),
                latestTotalTokens: session.agent.latestTotalTokens,
              }
            : undefined,
        configurationData,
        pendingConfirmations,
        permissionMode: session.agent?.getPermissionMode(),
        queuedMessages: session.messageQueue,
        isAuthenticated,
        workdir: session.agent?.workingDirectory,
      },
      viewType,
      windowId,
    );

    // Replay the session's context-usage percentage. A webview that was
    // re-created (window reload) runs webviewReady long after the last token
    // change, so no contextUsage notification is in flight — and the webview
    // clears the ring on every session switch — leaving it empty until a new
    // turn. The agent refreshed the value on the getMessages pull above; post
    // it after setInitialState so it is attributed to the incoming session
    // (same ordering as the desktop replay).
    const contextUsagePercent = session.agent?.contextUsagePercent;
    if (contextUsagePercent !== undefined) {
      this.context.postMessage(
        { command: "contextUsage", percent: contextUsagePercent },
        viewType,
        windowId,
      );
    }
  }

  private async handleSlashCommandsRequest(
    filterText: string,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    try {
      const sdkCommands = await session.getSlashCommands();

      // Local UI slash commands (not in SDK, intercepted in webview)
      const localCommands = [
        { id: "config", name: "config", description: "打开配置设置" },
        { id: "plugin", name: "plugin", description: "打开插件市场" },
        { id: "mcp", name: "mcp", description: "打开 MCP 服务器管理" },
        { id: "status", name: "status", description: "查看当前状态" },
        { id: "clear", name: "clear", description: "清除对话历史并重置会话" },
        { id: "compact", name: "compact", description: "手动压缩对话历史" },
        { id: "tasks", name: "tasks", description: "查看后台任务" },
        { id: "workflows", name: "workflows", description: "查看工作流运行" },
        { id: "agents", name: "agents", description: "查看可用 agents" },
        { id: "skills", name: "skills", description: "查看可用技能" },
        { id: "hooks", name: "hooks", description: "查看已配置钩子" },
        { id: "rewind", name: "rewind", description: "回退到之前的用户消息" },
        { id: "model", name: "model", description: "切换 AI 模型" },
        { id: "btw", name: "btw", description: "旁路提问（不进入聊天记录）" },
        {
          id: "plan",
          name: "plan",
          description: "启用规划模式或查看当前方案",
        },
      ];

      const allCommands = [...sdkCommands, ...localCommands];

      let filteredCommands = allCommands;
      if (filterText && filterText.trim().length > 0) {
        const filter = filterText.toLowerCase();
        filteredCommands = allCommands.filter(
          (command) =>
            command.id.toLowerCase().includes(filter) ||
            command.name.toLowerCase().includes(filter),
        );
      }
      const commands = filteredCommands.map((command) => ({
        id: command.id,
        name: command.name,
        description: command.description,
        // Keep the skill source tag (技能命令 → popup 来源标签), if any.
        ...("skillSource" in command && command.skillSource
          ? { skillSource: command.skillSource }
          : {}),
      }));
      this.context.postMessage(
        {
          command: "slashCommandsResponse",
          commands: commands,
        },
        viewType,
        windowId,
      );
    } catch (error) {
      console.error(`获取 ${viewType} 指令失败:`, error);
      this.context.postMessage(
        {
          command: "slashCommandsError",
          error: "获取指令失败: " + error,
        },
        viewType,
        windowId,
      );
    }
  }

  /**
   * /plan command (spec plan-mode.md):
   * - Outside plan mode: switch to plan mode; with a description (and not the
   *   removed `/plan open`), immediately start the plan query.
   * - Inside plan mode: fetch the current plan file via the stdio getPlanFile
   *   RPC and open it in the plan-preview panel (claudePlanPreview equivalent).
   */
  private async handlePlanCommand(
    args?: string,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    const agent = session.agent;
    if (!agent) return;

    const description = args?.trim() ?? "";
    const wantsOpen = description.split(/\s+/)[0] === "open";
    try {
      if (agent.getPermissionMode() !== "plan") {
        await agent.setPermissionMode("plan");
        if (description && !wantsOpen) {
          await agent.sendMessage(description);
          return;
        }
        // Bare /plan outside plan mode: mode switched; the plan-preview panel
        // opens on its own once ExitPlanMode delivers content.
        return;
      }

      // Already in plan mode — display the current plan file contents.
      const planFile = await agent.getPlanFile();
      if (planFile?.content) {
        this.context.openPlanPreview(
          `plan_${viewType || "tab"}_${windowId || "sidebar"}`,
          planFile.content,
        );
      }
    } catch (error) {
      console.error("执行 /plan 失败:", error);
      vscode.window.showErrorMessage("执行 /plan 失败: " + error);
    }
  }

  /**
   * AGENTS.md settings UI: fetch the user-level (~/.wave/AGENTS.md) or
   * project-level (<workdir>/AGENTS.md) memory file content via the stdio
   * getAgentsContent RPC.
   */
  private async handleGetAgentsContent(
    scope: "user" | "project",
    workdir: string | undefined,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    try {
      const result = (await this.utilityClient.request("getAgentsContent", {
        scope,
        workdir,
      })) as { content: string; path?: string };
      this.context.postMessage(
        {
          command: "agentsContentResponse",
          scope,
          content: result.content,
        },
        viewType,
        windowId,
      );
    } catch (error) {
      console.error("获取 AGENTS.md 内容失败:", error);
      this.context.postMessage(
        {
          command: "agentsContentResponse",
          scope,
          content: "",
        },
        viewType,
        windowId,
      );
    }
  }

  /** AGENTS.md settings UI: persist content via the stdio setAgentsContent RPC. */
  private async handleSetAgentsContent(
    scope: "user" | "project",
    content: string,
    workdir: string | undefined,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    try {
      await this.utilityClient.request("setAgentsContent", {
        scope,
        content,
        workdir,
      });
      // AGENTS.md 保存结果经宿主原生通知提示（spec「设置页反馈语义」）
      vscode.window.showInformationMessage("保存成功");
      this.context.postMessage(
        {
          command: "agentsContentSaved",
          scope,
          ok: true,
        },
        viewType,
        windowId,
      );
    } catch (error) {
      console.error("保存 AGENTS.md 失败:", error);
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`保存失败：${message}`);
      this.context.postMessage(
        {
          command: "agentsContentSaved",
          scope,
          ok: false,
          error: String(error),
        },
        viewType,
        windowId,
      );
    }
  }

  private async handleGetAuthStatus(
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    try {
      const result = (await this.utilityClient.request("getAuthStatus")) as {
        isAuthenticated: boolean;
        user: { id: string; email?: string } | undefined;
        serverUrl: string;
      };
      this.context.postMessage(
        {
          command: "authStatusResponse",
          isAuthenticated: result.isAuthenticated,
          user: result.user,
          serverUrl: result.serverUrl,
        },
        viewType,
        windowId,
      );
      this.context.postMessage(
        {
          command: "configurationResponse",
          configurationData: await this.configService.loadConfiguration(),
        },
        viewType,
        windowId,
      );
    } catch (error) {
      console.error("获取认证状态失败:", error);
      this.context.postMessage(
        {
          command: "authStatusResponse",
          isAuthenticated: false,
          user: null,
        },
        viewType,
        windowId,
      );
    }
  }

  private async handleLogin(
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    try {
      // authUrl notification is handled by ChatProvider (opens browser via vscode.env.openExternal)
      const result = (await this.utilityClient.request("login")) as {
        user: { id: string; email?: string } | undefined;
      };

      this.context.postMessage(
        {
          command: "loginResponse",
          success: true,
          user: result.user,
        },
        viewType,
        windowId,
      );

      // After successful login, reinitialize all sessions to pick up SSO config
      this.context.updateAllSessionsConfig();
    } catch (error) {
      console.error("登录失败:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.context.postMessage(
        {
          command: "loginResponse",
          success: false,
          error: errorMessage,
        },
        viewType,
        windowId,
      );
    }
  }

  private async handleLogout(
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    try {
      await this.utilityClient.request("logout");

      this.context.postMessage(
        {
          command: "logoutResponse",
          success: true,
        },
        viewType,
        windowId,
      );

      // After logout, reinitialize all sessions to revert to direct LLM mode
      this.context.updateAllSessionsConfig();
    } catch (error) {
      console.error("登出失败:", error);
      this.context.postMessage(
        {
          command: "logoutResponse",
          success: false,
          error: String(error),
        },
        viewType,
        windowId,
      );
    }
  }

  private async handleGetStatus(
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    const config = await this.configService.loadConfiguration();
    const version = this.context.getVersion();

    this.context.postMessage(
      {
        command: "statusResponse",
        version,
        sessionId: session.sessionId || "",
        // Session root (initialize-time cwd), not the subdir the agent
        // bash-cd'd into — matches where @file search is anchored.
        workdir:
          session.agent?.sessionCwd || session.agent?.workingDirectory || "",
        configurationData: config,
      },
      viewType,
      windowId,
    );
  }

  private async handleGetMcpServers(
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    const servers = await session.getMcpServers();
    this.context.postMessage(
      {
        command: "mcpServersResponse",
        servers,
      },
      viewType,
      windowId,
    );
  }

  private async handleGetMcpConfigPaths(
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    this.context.postMessage(
      {
        command: "mcpConfigPathsResponse",
        userPath: await session.getUserMcpConfigPath(),
        projectPath: await session.getProjectMcpConfigPath(),
      },
      viewType,
      windowId,
    );
  }

  private async handleRemoveMcpServer(
    scope: "user" | "project",
    serverName: string,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    try {
      const success = await session.removeMcpServer(scope, serverName);
      if (success) {
        vscode.window.showInformationMessage(
          `已移除 MCP 服务器「${serverName}」`,
        );
      } else {
        // agent 缺失时 ChatSession 静默返回 false（spec「设置页反馈语义」）
        vscode.window.showErrorMessage(
          `移除 MCP 服务器失败: 未找到服务器「${serverName}」或智能体未初始化`,
        );
      }
    } catch (error) {
      console.error("移除 MCP 服务器失败:", error);
      vscode.window.showErrorMessage("移除 MCP 服务器失败: " + error);
    }
  }

  private async handleDeleteSkill(
    name: string,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    try {
      const success = await session.deleteSkill(name);
      if (success) {
        vscode.window.showInformationMessage(`已删除技能「${name}」`);
      } else {
        vscode.window.showErrorMessage(
          `删除技能失败: 未找到技能「${name}」或智能体未初始化`,
        );
      }
    } catch (error) {
      console.error("删除技能失败:", error);
      vscode.window.showErrorMessage("删除技能失败: " + error);
    }
  }

  private async handleDeleteSubagent(
    name: string,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    try {
      const success = await session.deleteSubagent(name);
      if (success) {
        vscode.window.showInformationMessage(`已删除子代理「${name}」`);
      } else {
        vscode.window.showErrorMessage(
          `删除子代理失败: 未找到子代理「${name}」或智能体未初始化`,
        );
      }
    } catch (error) {
      console.error("删除子代理失败:", error);
      vscode.window.showErrorMessage("删除子代理失败: " + error);
    }
  }

  private async handleGetHooksByScope(
    scope: "user" | "project" | "plugin",
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    const { hooks, configPath } = await session.getHooksByScope(scope);
    this.context.postMessage(
      {
        command: "hooksResponse",
        // 归属键：请求 scope 恒回带（webview 切 Tab 过期即弃）
        scope,
        hooks,
        // 钩子所在 settings.json 的绝对路径（GUI「编辑」打开文件用）
        configPath,
      },
      viewType,
      windowId,
    );
  }

  private async handleDeleteHook(
    scope: "user" | "project",
    hookName: string,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    // ChatSession.deleteHook 在无 agent 时静默返回（spec「设置页反馈语义」要求
    // 写操作需要 live agent，缺少 agent 必须显式失败提示）
    if (!session.agent) {
      vscode.window.showErrorMessage("删除钩子失败: 智能体未初始化");
      return;
    }
    try {
      await session.deleteHook(scope, hookName);
      vscode.window.showInformationMessage(`已删除钩子「${hookName}」`);
      const { hooks, configPath } = await session.getHooksByScope(scope);
      this.context.postMessage(
        {
          command: "hooksResponse",
          // 归属键：请求 scope 恒回带（同 handleGetHooksByScope）
          scope,
          hooks,
          configPath,
        },
        viewType,
        windowId,
      );
    } catch (error) {
      console.error("删除钩子失败:", error);
      vscode.window.showErrorMessage("删除钩子失败: " + error);
    }
  }

  private async handleGetSubagentConfigurations(
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    const configurations = await session.getSubagentConfigurations();
    this.context.postMessage(
      {
        command: "subagentConfigurationsResponse",
        configurations,
      },
      viewType,
      windowId,
    );
  }

  private async handleGetSkillMetadata(
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    const skills = await session.getSkillMetadata();
    this.context.postMessage(
      {
        command: "skillMetadataResponse",
        skills,
      },
      viewType,
      windowId,
    );
  }

  private async handleConnectMcpServer(
    serverName: string,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    try {
      const success = await session.connectMcpServer(serverName);
      // SDK's onMcpServersChange callback will push the updated state to frontend
      if (success) {
        vscode.window.showInformationMessage(
          `MCP 服务器 "${serverName}" 连接请求已发送`,
        );
      }
    } catch (error) {
      console.error("连接 MCP 服务器失败:", error);
      vscode.window.showErrorMessage("连接 MCP 服务器失败: " + error);
    }
  }

  private async handleDisconnectMcpServer(
    serverName: string,
    viewType?: "sidebar" | "tab" | "window",
    windowId?: string,
  ) {
    const session = this.context.getChatSession(viewType || "tab", windowId);
    try {
      const success = await session.disconnectMcpServer(serverName);
      // Refresh the list regardless of the return value: the SDK's
      // onMcpServersChange push may not fire on every path (early return /
      // teardown error), and without it the webview「断开中…」spinner never
      // settles. Mirrors the removeMcpServer handler below.
      const servers = await session.getMcpServers();
      this.context.postMessage(
        { command: "mcpServersResponse", servers },
        viewType,
        windowId,
      );
      if (success) {
        vscode.window.showInformationMessage(
          `MCP 服务器 "${serverName}" 已断开`,
        );
      }
    } catch (error) {
      console.error("断开 MCP 服务器失败:", error);
      vscode.window.showErrorMessage("断开 MCP 服务器失败: " + error);
    }
  }
}

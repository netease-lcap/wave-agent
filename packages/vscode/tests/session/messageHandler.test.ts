import { describe, test, expect, vi, beforeEach } from "vitest";
import { fixtures, type HostToWebviewMessage } from "wave-webview-fixtures";

// ── Mocks ──────────────────────────────────────────────────────

vi.mock("vscode", () => ({
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
  commands: {
    executeCommand: vi.fn(),
  },
}));

import * as vscode from "vscode";
import {
  MessageHandler,
  type MessageHandlerContext,
} from "../../src/session/messageHandler";
import type { ChatSession } from "../../src/session/chatSession";
import type { McpServerStatus } from "wave-agent-sdk";
import type { ConfigurationService } from "../../src/services/configurationService";
import type { FileService } from "../../src/services/fileService";
import type { SessionService } from "../../src/services/sessionService";
import type { PluginService } from "../../src/services/pluginService";
import type { StdioClient } from "../../src/stdio/stdioClient";

// ── Helpers ────────────────────────────────────────────────────

function createMockSession(): ChatSession {
  return {
    getMcpServers: vi.fn(),
    connectMcpServer: vi.fn(),
    disconnectMcpServer: vi.fn(),
    compact: vi.fn(),
    clearChat: vi.fn(),
    restoreSession: vi.fn(),
    getSlashCommands: vi.fn().mockResolvedValue([]),
    getMessages: vi.fn().mockResolvedValue([]),
    askBtw: vi.fn(),
    backgroundTasks: [],
  } as unknown as ChatSession;
}

function createHandler(session: ChatSession) {
  const context: MessageHandlerContext = {
    getChatSession: vi.fn().mockReturnValue(session),
    postMessage: vi.fn(),
    initializeAgent: vi.fn(),
    listSessions: vi.fn(),
    updateAllSessionsConfig: vi.fn(),
    getVersion: vi.fn().mockReturnValue("1.2.3"),
    openPlanPreview: vi.fn(),
    openSettings: vi.fn(),
    postSettingsMessage: vi.fn(),
    closeSettings: vi.fn(),
  };
  const handler = new MessageHandler(
    {} as unknown as ConfigurationService,
    {} as unknown as FileService,
    {} as unknown as SessionService,
    {} as unknown as PluginService,
    {} as unknown as StdioClient,
    context,
  );
  return { handler, context };
}

function createReadySession(): ChatSession {
  return {
    agent: {
      getPermissionMode: vi.fn(() => "default"),
      setPermissionMode: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => undefined),
      getPlanFile: vi.fn(async () => ({
        path: "/tmp/plan.md",
        content: "# 当前方案",
      })),
      workingDirectory: "/tmp",
      latestTotalTokens: 0,
    },
    pendingConfirmations: new Map(),
    messages: [],
    tasks: [],
    backgroundTasks: [],
    workflowRuns: [],
    messageQueue: [],
    sessionId: undefined,
    inputContent: "",
    isStreaming: false,
    isCommandRunning: false,
    getMessages: vi.fn().mockResolvedValue([]),
  } as unknown as ChatSession;
}

// Typed against the shared host→webview contract: an unknown command string
// or a field access outside the command's payload is a compile error, so a
// contract rename breaks this suite the same way it breaks the webview one.
function sentPosts(context: { postMessage: unknown }) {
  const calls = (context.postMessage as ReturnType<typeof vi.fn>).mock.calls;
  return <C extends HostToWebviewMessage["command"]>(command: C) =>
    calls
      .map((call) => call[0] as { command?: string })
      .filter((msg) => msg.command === command) as unknown as Extract<
      HostToWebviewMessage,
      { command: C }
    >[];
}

function createReadyHandler(session: ChatSession) {
  const configService = {
    loadConfiguration: vi.fn().mockResolvedValue({ language: "Chinese" }),
    saveConfiguration: vi.fn(),
  };
  const sessionService = {
    getSessionsList: vi.fn().mockResolvedValue([]),
  };
  const utilityClient = {
    request: vi.fn().mockResolvedValue({
      isAuthenticated: true,
      serverUrl: "https://console.example.com",
    }),
  };
  const context: MessageHandlerContext = {
    getChatSession: vi.fn().mockReturnValue(session),
    postMessage: vi.fn(),
    initializeAgent: vi.fn(),
    listSessions: vi.fn(),
    updateAllSessionsConfig: vi.fn(),
    getVersion: vi.fn().mockReturnValue("1.2.3"),
    openPlanPreview: vi.fn(),
    openSettings: vi.fn(),
    postSettingsMessage: vi.fn(),
    closeSettings: vi.fn(),
  } as unknown as MessageHandlerContext;
  const handler = new MessageHandler(
    configService as unknown as ConfigurationService,
    {} as unknown as FileService,
    sessionService as unknown as SessionService,
    {} as unknown as PluginService,
    utilityClient as unknown as StdioClient,
    context,
  );
  return { handler, context, configService, sessionService, utilityClient };
}

// ── Tests ──────────────────────────────────────────────────────

describe("MessageHandler MCP handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Regression for missing `await` on session.getMcpServers().
  // If await is removed, `servers` sent to postMessage is a Promise,
  // which would fail Array.isArray and .map downstream.
  test("getMcpServers posts resolved array (regression for missing await)", async () => {
    const servers = [
      { name: "s1", status: "connected", toolCount: 3 },
    ] as unknown as McpServerStatus[];
    const session = createMockSession();
    (session.getMcpServers as ReturnType<typeof vi.fn>).mockResolvedValue(
      servers,
    );

    const { handler, context } = createHandler(session);
    await handler.handleMessage({ command: "getMcpServers" }, "tab");

    expect(context.getChatSession).toHaveBeenCalledWith("tab", undefined);
    expect(context.postMessage).toHaveBeenCalledTimes(1);
    const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { command: string; servers: unknown };
    expect(posted.command).toBe("mcpServersResponse");
    expect(Array.isArray(posted.servers)).toBe(true);
    expect(posted.servers).toEqual(servers);
  });

  test("getMcpServers posts empty array when no servers", async () => {
    const session = createMockSession();
    (session.getMcpServers as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { handler, context } = createHandler(session);
    await handler.handleMessage({ command: "getMcpServers" }, "tab");

    const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { command: string; servers: unknown };
    expect(posted.command).toBe("mcpServersResponse");
    expect(Array.isArray(posted.servers)).toBe(true);
    expect(posted.servers).toEqual([]);
  });

  test("connectMcpServer shows info message on success", async () => {
    const session = createMockSession();
    (session.connectMcpServer as ReturnType<typeof vi.fn>).mockResolvedValue(
      true,
    );

    const { handler } = createHandler(session);
    await handler.handleMessage(
      { command: "connectMcpServer", serverName: "my-server" },
      "tab",
    );

    expect(session.connectMcpServer).toHaveBeenCalledWith("my-server");
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  test("connectMcpServer shows error message on failure", async () => {
    const session = createMockSession();
    (session.connectMcpServer as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("boom"),
    );

    const { handler } = createHandler(session);
    await handler.handleMessage(
      { command: "connectMcpServer", serverName: "bad-server" },
      "tab",
    );

    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  test("disconnectMcpServer shows info message on success", async () => {
    const session = createMockSession();
    (session.disconnectMcpServer as ReturnType<typeof vi.fn>).mockResolvedValue(
      true,
    );

    const { handler } = createHandler(session);
    await handler.handleMessage(
      { command: "disconnectMcpServer", serverName: "my-server" },
      "tab",
    );

    expect(session.disconnectMcpServer).toHaveBeenCalledWith("my-server");
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  test("disconnectMcpServer shows error message on failure", async () => {
    const session = createMockSession();
    (session.disconnectMcpServer as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("boom"),
    );

    const { handler } = createHandler(session);
    await handler.handleMessage(
      { command: "disconnectMcpServer", serverName: "bad-server" },
      "tab",
    );

    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  // Regression: serverUrl 必须随 authStatusResponse 下发（配置回包不再承载它）——
  // 空值会让 webview 的「企业控制台 / 帮助文档」按钮静默失效。
  test("webviewReady pushes the fresh serverUrl from getAuthStatus", async () => {
    const session = createReadySession();
    const { handler, context, configService, utilityClient } =
      createReadyHandler(session);

    await handler.handleMessage({ command: "webviewReady" }, "tab");

    expect(utilityClient.request).toHaveBeenCalledWith("getAuthStatus");
    // 服务地址不再落宿主本地配置（只转发给 webview）。
    expect(configService.saveConfiguration).not.toHaveBeenCalled();

    const authPosts = sentPosts(context)("authStatusResponse");
    expect(authPosts.length).toBeGreaterThanOrEqual(1);
    const auth = authPosts[authPosts.length - 1];
    expect(auth.serverUrl).toBe("https://console.example.com");
    expect(auth.isAuthenticated).toBe(true);

    const states = sentPosts(context)("setInitialState");
    expect(states.length).toBeGreaterThanOrEqual(1);
    const posted = states[states.length - 1];

    expect(posted).toBeDefined();
    expect(posted.configurationData).toBeDefined();
    // 配置回包只剩用户偏好：模型 / 服务地址都不再走它。
    expect(posted.configurationData).not.toHaveProperty("serverUrl");
    expect(posted.configurationData).not.toHaveProperty("model");
    expect(posted.configurationData).not.toHaveProperty("fastModel");
    expect(posted.isAuthenticated).toBe(true);

    // Contract gates mirroring the shared fixture defaults: if the host
    // stops sending a field or the fixture default changes, both layers go
    // red together instead of one passing on mock-defined expectations.
    const anchors = fixtures.setInitialState();
    expect(posted.inputContent).toBe(anchors.inputContent);
    expect(posted.messages).toEqual(anchors.messages);
    expect(posted.tasks).toEqual(anchors.tasks);
    expect(posted.backgroundTasks).toEqual(anchors.backgroundTasks);
    expect(posted.workflowRuns).toEqual(anchors.workflowRuns);
    expect(posted.queuedMessages).toEqual(anchors.queuedMessages);
    expect(posted.pendingConfirmations).toEqual(anchors.pendingConfirmations);
    expect(posted.sessions).toEqual(anchors.sessions);
    // IDE hosts never send pane-scoped messages — only desktop does.
    expect(posted.paneId).toBeUndefined();
  });

  // A re-created webview (window reload; the webview view itself has no
  // retainContextWhenHidden) re-runs webviewReady long after the session's
  // last token change, so no contextUsage notification is on its way. The
  // host replays the percentage the agent cached on the getMessages pull the
  // ready handler just made, otherwise the ring stays empty until a new turn.
  test("webviewReady replays the session's context-usage percentage", async () => {
    const session = createReadySession();
    (session.agent as { contextUsagePercent?: number }).contextUsagePercent =
      25;
    const { handler, context } = createReadyHandler(session);

    await handler.handleMessage({ command: "webviewReady" }, "tab");

    const posts = (context.postMessage as ReturnType<typeof vi.fn>).mock.calls;
    const commands = posts.map(
      (call) => (call[0] as { command: string }).command,
    );
    const usageIndex = commands.indexOf("contextUsage");
    expect(usageIndex).toBeGreaterThan(-1);
    // Must follow setInitialState: the webview drops a stale ring on every
    // session switch, so the replay has to be attributed to the incoming one.
    expect(usageIndex).toBeGreaterThan(commands.indexOf("setInitialState"));
    expect(posts[usageIndex][0]).toMatchObject({
      command: "contextUsage",
      percent: 25,
    });
  });

  test("webviewReady does not replay a context-usage percentage the session has not reported", async () => {
    const session = createReadySession();
    const { handler, context } = createReadyHandler(session);

    await handler.handleMessage({ command: "webviewReady" }, "tab");

    expect(sentPosts(context)("contextUsage")).toHaveLength(0);
  });

  // Regression: /status showed empty version in VSCE because handleGetStatus
  // looked up the extension by a wrong, hardcoded id ('wave-code.wave-vsce-chat')
  // instead of the real id ('wave-code.wave-vsce'), so getExtension() returned
  // undefined. Version is now sourced from context.getVersion() (backed by the
  // extension's own packageJSON), consistent with chatProvider/updateService.
  test("getStatus posts version from context.getVersion", async () => {
    const session = createReadySession();
    const { handler, context } = createReadyHandler(session);

    await handler.handleMessage({ command: "getStatus" }, "tab");

    expect(context.getVersion).toHaveBeenCalled();
    const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { command: string; version: string };
    expect(posted.command).toBe("statusResponse");
    expect(posted.version).toBe("1.2.3");
  });

  // Regression: agent `cd` broadcasts workdirChange which drifts
  // workingDirectory; the /status popup must keep showing the session root
  // (initialize-time cwd), matching where @file search is anchored.
  test("getStatus reports the session root workdir, not the agent cd drift", async () => {
    const session = createReadySession();
    const agent = session.agent as {
      sessionCwd?: string;
      workingDirectory?: string;
    };
    agent.sessionCwd = "/tmp";
    agent.workingDirectory = "/tmp/src";
    const { handler, context } = createReadyHandler(session);

    await handler.handleMessage({ command: "getStatus" }, "tab");

    const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { command: string; workdir: string };
    expect(posted.command).toBe("statusResponse");
    expect(posted.workdir).toBe("/tmp");
  });

  // /compact command: mirrors /clear — the webview posts { command: 'compact', customInstructions }
  // and the handler delegates to session.compact(customInstructions).
  // Regression (9cea65ea): the onMessagesChange full-snapshot push was removed;
  // restoring a history session must deliver the pulled list to the webview via
  // updateMessages, otherwise state.messages stays empty and the webview keeps
  // showing the welcome page after selecting a session in the sidebar.
  test("restoreSession posts updateMessages with the restored messages", async () => {
    const restoredMessages = [{ id: "m1", role: "user", content: "hello" }];
    const session = createMockSession();
    (session.restoreSession as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );
    session.messages = restoredMessages as unknown as ChatSession["messages"];

    const { handler, context } = createHandler(session);
    await handler.handleMessage(
      { command: "restoreSession", sessionId: "sess-1" },
      "tab",
    );

    expect(session.restoreSession).toHaveBeenCalledWith("sess-1");
    const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { command: string; messages: unknown };
    expect(posted.command).toBe("updateMessages");
    expect(posted.messages).toEqual(restoredMessages);
  });

  // Same regression class: /clear pulls the (now empty) list into the cache
  // but never pushes it, so the webview would keep showing the old messages.
  test("clearChat posts updateMessages with the cleared message list", async () => {
    const session = createMockSession();
    (session.clearChat as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );
    session.messages = [];

    const { handler, context } = createHandler(session);
    await handler.handleMessage({ command: "clearChat" }, "tab");

    expect(session.clearChat).toHaveBeenCalled();
    const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { command: string; messages: unknown };
    expect(posted.command).toBe("updateMessages");
    expect(posted.messages).toEqual([]);
  });

  // spec session-management.md「IDE 插件聊天头部」场景 6/7: host 侧双防线 ——
  // webview 已禁用/忽略，此守卫覆盖「通知在途」竞态窗口与其它调用方。
  test("clearChat is ignored while a background task is running", async () => {
    const session = createMockSession();
    session.backgroundTasks = [
      {
        id: "bg-1",
        type: "shell",
        status: "running",
        startTime: 1000,
        command: "sleep 300",
      },
    ];

    const { handler } = createHandler(session);
    await handler.handleMessage({ command: "clearChat" }, "tab");

    expect(session.clearChat).not.toHaveBeenCalled();
  });

  test("restoreSession is ignored while a background task is running", async () => {
    const session = createMockSession();
    session.backgroundTasks = [
      {
        id: "bg-2",
        type: "subagent",
        status: "running",
        startTime: 1000,
        description: "background subagent",
      },
    ];

    const { handler } = createHandler(session);
    await handler.handleMessage(
      { command: "restoreSession", sessionId: "sess-1" },
      "tab",
    );

    expect(session.restoreSession).not.toHaveBeenCalled();
  });

  test("compact command calls session.compact with customInstructions", async () => {
    const session = createMockSession();
    (session.compact as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const { handler } = createHandler(session);
    await handler.handleMessage(
      { command: "compact", customInstructions: "focus on API" },
      "tab",
    );

    expect(session.compact).toHaveBeenCalledWith("focus on API");
  });

  test("compact command calls session.compact with undefined when no instructions", async () => {
    const session = createMockSession();
    (session.compact as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const { handler } = createHandler(session);
    await handler.handleMessage({ command: "compact" }, "tab");

    expect(session.compact).toHaveBeenCalledWith(undefined);
  });

  test("slashCommandsRequest includes compact in localCommands", async () => {
    const session = createMockSession();

    const { handler, context } = createHandler(session);
    await handler.handleMessage(
      { command: "requestSlashCommands", filterText: "" },
      "tab",
    );

    const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as {
      command: string;
      commands: Array<{ id: string; name: string; description: string }>;
    };
    expect(posted.command).toBe("slashCommandsResponse");
    const compact = posted.commands.find((c) => c.id === "compact");
    expect(compact).toBeDefined();
    expect(compact?.name).toBe("compact");
  });

  // /btw command: webview posts { command: 'askBtw', question } and the handler
  // delegates to session.askBtw, echoing the question back so the webview can
  // match the reply against its in-flight panel (dropping stale replies).
  test("askBtw posts btwResponse with answer and echoed question", async () => {
    const session = createMockSession();
    (session.askBtw as ReturnType<typeof vi.fn>).mockResolvedValue(
      "**Sunny** weather",
    );

    const { handler, context } = createHandler(session);
    await handler.handleMessage(
      { command: "askBtw", question: "weather?" },
      "tab",
    );

    expect(session.askBtw).toHaveBeenCalledWith("weather?");
    const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as {
      command: string;
      question: string;
      answer: string;
    };
    expect(posted.command).toBe("btwResponse");
    expect(posted.question).toBe("weather?");
    expect(posted.answer).toBe("**Sunny** weather");
  });

  test("askBtw posts btwError when session.askBtw rejects", async () => {
    const session = createMockSession();
    (session.askBtw as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("agent not initialized"),
    );

    const { handler, context } = createHandler(session);
    await handler.handleMessage(
      { command: "askBtw", question: "weather?" },
      "tab",
    );

    const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as {
      command: string;
      question: string;
      error: string;
    };
    expect(posted.command).toBe("btwError");
    expect(posted.question).toBe("weather?");
    expect(posted.error).toContain("agent not initialized");
  });

  test("slashCommandsRequest includes btw in localCommands", async () => {
    const session = createMockSession();

    const { handler, context } = createHandler(session);
    await handler.handleMessage(
      { command: "requestSlashCommands", filterText: "" },
      "tab",
    );

    const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as {
      command: string;
      commands: Array<{ id: string; name: string; description: string }>;
    };
    expect(posted.command).toBe("slashCommandsResponse");
    const btw = posted.commands.find((c) => c.id === "btw");
    expect(btw).toBeDefined();
    expect(btw?.name).toBe("btw");
    expect(btw?.description).toContain("旁路");
  });

  test("slashCommandsRequest keeps skillSource on skill commands only", async () => {
    const session = createMockSession();
    (session.getSlashCommands as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "code-review",
        name: "code-review",
        description: "Code review skill",
        skillSource: "project",
      },
    ]);

    const { handler, context } = createHandler(session);
    await handler.handleMessage(
      { command: "requestSlashCommands", filterText: "" },
      "tab",
    );

    const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as {
      command: string;
      commands: Array<{
        id: string;
        name: string;
        description: string;
        skillSource?: "builtin" | "user" | "project" | "plugin";
      }>;
    };
    expect(posted.command).toBe("slashCommandsResponse");
    const skill = posted.commands.find((c) => c.id === "code-review");
    expect(skill?.skillSource).toBe("project");
    // Local/system commands never carry a source tag.
    const config = posted.commands.find((c) => c.id === "config");
    expect(config?.skillSource).toBeUndefined();
  });

  // Toggling a project-level builtin plugin (e.g. sdd@builtin) must recreate
  // agents — same as handleEnablePlugin — so the change takes effect, not just
  // refresh the projectSettings panel.
  test("setBuiltinPluginEnabled reloads config and recreates agents on success", async () => {
    const configService = {
      loadConfiguration: vi.fn(),
      saveConfiguration: vi.fn(),
    };
    const pluginService = {
      setBuiltinPluginEnabled: vi
        .fn()
        .mockResolvedValue({ enabledPlugins: { "sdd@builtin": true } }),
      getWorkdir: vi.fn().mockReturnValue("/ws/root"),
    };
    const context: MessageHandlerContext = {
      getChatSession: vi.fn().mockReturnValue(createMockSession()),
      postMessage: vi.fn(),
      initializeAgent: vi.fn(),
      listSessions: vi.fn(),
      updateAllSessionsConfig: vi.fn(),
      getVersion: vi.fn().mockReturnValue("1.2.3"),
      openPlanPreview: vi.fn(),
      openSettings: vi.fn(),
      postSettingsMessage: vi.fn(),
      closeSettings: vi.fn(),
    };
    const handler = new MessageHandler(
      configService as unknown as ConfigurationService,
      {} as unknown as FileService,
      {} as unknown as SessionService,
      pluginService as unknown as PluginService,
      {} as unknown as StdioClient,
      context,
    );

    await handler.handleMessage(
      {
        command: "setBuiltinPluginEnabled",
        pluginId: "sdd@builtin",
        enabled: true,
        scope: "project",
      },
      "tab",
    );

    expect(pluginService.setBuiltinPluginEnabled).toHaveBeenCalledWith(
      "sdd@builtin",
      true,
      "project",
    );
    // 重建 agent 不再需要配置（模型/服务地址都不走设置页配置）。
    expect(configService.loadConfiguration).not.toHaveBeenCalled();
    expect(context.updateAllSessionsConfig).toHaveBeenCalledWith();

    const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as {
      command: string;
      enabledPlugins: Record<string, boolean>;
      workdir?: string;
    };
    expect(posted.command).toBe("projectSettings");
    expect(posted.enabledPlugins).toEqual({ "sdd@builtin": true });
    // 归属键：请求所用 workdir 恒回带（webview 过期即弃依据）
    expect(posted.workdir).toBe("/ws/root");
  });
});

// ── /plan command ───────────────────────────────────────────────

describe("MessageHandler /plan command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("/plan outside plan mode switches to plan mode without sending a message", async () => {
    const session = createReadySession();
    const agent = session.agent as unknown as {
      getPermissionMode: ReturnType<typeof vi.fn>;
      setPermissionMode: ReturnType<typeof vi.fn>;
      sendMessage: ReturnType<typeof vi.fn>;
      getPlanFile: ReturnType<typeof vi.fn>;
    };
    agent.getPermissionMode.mockReturnValue("default");

    const { handler, context } = createReadyHandler(session);
    await handler.handleMessage({ command: "planCommand" }, "tab");

    expect(agent.setPermissionMode).toHaveBeenCalledWith("plan");
    expect(agent.sendMessage).not.toHaveBeenCalled();
    expect(context.openPlanPreview).not.toHaveBeenCalled();
  });

  test("/plan with a description outside plan mode starts the plan query", async () => {
    const session = createReadySession();
    const agent = session.agent as unknown as {
      getPermissionMode: ReturnType<typeof vi.fn>;
      setPermissionMode: ReturnType<typeof vi.fn>;
      sendMessage: ReturnType<typeof vi.fn>;
      getPlanFile: ReturnType<typeof vi.fn>;
    };
    agent.getPermissionMode.mockReturnValue("default");

    const { handler } = createReadyHandler(session);
    await handler.handleMessage(
      { command: "planCommand", args: "Add user auth" },
      "tab",
    );

    expect(agent.setPermissionMode).toHaveBeenCalledWith("plan");
    expect(agent.sendMessage).toHaveBeenCalledWith("Add user auth");
  });

  test("/plan open is treated as a bare /plan (no external editor)", async () => {
    const session = createReadySession();
    const agent = session.agent as unknown as {
      getPermissionMode: ReturnType<typeof vi.fn>;
      setPermissionMode: ReturnType<typeof vi.fn>;
      sendMessage: ReturnType<typeof vi.fn>;
    };
    agent.getPermissionMode.mockReturnValue("default");

    const { handler, context } = createReadyHandler(session);
    await handler.handleMessage(
      { command: "planCommand", args: "open" },
      "tab",
    );

    expect(agent.setPermissionMode).toHaveBeenCalledWith("plan");
    expect(agent.sendMessage).not.toHaveBeenCalled();
    expect(context.openPlanPreview).not.toHaveBeenCalled();
  });

  test("/plan inside plan mode opens the plan-preview panel with the plan file", async () => {
    const session = createReadySession();
    const agent = session.agent as unknown as {
      getPermissionMode: ReturnType<typeof vi.fn>;
      getPlanFile: ReturnType<typeof vi.fn>;
      setPermissionMode: ReturnType<typeof vi.fn>;
    };
    agent.getPermissionMode.mockReturnValue("plan");
    agent.getPlanFile.mockResolvedValue({
      path: "/tmp/plan.md",
      content: "# 当前方案",
    });

    const { handler, context } = createReadyHandler(session);
    await handler.handleMessage({ command: "planCommand" }, "tab");

    expect(agent.setPermissionMode).not.toHaveBeenCalled();
    expect(agent.getPlanFile).toHaveBeenCalled();
    expect(context.openPlanPreview).toHaveBeenCalledWith(
      "plan_tab_sidebar",
      "# 当前方案",
    );
  });

  test("/plan with no plan file does not open the preview panel", async () => {
    const session = createReadySession();
    const agent = session.agent as unknown as {
      getPermissionMode: ReturnType<typeof vi.fn>;
      getPlanFile: ReturnType<typeof vi.fn>;
    };
    agent.getPermissionMode.mockReturnValue("plan");
    agent.getPlanFile.mockResolvedValue({ path: null, content: null });

    const { handler, context } = createReadyHandler(session);
    await handler.handleMessage({ command: "planCommand" }, "tab");

    expect(agent.getPlanFile).toHaveBeenCalled();
    expect(context.openPlanPreview).not.toHaveBeenCalled();
  });
});

// ── Editor-area settings tab ────────────────────────────────────

describe("MessageHandler settings tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("openSettings from the chat webview opens the editor-area settings tab", async () => {
    const session = createReadySession();
    const { handler, context } = createReadyHandler(session);

    await handler.handleMessage({ command: "openSettings" }, "tab");

    expect(context.openSettings).toHaveBeenCalled();
  });

  test("openSettings forwards the nav payload so /mcp etc. preselect their settings tab", async () => {
    const session = createReadySession();
    const { handler, context } = createReadyHandler(session);

    await handler.handleMessage(
      { command: "openSettings", nav: "mcp" },
      "sidebar",
    );

    expect(context.openSettings).toHaveBeenCalledWith("mcp");
  });

  test("getConfiguration posts configurationResponse to the settings panel, not the chat webviews", async () => {
    const session = createReadySession();
    const { handler, context } = createReadyHandler(session);

    await handler.handleSettingsMessage({ command: "getConfiguration" });

    const posted = (context.postSettingsMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as { command: string; configurationData: unknown };
    expect(posted.command).toBe("configurationResponse");
    expect(posted.configurationData).toEqual({ language: "Chinese" });
    expect(context.postMessage).not.toHaveBeenCalled();
  });

  test("updateConfiguration saves user preferences and replies without recreating agents", async () => {
    const session = createReadySession();
    const { handler, context, configService } = createReadyHandler(session);

    await handler.handleSettingsMessage({
      command: "updateConfiguration",
      configurationData: { language: "en-US" },
    });

    expect(configService.saveConfiguration).toHaveBeenCalledWith({
      language: "en-US",
    });
    // 用户偏好落用户级 ~/.wave/settings.json，由 SDK 实时重载在下一轮对话生效：
    // 保存不重建会话（spec agent-config「配置变更的构造期副作用与重建」场景 1）。
    expect(context.updateAllSessionsConfig).not.toHaveBeenCalled();
    // 保存结果经宿主原生通知提示（spec「设置页反馈语义」）
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "保存成功",
    );
    const commands = (
      context.postSettingsMessage as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => (call[0] as { command: string }).command);
    expect(commands).toEqual(["configurationUpdated", "configurationResponse"]);
  });

  test("getAgentsContent forwards scope/workdir and replies to the settings panel", async () => {
    const session = createReadySession();
    const { handler, context, utilityClient } = createReadyHandler(session);
    utilityClient.request.mockResolvedValue({ content: "# rules" });

    await handler.handleSettingsMessage({
      command: "getAgentsContent",
      scope: "project",
      workdir: "/tmp",
    });

    expect(utilityClient.request).toHaveBeenCalledWith("getAgentsContent", {
      scope: "project",
      workdir: "/tmp",
    });
    const posted = (context.postSettingsMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as {
      command: string;
      scope: string;
      content: string;
    };
    expect(posted.command).toBe("agentsContentResponse");
    expect(posted.scope).toBe("project");
    expect(posted.content).toBe("# rules");
  });

  test("setAgentsContent replies agentsContentSaved ok:true", async () => {
    const session = createReadySession();
    const { handler, context, utilityClient } = createReadyHandler(session);

    await handler.handleSettingsMessage({
      command: "setAgentsContent",
      scope: "user",
      content: "# new rules",
    });

    expect(utilityClient.request).toHaveBeenCalledWith("setAgentsContent", {
      scope: "user",
      content: "# new rules",
      workdir: undefined,
    });
    // 保存结果经宿主原生通知提示（spec「设置页反馈语义」）
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "保存成功",
    );
    const posted = (context.postSettingsMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as { command: string; ok: boolean };
    expect(posted.command).toBe("agentsContentSaved");
    expect(posted.ok).toBe(true);
  });

  test("setAgentsContent replies agentsContentSaved ok:false on failure", async () => {
    const session = createReadySession();
    const { handler, context, utilityClient } = createReadyHandler(session);
    utilityClient.request.mockRejectedValue(new Error("boom"));

    await handler.handleSettingsMessage({
      command: "setAgentsContent",
      scope: "project",
      content: "# x",
      workdir: "/tmp",
    });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "保存失败：boom",
    );
    const posted = (context.postSettingsMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as { command: string; ok: boolean; error: string };
    expect(posted.command).toBe("agentsContentSaved");
    expect(posted.ok).toBe(false);
    expect(posted.error).toContain("boom");
  });

  // Regression (VS Code 插件端 SDD 开关永久置灰): 设置页在独立 settings tab
  // (settings-preview-entry) 里渲染，消息走 handleSettingsMessage —— 该路由若
  // 不实现 getProjectSettings，webview 的 projectSettings 恒为 undefined，
  // SettingsPage 的开关被 `disabled={... || !projectSettings}` 禁用且永不加载。
  test("getProjectSettings posts projectSettings to the settings panel", async () => {
    const configService = {
      loadConfiguration: vi.fn(),
      saveConfiguration: vi.fn(),
    };
    const pluginService = {
      getProjectSettings: vi
        .fn()
        .mockResolvedValue({ enabledPlugins: { "sdd@builtin": true } }),
      getWorkdir: vi.fn().mockReturnValue("/ws/root"),
    };
    const context: MessageHandlerContext = {
      getChatSession: vi.fn().mockReturnValue(createMockSession()),
      postMessage: vi.fn(),
      initializeAgent: vi.fn(),
      listSessions: vi.fn(),
      updateAllSessionsConfig: vi.fn(),
      getVersion: vi.fn().mockReturnValue("1.2.3"),
      openPlanPreview: vi.fn(),
      openSettings: vi.fn(),
      postSettingsMessage: vi.fn(),
      closeSettings: vi.fn(),
    };
    const handler = new MessageHandler(
      configService as unknown as ConfigurationService,
      {} as unknown as FileService,
      {} as unknown as SessionService,
      pluginService as unknown as PluginService,
      {} as unknown as StdioClient,
      context,
    );

    await handler.handleSettingsMessage({ command: "getProjectSettings" });

    expect(pluginService.getProjectSettings).toHaveBeenCalled();
    const posted = (context.postSettingsMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as {
      command: string;
      enabledPlugins: Record<string, boolean>;
      workdir?: string;
    };
    expect(posted.command).toBe("projectSettings");
    expect(posted.enabledPlugins).toEqual({ "sdd@builtin": true });
    // 归属键：请求所用 workdir 恒回带（webview 过期即弃依据）
    expect(posted.workdir).toBe("/ws/root");
    // Response goes to the settings panel, never the chat webviews
    expect(context.postMessage).not.toHaveBeenCalled();
  });

  test("setBuiltinPluginEnabled from the settings panel reloads config, recreates agents and replies to the settings panel", async () => {
    const configService = {
      loadConfiguration: vi.fn(),
      saveConfiguration: vi.fn(),
    };
    const pluginService = {
      setBuiltinPluginEnabled: vi
        .fn()
        .mockResolvedValue({ enabledPlugins: { "sdd@builtin": true } }),
      getWorkdir: vi.fn().mockReturnValue("/ws/root"),
    };
    const context: MessageHandlerContext = {
      getChatSession: vi.fn().mockReturnValue(createMockSession()),
      postMessage: vi.fn(),
      initializeAgent: vi.fn(),
      listSessions: vi.fn(),
      updateAllSessionsConfig: vi.fn(),
      getVersion: vi.fn().mockReturnValue("1.2.3"),
      openPlanPreview: vi.fn(),
      openSettings: vi.fn(),
      postSettingsMessage: vi.fn(),
      closeSettings: vi.fn(),
    };
    const handler = new MessageHandler(
      configService as unknown as ConfigurationService,
      {} as unknown as FileService,
      {} as unknown as SessionService,
      pluginService as unknown as PluginService,
      {} as unknown as StdioClient,
      context,
    );

    await handler.handleSettingsMessage({
      command: "setBuiltinPluginEnabled",
      pluginId: "sdd@builtin",
      enabled: true,
      scope: "project",
    });

    expect(pluginService.setBuiltinPluginEnabled).toHaveBeenCalledWith(
      "sdd@builtin",
      true,
      "project",
    );
    // 重建 agent 不再需要配置（模型/服务地址都不走设置页配置）。
    expect(configService.loadConfiguration).not.toHaveBeenCalled();
    expect(context.updateAllSessionsConfig).toHaveBeenCalledWith();
    const posted = (context.postSettingsMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as {
      command: string;
      enabledPlugins: Record<string, boolean>;
      workdir?: string;
    };
    expect(posted.command).toBe("projectSettings");
    expect(posted.enabledPlugins).toEqual({ "sdd@builtin": true });
    // 归属键：请求所用 workdir 恒回带（webview 过期即弃依据）
    expect(posted.workdir).toBe("/ws/root");
    expect(context.postMessage).not.toHaveBeenCalled();
  });

  test("closeSettings closes the settings panel", async () => {
    const session = createReadySession();
    const { handler, context } = createReadyHandler(session);

    await handler.handleSettingsMessage({ command: "closeSettings" });

    expect(context.closeSettings).toHaveBeenCalled();
  });

  // 设置页删除操作的成功/失败结果经宿主原生通知提示（spec「设置页反馈语义」）
  test("deleteSkill shows an info toast on success and refreshes the skill list", async () => {
    const session = {
      deleteSkill: vi.fn().mockResolvedValue(true),
      getSkillMetadata: vi.fn().mockResolvedValue([]),
    } as unknown as ChatSession;
    const { handler, context } = createHandler(session);

    await handler.handleSettingsMessage({
      command: "deleteSkill",
      name: "my-skill",
    });

    expect(session.deleteSkill).toHaveBeenCalledWith("my-skill");
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "已删除技能「my-skill」",
    );
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    const posted = (context.postSettingsMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as { command: string };
    expect(posted.command).toBe("skillMetadataResponse");
  });

  test("deleteSkill shows an error toast when the agent is missing or the skill is not found", async () => {
    const session = {
      deleteSkill: vi.fn().mockResolvedValue(false),
      getSkillMetadata: vi.fn().mockResolvedValue([]),
    } as unknown as ChatSession;
    const { handler } = createHandler(session);

    await handler.handleSettingsMessage({
      command: "deleteSkill",
      name: "ghost",
    });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "删除技能失败: 未找到技能「ghost」或智能体未初始化",
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  test("deleteSubagent shows an info toast on success", async () => {
    const session = {
      deleteSubagent: vi.fn().mockResolvedValue(true),
      getSubagentConfigurations: vi.fn().mockResolvedValue([]),
    } as unknown as ChatSession;
    const { handler } = createHandler(session);

    await handler.handleSettingsMessage({
      command: "deleteSubagent",
      name: "expert",
    });

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "已删除子代理「expert」",
    );
  });

  test("deleteHook shows an info toast on success and refreshes the hooks list", async () => {
    const session = {
      agent: {},
      deleteHook: vi.fn().mockResolvedValue(undefined),
      getHooksByScope: vi.fn().mockResolvedValue({
        hooks: {},
        configPath: "/home/u/.wave/settings.json",
      }),
    } as unknown as ChatSession;
    const { handler, context } = createHandler(session);

    await handler.handleSettingsMessage({
      command: "deleteHook",
      scope: "user",
      hookName: "PostToolUse",
    });

    expect(session.deleteHook).toHaveBeenCalledWith("user", "PostToolUse");
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "已删除钩子「PostToolUse」",
    );
    const posted = (context.postSettingsMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as {
      command: string;
      scope: string;
      configPath: string | null;
    };
    expect(posted.command).toBe("hooksResponse");
    expect(posted.scope).toBe("user");
    // 设置页「编辑」用它发 openFile → 必须是 host 解析的绝对路径（IDE 无法展开 `~`）
    expect(posted.configPath).toBe("/home/u/.wave/settings.json");
  });

  test("getHooksByScope replies with the session-resolved absolute configPath", async () => {
    const session = {
      agent: {},
      getHooksByScope: vi.fn().mockResolvedValue({
        hooks: { PreToolUse: [] },
        configPath: "/home/u/.wave/settings.json",
      }),
    } as unknown as ChatSession;
    const { handler, context } = createHandler(session);

    await handler.handleSettingsMessage({
      command: "getHooksByScope",
      scope: "user",
    });

    expect(session.getHooksByScope).toHaveBeenCalledWith("user");
    expect(
      (context.postSettingsMessage as ReturnType<typeof vi.fn>).mock
        .calls[0][0],
    ).toMatchObject({
      command: "hooksResponse",
      scope: "user",
      hooks: { PreToolUse: [] },
      configPath: "/home/u/.wave/settings.json",
    });
  });

  test("deleteHook shows an error toast without a live agent", async () => {
    const session = {
      deleteHook: vi.fn(),
      getHooksByScope: vi.fn(),
    } as unknown as ChatSession; // no `agent` — write operations need one
    const { handler } = createHandler(session);

    await handler.handleSettingsMessage({
      command: "deleteHook",
      scope: "user",
      hookName: "PostToolUse",
    });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "删除钩子失败: 智能体未初始化",
    );
    expect(session.deleteHook).not.toHaveBeenCalled();
  });

  test("removeMcpServer shows an info toast on success and refreshes the MCP list", async () => {
    const session = {
      removeMcpServer: vi.fn().mockResolvedValue(true),
      getMcpServers: vi.fn().mockResolvedValue([]),
    } as unknown as ChatSession;
    const { handler, context } = createHandler(session);

    await handler.handleSettingsMessage({
      command: "removeMcpServer",
      scope: "user",
      serverName: "redis",
    });

    expect(session.removeMcpServer).toHaveBeenCalledWith("user", "redis");
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "已移除 MCP 服务器「redis」",
    );
    const posted = (context.postSettingsMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as { command: string };
    expect(posted.command).toBe("mcpServersResponse");
  });

  test("removeMcpServer shows an error toast when the agent is missing or the server is not found", async () => {
    const session = {
      removeMcpServer: vi.fn().mockResolvedValue(false),
      getMcpServers: vi.fn().mockResolvedValue([]),
    } as unknown as ChatSession;
    const { handler } = createHandler(session);

    await handler.handleSettingsMessage({
      command: "removeMcpServer",
      scope: "project",
      serverName: "ghost",
    });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "移除 MCP 服务器失败: 未找到服务器「ghost」或智能体未初始化",
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  // 保存「失败」半边此前无覆盖：saveConfiguration 抛错时必须给用户可见反馈，
  // 且要把 configurationError 回发给设置页（而非静默停在内联提示状态）。
  test("updateConfiguration save failure shows an error toast and replies configurationError", async () => {
    const session = createReadySession();
    const { handler, context, configService } = createReadyHandler(session);
    configService.saveConfiguration.mockRejectedValue(new Error("boom"));

    await handler.handleSettingsMessage({
      command: "updateConfiguration",
      configurationData: { language: "en-US" },
    });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "保存失败：boom",
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    const commands = (
      context.postSettingsMessage as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => (call[0] as { command: string }).command);
    expect(commands).toEqual(["configurationError"]);
  });

  // 删除「抛错」分支（catch）此前无覆盖：只有返回值 false 的路径被断言过。
  test("deleteSkill failure thrown by the session surfaces an error toast", async () => {
    const session = {
      deleteSkill: vi.fn().mockRejectedValue(new Error("boom")),
    } as unknown as ChatSession;
    const { handler, context } = createHandler(session);

    await handler.handleSettingsMessage({
      command: "deleteSkill",
      name: "my-skill",
    });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "删除技能失败: Error: boom",
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(context.postSettingsMessage).not.toHaveBeenCalled();
  });

  test("deleteSubagent failure thrown by the session surfaces an error toast", async () => {
    const session = {
      deleteSubagent: vi.fn().mockRejectedValue(new Error("boom")),
    } as unknown as ChatSession;
    const { handler } = createHandler(session);

    await handler.handleSettingsMessage({
      command: "deleteSubagent",
      name: "expert",
    });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "删除子代理失败: Error: boom",
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  test("removeMcpServer failure thrown by the session surfaces an error toast", async () => {
    const session = {
      removeMcpServer: vi.fn().mockRejectedValue(new Error("boom")),
    } as unknown as ChatSession;
    const { handler } = createHandler(session);

    await handler.handleSettingsMessage({
      command: "removeMcpServer",
      scope: "user",
      serverName: "redis",
    });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "移除 MCP 服务器失败: Error: boom",
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });
});

// Chat 路由的删除/保存反馈与 settings 路由同语义（#2086 式双 switch 漂移防线）
describe("MessageHandler chat-route deletion toasts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("deleteSkill shows an info toast on success", async () => {
    const session = {
      deleteSkill: vi.fn().mockResolvedValue(true),
    } as unknown as ChatSession;
    const { handler } = createHandler(session);

    await handler.handleMessage(
      { command: "deleteSkill", name: "my-skill" },
      "tab",
    );

    expect(session.deleteSkill).toHaveBeenCalledWith("my-skill");
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "已删除技能「my-skill」",
    );
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  test("deleteSkill shows an error toast when the skill is not found", async () => {
    const session = {
      deleteSkill: vi.fn().mockResolvedValue(false),
    } as unknown as ChatSession;
    const { handler } = createHandler(session);

    await handler.handleMessage(
      { command: "deleteSkill", name: "ghost" },
      "tab",
    );

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "删除技能失败: 未找到技能「ghost」或智能体未初始化",
    );
  });

  test("deleteSubagent shows an info toast on success", async () => {
    const session = {
      deleteSubagent: vi.fn().mockResolvedValue(true),
    } as unknown as ChatSession;
    const { handler } = createHandler(session);

    await handler.handleMessage(
      { command: "deleteSubagent", name: "expert" },
      "sidebar",
    );

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "已删除子代理「expert」",
    );
  });

  test("removeMcpServer shows an info toast on success", async () => {
    const session = {
      removeMcpServer: vi.fn().mockResolvedValue(true),
    } as unknown as ChatSession;
    const { handler } = createHandler(session);

    await handler.handleMessage(
      { command: "removeMcpServer", scope: "user", serverName: "redis" },
      "tab",
    );

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "已移除 MCP 服务器「redis」",
    );
  });

  test("deleteHook shows an info toast on success and posts the refreshed hooks list", async () => {
    const session = {
      agent: {},
      deleteHook: vi.fn().mockResolvedValue(undefined),
      getHooksByScope: vi.fn().mockResolvedValue({
        hooks: {},
        configPath: null,
      }),
    } as unknown as ChatSession;
    const { handler, context } = createHandler(session);

    await handler.handleMessage(
      { command: "deleteHook", scope: "user", hookName: "PostToolUse" },
      "tab",
    );

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "已删除钩子「PostToolUse」",
    );
    const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { command: string; scope: string };
    expect(posted.command).toBe("hooksResponse");
    expect(posted.scope).toBe("user");
  });

  test("deleteHook shows an error toast without a live agent", async () => {
    const session = {
      deleteHook: vi.fn(),
    } as unknown as ChatSession; // no `agent` — write operations need one
    const { handler } = createHandler(session);

    await handler.handleMessage(
      { command: "deleteHook", scope: "user", hookName: "PostToolUse" },
      "tab",
    );

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "删除钩子失败: 智能体未初始化",
    );
    expect(session.deleteHook).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  test("deleteSubagent shows an error toast when the subagent is not found", async () => {
    const session = {
      deleteSubagent: vi.fn().mockResolvedValue(false),
    } as unknown as ChatSession;
    const { handler } = createHandler(session);

    await handler.handleMessage(
      { command: "deleteSubagent", name: "ghost" },
      "tab",
    );

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "删除子代理失败: 未找到子代理「ghost」或智能体未初始化",
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  test("removeMcpServer shows an error toast when the server is not found", async () => {
    const session = {
      removeMcpServer: vi.fn().mockResolvedValue(false),
    } as unknown as ChatSession;
    const { handler } = createHandler(session);

    await handler.handleMessage(
      { command: "removeMcpServer", scope: "project", serverName: "ghost" },
      "tab",
    );

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "移除 MCP 服务器失败: 未找到服务器「ghost」或智能体未初始化",
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  test("deleteSkill failure thrown by the session surfaces an error toast", async () => {
    const session = {
      deleteSkill: vi.fn().mockRejectedValue(new Error("boom")),
    } as unknown as ChatSession;
    const { handler } = createHandler(session);

    await handler.handleMessage(
      { command: "deleteSkill", name: "my-skill" },
      "tab",
    );

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "删除技能失败: Error: boom",
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });
});

describe("MessageHandler chat-route configuration toasts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("updateConfiguration shows a success toast and nudges the chat webview", async () => {
    const session = createReadySession();
    const { handler, context, configService } = createReadyHandler(session);

    await handler.handleMessage(
      {
        command: "updateConfiguration",
        configurationData: { language: "en-US" },
      },
      "tab",
    );

    expect(configService.saveConfiguration).toHaveBeenCalledWith({
      language: "en-US",
    });
    // PR-2：用户偏好写用户级 settings.json 由 SDK 实时重载生效，保存**不重建会话**
    // （spec core/agent-config.md「配置变更的构造期副作用与重建」场景 1–2）——
    // 重建只留给插件挂载/卸载（同文件上方 setBuiltinPluginEnabled 用例）。
    expect(context.updateAllSessionsConfig).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "保存成功",
    );
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    const commands = (
      context.postMessage as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => (call[0] as { command: string }).command);
    expect(commands).toEqual([
      "configurationUpdated",
      "focusInput",
      "scrollToBottom",
      // chat 路由保存后顺带重读配置（handleGetConfiguration），与 settings 路由
      // 回发 configurationResponse 的语义对齐
      "configurationResponse",
    ]);
  });

  test("updateConfiguration save failure shows an error toast and posts configurationError", async () => {
    const session = createReadySession();
    const { handler, context, configService } = createReadyHandler(session);
    configService.saveConfiguration.mockRejectedValue(new Error("boom"));

    await handler.handleMessage(
      {
        command: "updateConfiguration",
        configurationData: { language: "en-US" },
      },
      "sidebar",
    );

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "保存失败：boom",
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    const errors = sentPosts(context)("configurationError");
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toContain("boom");
  });
});

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
    loadConfiguration: vi
      .fn()
      .mockResolvedValue({ serverUrl: "", language: "Chinese" }),
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

  // Regression: setInitialState.configurationData.serverUrl must reflect the
  // serverUrl freshly fetched from getAuthStatus, not the stale/empty value
  // loaded before saveConfiguration. A stale empty serverUrl would silently
  // break the "enterprise console" action in the webview.
  test("webviewReady sends fresh serverUrl from getAuthStatus in setInitialState", async () => {
    const session = createReadySession();
    const { handler, context, configService, utilityClient } =
      createReadyHandler(session);

    await handler.handleMessage({ command: "webviewReady" }, "tab");

    expect(utilityClient.request).toHaveBeenCalledWith("getAuthStatus");
    expect(configService.saveConfiguration).toHaveBeenCalledWith({
      serverUrl: "https://console.example.com",
    });

    const states = sentPosts(context)("setInitialState");
    expect(states.length).toBeGreaterThanOrEqual(1);
    const posted = states[states.length - 1];

    expect(posted).toBeDefined();
    expect(posted.configurationData).toBeDefined();
    expect(posted.configurationData!.serverUrl).toBe(
      "https://console.example.com",
    );
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
      loadConfiguration: vi
        .fn()
        .mockResolvedValue({ serverUrl: "", language: "Chinese" }),
      saveConfiguration: vi.fn(),
    };
    const pluginService = {
      setBuiltinPluginEnabled: vi
        .fn()
        .mockResolvedValue({ enabledPlugins: { "sdd@builtin": true } }),
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
    expect(configService.loadConfiguration).toHaveBeenCalled();
    expect(context.updateAllSessionsConfig).toHaveBeenCalledWith({
      serverUrl: "",
      language: "Chinese",
    });

    const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as {
      command: string;
      enabledPlugins: Record<string, boolean>;
    };
    expect(posted.command).toBe("projectSettings");
    expect(posted.enabledPlugins).toEqual({ "sdd@builtin": true });
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
    expect(posted.configurationData).toEqual({
      serverUrl: "",
      language: "Chinese",
    });
    expect(context.postMessage).not.toHaveBeenCalled();
  });

  test("updateConfiguration saves, recreates agents and replies to the settings panel", async () => {
    const session = createReadySession();
    const { handler, context, configService } = createReadyHandler(session);

    await handler.handleSettingsMessage({
      command: "updateConfiguration",
      configurationData: { language: "en-US" },
    });

    expect(configService.saveConfiguration).toHaveBeenCalledWith({
      language: "en-US",
    });
    expect(context.updateAllSessionsConfig).toHaveBeenCalled();
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
    };
    expect(posted.command).toBe("projectSettings");
    expect(posted.enabledPlugins).toEqual({ "sdd@builtin": true });
    // Response goes to the settings panel, never the chat webviews
    expect(context.postMessage).not.toHaveBeenCalled();
  });

  test("setBuiltinPluginEnabled from the settings panel reloads config, recreates agents and replies to the settings panel", async () => {
    const configService = {
      loadConfiguration: vi
        .fn()
        .mockResolvedValue({ serverUrl: "", language: "Chinese" }),
      saveConfiguration: vi.fn(),
    };
    const pluginService = {
      setBuiltinPluginEnabled: vi
        .fn()
        .mockResolvedValue({ enabledPlugins: { "sdd@builtin": true } }),
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
    expect(configService.loadConfiguration).toHaveBeenCalled();
    expect(context.updateAllSessionsConfig).toHaveBeenCalledWith({
      serverUrl: "",
      language: "Chinese",
    });
    const posted = (context.postSettingsMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as {
      command: string;
      enabledPlugins: Record<string, boolean>;
    };
    expect(posted.command).toBe("projectSettings");
    expect(posted.enabledPlugins).toEqual({ "sdd@builtin": true });
    expect(context.postMessage).not.toHaveBeenCalled();
  });

  test("closeSettings closes the settings panel", async () => {
    const session = createReadySession();
    const { handler, context } = createReadyHandler(session);

    await handler.handleSettingsMessage({ command: "closeSettings" });

    expect(context.closeSettings).toHaveBeenCalled();
  });
});

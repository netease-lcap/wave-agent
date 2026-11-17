import { describe, test, expect, vi, beforeEach } from "vitest";
import type { Message, ModNoticePayload } from "wave-agent-sdk/host";

// ChatProvider's module graph imports the real "vscode" module; stub the API
// surface reachable at import time / via the context methods under test.
vi.mock("vscode", () => ({
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  },
  commands: { executeCommand: vi.fn() },
  // ChatSession.initialize reads the first workspace folder for `workdir`.
  workspace: { workspaceFolders: [] },
}));

import { ChatProvider } from "../../src/chatProvider";
import type { MessageHandlerContext } from "../../src/session/messageHandler";
import type {
  ChatSession,
  ChatSessionCallbacks,
} from "../../src/session/chatSession";
import type { StdioClient } from "../../src/stdio/stdioClient";
import type { NotificationRouter } from "wave-agent-sdk/host";

type BareProvider = {
  createMessageHandlerContext: () => MessageHandlerContext;
  openSettings: ReturnType<typeof vi.fn>;
  webviewManager: { postMessage: ReturnType<typeof vi.fn> };
  createChatSession: (viewType: "sidebar" | "tab" | "window") => ChatSession;
};

function makeBareProvider(): BareProvider {
  // Skip the real constructor (it spawns the CLI / downloads binaries). A
  // prototype-only instance is enough to exercise createMessageHandlerContext,
  // whose closures forward to `this` members we stub.
  const provider = Object.create(
    ChatProvider.prototype,
  ) as unknown as BareProvider;
  provider.openSettings = vi.fn();
  provider.webviewManager = { postMessage: vi.fn() };
  return provider;
}

describe("ChatProvider message-handler context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("openSettings forwards the nav payload to ChatProvider.openSettings", () => {
    const provider = makeBareProvider();
    const context = provider.createMessageHandlerContext();

    context.openSettings("mcp");

    expect(provider.openSettings).toHaveBeenCalledWith("mcp");
  });

  test("openSettings without nav calls ChatProvider.openSettings with undefined", () => {
    const provider = makeBareProvider();
    const context = provider.createMessageHandlerContext();

    context.openSettings();

    expect(provider.openSettings).toHaveBeenCalledWith(undefined);
  });

  // The compact fallback (old CLI whose notification carries no `message`) re-pulls
  // the list; ChatSession reports it through onMessagesReplaced and the provider
  // turns it into a full-list push — command name and payload pinned here, since
  // host→webview commands have no audit script (only webview→host ones do).
  test("onMessagesReplaced pushes the full list as updateMessages", () => {
    const provider = makeBareProvider();
    const session = provider.createChatSession("tab");
    const callbacks = (
      session as unknown as { callbacks: ChatSessionCallbacks }
    ).callbacks;
    const messages = [
      { id: "m1", role: "user", blocks: [] },
    ] as unknown as Message[];

    callbacks.onMessagesReplaced?.(messages);

    expect(provider.webviewManager.postMessage).toHaveBeenCalledWith(
      { command: "updateMessages", messages },
      "tab",
      undefined,
    );
  });

  // `$.ui.notice`（spec「工具行下面的一行」）：CLI 的 `modNotice` 通知经 StdioAgent
  // → ChatSession 回调落到这里，再以桌面端那个消息名推给同一份 webview（IDE 端没有
  // pane，所以不带 paneId）。命令名与载荷形状钉在这里 —— host→webview 的命令没有
  // 审计脚本，漏改只会静默不显示。
  test("modNotice 通知推成 desktopModNotice，payload 原样、不带 paneId", async () => {
    const provider = makeBareProvider();
    const session = provider.createChatSession("tab");
    const request = vi.fn(async (method: string) => {
      if (method === "initialize") {
        return {
          sessionId: "sess-1",
          currentWorkdir: "/test-workspace",
          permissionMode: "default",
          latestTotalTokens: 0,
        };
      }
      return {};
    });
    await session.initialize(
      undefined,
      { request } as unknown as StdioClient,
      {
        register: vi.fn(),
        unregister: vi.fn(),
      } as unknown as NotificationRouter,
    );

    const payload: ModNoticePayload = {
      sessionId: "sess-1",
      plugin: "ideas-shelf",
      toolUseId: "tool-1",
      text: "已校验",
    };
    session.agent!.handleNotification("modNotice", payload);

    expect(provider.webviewManager.postMessage).toHaveBeenCalledWith(
      { command: "desktopModNotice", payload },
      "tab",
      undefined,
    );
  });
});

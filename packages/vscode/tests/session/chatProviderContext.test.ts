import { describe, test, expect, vi, beforeEach } from "vitest";
import type { Message } from "wave-agent-sdk/host";

// ChatProvider's module graph imports the real "vscode" module; stub the API
// surface reachable at import time / via the context methods under test.
vi.mock("vscode", () => ({
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  },
  commands: { executeCommand: vi.fn() },
}));

import { ChatProvider } from "../../src/chatProvider";
import type { MessageHandlerContext } from "../../src/session/messageHandler";
import type { ChatSessionCallbacks } from "../../src/session/chatSession";

type BareProvider = {
  createMessageHandlerContext: () => MessageHandlerContext;
  openSettings: ReturnType<typeof vi.fn>;
  webviewManager: { postMessage: ReturnType<typeof vi.fn> };
  createChatSession: (viewType: "sidebar" | "tab" | "window") => object;
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
    const callbacks = (session as { callbacks: ChatSessionCallbacks })
      .callbacks;
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
});

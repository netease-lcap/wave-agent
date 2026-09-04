import { describe, test, expect, vi, beforeEach } from "vitest";

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

type BareProvider = {
  createMessageHandlerContext: () => MessageHandlerContext;
  openSettings: ReturnType<typeof vi.fn>;
};

function makeBareProvider(): BareProvider {
  // Skip the real constructor (it spawns the CLI / downloads binaries). A
  // prototype-only instance is enough to exercise createMessageHandlerContext,
  // whose closures forward to `this` members we stub.
  const provider = Object.create(
    ChatProvider.prototype,
  ) as unknown as BareProvider;
  provider.openSettings = vi.fn();
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
});

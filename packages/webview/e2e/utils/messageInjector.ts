import { Page } from "@playwright/test";
import type { Message, SessionMetadata } from "wave-agent-sdk";

declare global {
  interface Window {
    simulateExtensionMessage: (message: Record<string, unknown>) => void;
    getTestMessages: () => Record<string, unknown>[];
    clearTestMessages: () => void;
    vscode: {
      postMessage: (message: Record<string, unknown>) => void;
    };
  }
}

/**
 * Utilities for injecting messages and simulating extension communication
 */
export class MessageInjector {
  constructor(
    private page: Page,
    private vscode?: Record<string, unknown>,
  ) {}

  /**
   * Simulate receiving messages from the extension
   */
  async simulateExtensionMessage(
    command: string,
    data: Record<string, unknown> = {},
  ) {
    return await this.page.evaluate(
      (args) => {
        const message = { command: args.command, ...args.data };
        window.simulateExtensionMessage(message);
      },
      { command, data },
    );
  }

  /**
   * Update the chat with a list of messages
   */
  async updateMessages(messages: Message[]) {
    // Pass Message objects directly to the webview (no conversion needed)
    await this.simulateExtensionMessage("updateMessages", { messages });
  }

  /**
   * Start streaming mode
   */
  async startStreaming() {
    await this.simulateExtensionMessage("startStreaming");
  }

  /**
   * End streaming mode
   */
  async endStreaming() {
    await this.simulateExtensionMessage("endStreaming");
  }

  /**
   * Simulate message abort by sending a message with an error block
   */
  async abortMessage(partialContent: string) {
    // Create a message with an error block to represent aborted content
    const abortedMessage: Message = {
      id: `msg_abort_${Date.now()}`,
      role: "assistant" as const,
      timestamp: "2025-07-09T10:30:00.000Z",
      blocks: [
        {
          type: "error" as const,
          content: partialContent,
        },
      ],
    };

    // Send as final message (this replaces any streaming message)
    await this.updateMessages([abortedMessage]);
  }

  /**
   * Update the message queue
   */
  async updateQueue(queue: Record<string, unknown>[]) {
    await this.simulateExtensionMessage("updateQueue", { queue });
  }

  /**
   * Clear all messages
   */
  async clearMessages() {
    await this.updateMessages([]);
  }

  /**
   * Simulate tool update
   */
  async updateTool(toolName: string, stage: string, result?: string) {
    const params = {
      name: toolName,
      stage: stage,
      result: result,
    };
    await this.simulateExtensionMessage("updateTool", { params });
  }

  /**
   * Get messages that were sent to the extension
   */
  async getMessagesSentToExtension(): Promise<Record<string, unknown>[]> {
    return await this.page.evaluate(() => {
      return window.getTestMessages();
    });
  }

  /**
   * Clear the message log
   */
  async clearMessageLog() {
    await this.page.evaluate(() => {
      window.clearTestMessages();
    });
  }

  /**
   * Wait for a specific message to be sent to the extension
   */
  async waitForMessage(command: string, timeout = 5000): Promise<unknown> {
    return await this.page.waitForFunction(
      (expectedCommand) => {
        const messages = window.getTestMessages();
        return messages.find((msg) => msg.command === expectedCommand);
      },
      command,
      { timeout },
    );
  }

  /**
   * Wait until ChatApp has mounted and attached its window-message listener.
   *
   * ChatApp attaches the listener in a passive effect (useEffect ... []) and
   * posts `webviewReady` in a later effect ([vscode]) defined AFTER it, so
   * React runs the listener effect first — observing `webviewReady` therefore
   * guarantees a subsequent `setInitialState` will be received rather than
   * dropped. Desktop demos MUST send `desktopWorkdirState` first (that mounts
   * ChatApp) and call this before `setInitialState`; otherwise the auth /
   * initialized payload is lost to the mount race and a no-messages pane
   * renders the LoadingLogo sweep instead of the welcome page.
   */
  async waitForChatAppReady(timeout = 5000) {
    await this.waitForMessage("webviewReady", timeout);
  }

  /**
   * Update sessions list
   */
  async updateSessions(sessions: Record<string, unknown>[]) {
    await this.simulateExtensionMessage("updateSessions", { sessions });
  }

  /**
   * Update current session
   */
  async updateCurrentSession(session: Record<string, unknown>) {
    await this.simulateExtensionMessage("updateCurrentSession", { session });
  }

  /**
   * Simulate sessions loading state
   */
  async setSessionsLoading(loading: boolean) {
    // This would normally be handled internally, but for testing we can simulate the state
    if (loading) {
      await this.simulateExtensionMessage("updateSessions", { sessions: [] });
    }
  }

  /**
   * Simulate webview ready initialization with existing messages and session
   */
  async simulateWebviewReady(
    messages: Message[],
    currentSession?: SessionMetadata,
  ) {
    // First simulate the extension receiving the webviewReady command
    // and responding with the initial state

    if (messages.length > 0) {
      await this.updateMessages(messages);
    }

    if (currentSession) {
      await this.updateCurrentSession(
        currentSession as unknown as Record<string, unknown>,
      );
    }

    // Simulate sessions list (we can use an empty array or include the current session)
    const sessions = currentSession
      ? [currentSession as unknown as Record<string, unknown>]
      : [];
    await this.updateSessions(sessions);
  }

  /**
   * Send webviewReady message to simulate webview initialization/re-initialization
   */
  async sendWebviewReady() {
    await this.page.evaluate(() => {
      // Simulate what happens when webview sends 'webviewReady' to extension
      // In real scenario, extension would respond with current state
      if (window.vscode && window.vscode.postMessage) {
        window.vscode.postMessage({ command: "webviewReady" });
      }
    });
  }

  /**
   * Wait for a requestFileSuggestions message and return its requestId.
   * Replaces fixed waitForTimeout for debounce-based file suggestion triggers.
   */
  async waitForFileSuggestionRequest(
    timeout = 2000,
    afterMessageCount?: number,
  ): Promise<string> {
    return await this.page
      .waitForFunction(
        (startIndex) => {
          const messages = window.getTestMessages?.() || [];
          const start = startIndex || 0;
          for (let i = messages.length - 1; i >= start; i--) {
            if (
              messages[i].command === "requestFileSuggestions" &&
              messages[i].requestId
            ) {
              return messages[i].requestId;
            }
          }
          return false;
        },
        afterMessageCount || 0,
        { timeout },
      )
      .then((r) => r as unknown as string);
  }

  async getMessageCount(): Promise<number> {
    return await this.page.evaluate(() => {
      const messages = window.getTestMessages?.() || [];
      return messages.length;
    });
  }
}

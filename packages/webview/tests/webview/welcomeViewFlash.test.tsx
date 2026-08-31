import { describe, it, expect } from "vitest";
import {
  render,
  screen,
  act,
  sendCommand,
  createMockVscode,
} from "./test-utils";
import { ChatApp } from "../../src/components/ChatApp";

/**
 * The welcome page (brand wordmark) must not flash before the backend pushes
 * `setInitialState`: the welcome state depends on the initial snapshot, and the
 * wordmark is its only visual content (the login entry lives in the chat
 * header / sidebar account card, not on the welcome page).
 */
describe("WelcomeView render timing", () => {
  it("does not show the welcome page before initial state arrives", () => {
    // Render directly (bypassing renderChatApp's auto authStatusResponse) to
    // simulate the very first frame before setInitialState reaches the webview.
    render(<ChatApp vscode={createMockVscode()} />);

    expect(screen.queryByTestId("welcome-wordmark")).not.toBeInTheDocument();
  });

  it("shows the welcome page once initial state arrives", () => {
    render(<ChatApp vscode={createMockVscode()} />);

    act(() => {
      sendCommand("setInitialState", {
        messages: [],
        isStreaming: false,
        sessions: [],
        isAuthenticated: false,
        configurationData: {},
        pendingConfirmations: [],
      });
    });

    expect(screen.getByTestId("welcome-wordmark")).toBeVisible();
  });

  it("shows the welcome page regardless of the initial auth state", () => {
    render(<ChatApp vscode={createMockVscode()} />);

    act(() => {
      sendCommand("setInitialState", {
        messages: [],
        isStreaming: false,
        sessions: [],
        isAuthenticated: true,
        configurationData: {},
        pendingConfirmations: [],
      });
    });

    expect(screen.getByTestId("welcome-wordmark")).toBeVisible();
  });

  /**
   * Regression: a SessionStart hook can inject hidden context as an isMeta
   * user message (e.g. this repo's "SessionStart hook additional context"
   * reminder). Hidden messages are not chat content: they must not suppress
   * the welcome page, or the user sees a blank area (MessageList filters
   * them out of rendering, but state.messages.length used to count them).
   */
  it("keeps showing the welcome page when only hidden meta messages exist", () => {
    render(<ChatApp vscode={createMockVscode()} />);

    act(() => {
      sendCommand("setInitialState", {
        messages: [
          {
            id: "meta-1",
            role: "user",
            isMeta: true,
            timestamp: new Date().toISOString(),
            blocks: [
              {
                type: "text",
                content:
                  "<system-reminder>\nSessionStart hook additional context: …\n</system-reminder>",
              },
            ],
          },
        ],
        isStreaming: false,
        sessions: [],
        isAuthenticated: false,
        configurationData: {},
        pendingConfirmations: [],
      });
    });

    // Welcome page still shown (not a blank message area).
    expect(screen.getByTestId("welcome-wordmark")).toBeVisible();
  });

  /**
   * Regression: the header 登 录 button must not flash during auth loading.
   * The reducer defaults isAuthenticated to false, and the button used to
   * render on the very first frame — before the host's snapshot (which carries
   * the real auth state) arrived — briefly claiming "logged out".
   */
  it("does not render the login button before the auth state is known", () => {
    render(<ChatApp vscode={createMockVscode()} />);

    expect(screen.queryByTestId("header-login-btn")).not.toBeInTheDocument();
  });

  it("renders the login button once the snapshot confirms logged out", () => {
    render(<ChatApp vscode={createMockVscode()} />);

    act(() => {
      sendCommand("setInitialState", {
        messages: [],
        isStreaming: false,
        sessions: [],
        isAuthenticated: false,
        configurationData: {},
        pendingConfirmations: [],
      });
    });

    expect(screen.getByTestId("header-login-btn")).toBeVisible();
  });

  it("switches away from the welcome page once a visible message arrives", () => {
    render(<ChatApp vscode={createMockVscode()} />);

    act(() => {
      sendCommand("setInitialState", {
        messages: [
          {
            id: "meta-1",
            role: "user",
            isMeta: true,
            timestamp: new Date().toISOString(),
            blocks: [
              {
                type: "text",
                content: "<system-reminder>hidden context</system-reminder>",
              },
            ],
          },
          {
            id: "user-1",
            role: "user",
            timestamp: new Date().toISOString(),
            blocks: [{ type: "text", content: "hello" }],
          },
        ],
        isStreaming: false,
        sessions: [],
        isAuthenticated: false,
        configurationData: {},
        pendingConfirmations: [],
      });
    });

    expect(screen.queryByTestId("welcome-wordmark")).not.toBeInTheDocument();
  });
});

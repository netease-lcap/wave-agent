import { describe, it, expect } from "vitest";
import {
  render,
  screen,
  act,
  fireEvent,
  sendCommand,
  createMockVscode,
} from "./test-utils";
import { ChatApp } from "../../src/components/ChatApp";
import WelcomeView from "../../src/components/WelcomeView";

/**
 * The welcome page (brand wordmark) must not flash before the backend pushes
 * `setInitialState`: the welcome state depends on the initial snapshot.
 *
 * The login entry for IDE hosts lives on the welcome page itself (spec
 * sso-auth「更多菜单与欢迎页」场景 5/7) — a 登录后即可开始使用~ hint + 登 录
 * button shown while unauthenticated without a direct-connect config. Desktop
 * logs in via the sidebar account card instead, so its welcome page never
 * shows the button.
 */
describe("WelcomeView render timing", () => {
  it("does not show the welcome page before initial state arrives", () => {
    // Render directly (bypassing renderChatApp's auto authStatusResponse) to
    // simulate the very first frame before setInitialState reaches the webview.
    render(<ChatApp vscode={createMockVscode()} />);

    expect(screen.queryByTestId("welcome-wordmark")).not.toBeInTheDocument();
    // The login button is part of the welcome page — it must not flash either.
    expect(screen.queryByTestId("welcome-login-btn")).not.toBeInTheDocument();
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
    // Authenticated users get no login nudge on the welcome page.
    expect(screen.queryByTestId("welcome-login-btn")).not.toBeInTheDocument();
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
   * Regression: the welcome-page 登 录 button must not appear before the host's
   * snapshot. The reducer defaults isAuthenticated to false, and the welcome
   * page (with its login button) used to render on the very first frame —
   * before the snapshot (which carries the real auth state) arrived — briefly
   * claiming "logged out".
   */
  it("does not render the welcome login button before the auth state is known", () => {
    render(<ChatApp vscode={createMockVscode()} />);

    expect(screen.queryByTestId("welcome-login-btn")).not.toBeInTheDocument();
  });

  it("shows the welcome login button once the snapshot confirms logged out", () => {
    const vscode = createMockVscode();
    render(<ChatApp vscode={vscode} />);

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

    const loginBtn = screen.getByTestId("welcome-login-btn");
    expect(loginBtn).toBeVisible();
    expect(loginBtn).toHaveTextContent("登 录");
    expect(screen.getByTestId("welcome-login-hint")).toHaveTextContent(
      "登录后即可开始使用~",
    );

    // Clicking fires the same login flow as the 更多 menu's 登录 item.
    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.click(loginBtn);
    });
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "login" }),
    );
  });

  it("hides the welcome login button when a direct-connect config is present", () => {
    // baseURL + apiKey work without SSO auth, so login must stay optional
    // (spec sso-auth「更多菜单与欢迎页」场景 5).
    render(<ChatApp vscode={createMockVscode()} />);

    act(() => {
      sendCommand("setInitialState", {
        messages: [],
        isStreaming: false,
        sessions: [],
        isAuthenticated: false,
        configurationData: {
          apiKey: "sk-test",
          baseURL: "https://api.example.com/v1",
        },
        pendingConfirmations: [],
      });
    });

    expect(screen.getByTestId("welcome-wordmark")).toBeVisible();
    expect(screen.queryByTestId("welcome-login-btn")).not.toBeInTheDocument();
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

describe("WelcomeView login entry", () => {
  it("never shows a login button on the desktop welcome page", () => {
    // Desktop's login entry is the sidebar account card (desktop-app spec),
    // so even an unauthenticated desktop user without a direct-connect config
    // gets no login button here.
    render(
      <WelcomeView
        isDesktop
        isAuthenticated={false}
        hasDirectConnectConfig={false}
        onLogin={() => {}}
      />,
    );

    expect(screen.getByTestId("welcome-wordmark")).toBeVisible();
    expect(screen.queryByTestId("welcome-login-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("welcome-login-hint")).not.toBeInTheDocument();
  });
});

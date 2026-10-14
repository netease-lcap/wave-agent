/**
 * The phone page is the shared webview plus a browser shim, so its header
 * differences are the only thing the shared UI has to know about it:
 *
 * - no 「新建对话」/「历史对话」 — the page is a control surface for one
 *   conversation, and neither a new conversation nor a disk-history list is
 *   something the serving process can act on (spec remote-control「Web 页作为第五种
 *   宿主」场景 5);
 * - one 「会话」 entry instead, whose list holds the sessions that process is
 *   running right now and switches the page's own view between them (场景 8).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  fireEvent,
  renderChatApp,
  screen,
  sendCommand,
  sendHostMessage,
  within,
} from "./test-utils";
import { fixtures } from "wave-webview-fixtures";

const SESSIONS = [
  {
    id: "session-1",
    sessionType: "main" as const,
    workdir: "/tmp/other",
    firstMessage: "另一个项目的会话",
    createdAt: new Date("2026-10-14T08:00:00Z"),
    lastActiveAt: new Date("2026-10-14T09:00:00Z"),
    latestTotalTokens: 100,
  },
  {
    id: "session-2",
    sessionType: "main" as const,
    workdir: "/repo",
    customTitle: "登录页",
    createdAt: new Date("2026-10-14T09:30:00Z"),
    lastActiveAt: new Date("2026-10-14T10:00:00Z"),
    latestTotalTokens: 200,
  },
];

function renderRemotePage() {
  window.waveRemotePage = true;
  const rendered = renderChatApp();
  act(() => {
    sendCommand("updateSessions", { sessions: SESSIONS });
    sendCommand("updateCurrentSession", { session: SESSIONS[1] });
  });
  return rendered;
}

afterEach(() => {
  delete window.waveRemotePage;
});

describe("remote page session switcher", () => {
  it("replaces the new-chat and history buttons with a single session entry", () => {
    renderRemotePage();

    expect(screen.getByTestId("session-switch-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("new-session-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("history-btn")).not.toBeInTheDocument();
  });

  it("keeps both history buttons in every other host", () => {
    renderChatApp();
    act(() => {
      sendCommand("updateSessions", { sessions: SESSIONS });
    });

    expect(screen.getByTestId("history-btn")).toBeInTheDocument();
    expect(screen.getByTestId("new-session-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("session-switch-btn")).not.toBeInTheDocument();
  });

  it("lists the running sessions with their project and switches on click", () => {
    const { vscode } = renderRemotePage();

    act(() => {
      fireEvent.click(screen.getByTestId("session-switch-btn"));
    });

    const popup = screen.getByTestId("session-list-popup");
    // It says 会话, not 历史对话: what it holds is what the process is running.
    expect(within(popup).getByText("会话")).toBeInTheDocument();
    // Two same-titled sessions have to be told apart by their project.
    expect(popup).toHaveTextContent("/tmp/other");

    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.click(screen.getByTestId("session-list-item-session-1"));
    });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "restoreSession",
        sessionId: "session-1",
      }),
    );
  });

  it("follows the shim's switched snapshot without a session-switch command", () => {
    // The switch is answered **locally** on the page: the shim re-points its own
    // sessionId and re-pulls, so what the UI sees is a plain cold-start snapshot
    // for another conversation — same message, no restoreSession round trip.
    renderRemotePage();

    act(() => {
      sendHostMessage(
        fixtures.setInitialState({
          messages: [],
          sessions: SESSIONS,
          session: SESSIONS[0],
        }),
      );
    });

    expect(screen.getByTestId("chat-header")).toHaveTextContent(
      "另一个项目的会话",
    );

    act(() => {
      fireEvent.click(screen.getByTestId("session-switch-btn"));
    });
    expect(screen.getByTestId("session-list-item-session-1")).toHaveClass(
      "session-list-item--current",
    );
  });
});

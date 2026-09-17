import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { DesktopApp } from "../../src/components/DesktopApp";
import {
  createMockVscode,
  fireInput,
  renderChatApp,
  sendCommand,
  waitFor,
} from "./test-utils";

/**
 * `/resume` (spec session-management.md「GUI 会话内热切换」/「IDE 插件聊天头部」
 * 场景 8-10, desktop-sessions.md「跨客户端会话来源」).
 *
 * IDE hosts: the command opens the very same popup as the 「历史对话」 button —
 * same list, same restore path. Desktop: a centered modal fed by the host's
 * on-disk scan of the current conversation's host, so sessions this app never
 * created are reachable.
 */

const diskSessions = [
  {
    id: "cli-created",
    sessionType: "main",
    workdir: "/work/alpha",
    firstMessage: "session from the CLI",
    lastActiveAt: new Date("2023-12-01T10:00:00Z"),
    latestTotalTokens: 100,
  },
  {
    id: "other-project",
    sessionType: "main",
    workdir: "/work/beta",
    firstMessage: "another project chat",
    lastActiveAt: new Date("2023-12-01T09:00:00Z"),
    latestTotalTokens: 50,
  },
];

async function sendSlashCommand(command: string) {
  const input = screen.getByTestId("message-input");
  act(() => {
    input.textContent = command;
  });
  await fireInput(input, { data: command, inputType: "insertText" });
  act(() => {
    fireEvent.click(screen.getByTestId("send-btn"));
  });
}

describe("/resume (IDE hosts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens the same popup as the history button over the same list", async () => {
    const { vscode } = renderChatApp();
    act(() => {
      sendCommand("updateSessions", {
        sessions: [
          {
            id: "s1",
            sessionType: "main",
            workdir: "/work/alpha",
            firstMessage: "hello",
            lastActiveAt: new Date("2023-12-01T10:00:00Z"),
            latestTotalTokens: 10,
          },
        ],
      });
    });
    vscode.postMessage.mockClear();

    await sendSlashCommand("/resume");

    // Same popup component + same data source as 「历史对话」(no new host
    // round trip, no message sent to the agent).
    expect(screen.getByTestId("session-list-popup")).toBeInTheDocument();
    expect(screen.getByTestId("session-list-item-s1")).toHaveTextContent(
      "hello",
    );
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );
  });

  it("never widens the list scope with a host request (plugin cannot switch workspace)", async () => {
    const { vscode } = renderChatApp();
    vscode.postMessage.mockClear();

    await sendSlashCommand("/resume");

    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "desktopListResumeSessions" }),
    );
  });

  it("selecting from the /resume list restores through the same path as the header list", async () => {
    const { vscode } = renderChatApp();
    act(() => {
      sendCommand("updateSessions", {
        sessions: [
          {
            id: "s1",
            sessionType: "main",
            workdir: "/work/alpha",
            firstMessage: "hello",
            lastActiveAt: new Date("2023-12-01T10:00:00Z"),
            latestTotalTokens: 10,
          },
        ],
      });
    });
    await sendSlashCommand("/resume");
    vscode.postMessage.mockClear();

    act(() => {
      fireEvent.click(screen.getByTestId("session-list-item-s1"));
    });

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "restoreSession",
      sessionId: "s1",
    });
    expect(screen.queryByTestId("session-list-popup")).not.toBeInTheDocument();
  });

  it("ignores a selection made while streaming (guard shared with the header list)", async () => {
    const { vscode } = renderChatApp();
    act(() => {
      sendCommand("updateSessions", {
        sessions: [
          {
            id: "s1",
            sessionType: "main",
            workdir: "/work/alpha",
            firstMessage: "hello",
            lastActiveAt: new Date("2023-12-01T10:00:00Z"),
            latestTotalTokens: 10,
          },
        ],
      });
    });
    await sendSlashCommand("/resume");
    act(() => {
      sendCommand("startStreaming", {});
    });
    vscode.postMessage.mockClear();

    act(() => {
      fireEvent.click(screen.getByTestId("session-list-item-s1"));
    });

    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "restoreSession" }),
    );
  });
});

describe("/resume (desktop)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderDesktop() {
    const vscode = createMockVscode();
    render(<DesktopApp vscode={vscode} />);
    sendCommand("desktopWorkdirState", {
      workdir: "/work/alpha",
      recentWorkdirs: ["/work/alpha"],
    });
    sendCommand("setInitialState", { messages: [], isAuthenticated: true });
    return vscode;
  }

  it("asks the host for the on-disk session list and renders the reply in a centered modal", async () => {
    const vscode = renderDesktop();
    vscode.postMessage.mockClear();

    await sendSlashCommand("/resume");

    const request = vscode.postMessage.mock.calls
      .map((c) => c[0])
      .find((m) => m.command === "desktopListResumeSessions");
    expect(request).toBeTruthy();
    // Modal (not the header dropdown — desktop has no session buttons).
    expect(screen.getByTestId("resume-session-popup")).toBeInTheDocument();
    expect(screen.getByText("正在加载...")).toBeInTheDocument();

    act(() => {
      sendCommand("desktopResumeSessions", {
        requestId: request.requestId,
        sessions: diskSessions,
      });
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("session-list-item-cli-created"),
      ).toBeInTheDocument();
    });
    // Sessions this app never created appear, with their project path — that is
    // what makes them reachable and distinguishable.
    expect(
      screen.getByTestId("session-list-item-other-project"),
    ).toHaveTextContent("/work/beta");
  });

  it("posts desktopResumeSession with the session's own workdir on selection", async () => {
    const vscode = renderDesktop();
    await sendSlashCommand("/resume");
    const request = vscode.postMessage.mock.calls
      .map((c) => c[0])
      .find((m) => m.command === "desktopListResumeSessions");
    act(() => {
      sendCommand("desktopResumeSessions", {
        requestId: request.requestId,
        sessions: diskSessions,
      });
    });
    vscode.postMessage.mockClear();

    act(() => {
      fireEvent.click(screen.getByTestId("session-list-item-other-project"));
    });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "desktopResumeSession",
        sessionId: "other-project",
        workdir: "/work/beta",
      }),
    );
    expect(
      screen.queryByTestId("resume-session-popup"),
    ).not.toBeInTheDocument();
  });

  it("drops a stale reply (an older scan must not populate the picker)", async () => {
    const vscode = renderDesktop();
    await sendSlashCommand("/resume");
    const firstRequest = vscode.postMessage.mock.calls
      .map((c) => c[0])
      .find((m) => m.command === "desktopListResumeSessions");
    // The user closes and reopens the picker: a new request id supersedes it.
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    await sendSlashCommand("/resume");

    act(() => {
      sendCommand("desktopResumeSessions", {
        requestId: firstRequest.requestId,
        sessions: diskSessions,
      });
    });

    expect(
      screen.queryByTestId("session-list-item-cli-created"),
    ).not.toBeInTheDocument();
  });

  it("closes instead of showing an empty list when the host could not be read", async () => {
    const vscode = renderDesktop();
    await sendSlashCommand("/resume");
    const request = vscode.postMessage.mock.calls
      .map((c) => c[0])
      .find((m) => m.command === "desktopListResumeSessions");

    act(() => {
      sendCommand("desktopResumeSessions", {
        requestId: request.requestId,
        error: "host unreachable",
      });
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("resume-session-popup"),
      ).not.toBeInTheDocument();
    });
    expect(screen.queryByText("未找到匹配的历史记录")).not.toBeInTheDocument();
  });
});

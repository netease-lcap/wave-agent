/**
 * 侧栏会话**正文**搜索与「跳到那一条」（spec desktop/desktop-sessions.md
 * 「侧栏会话内容搜索」）。
 *
 * 这里验的是界面这一层：什么时候发请求、结果区怎么分两段、点了命中之后是否真的
 * 落到那条消息上（会话内查找条以该关键词预填并落在该命中）。扫盘本身在
 * `packages/desktop/tests/sessionContentSearch.test.ts` 里单测。
 */

import { describe, it, expect } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendCommand } from "./test-utils";

const userMsg = (content: string, id: string) => ({
  id,
  role: "user" as const,
  timestamp: "2025-01-01T00:00:00.000Z",
  blocks: [{ type: "text", content }],
});

const assistantMsg = (content: string, id: string) => ({
  id,
  role: "assistant" as const,
  timestamp: "2025-01-01T00:00:00.000Z",
  blocks: [{ type: "text", content }],
});

function renderApp() {
  const vscode = createMockVscode();
  render(<DesktopApp vscode={vscode} />);
  sendCommand("desktopWorkdirState", {
    workdir: "/work/a",
    recentWorkdirs: ["/work/a"],
  });
  sendCommand("desktopSessionTree", {
    groups: [
      {
        host: "local",
        workdir: "/work/a",
        sessions: [
          {
            sessionId: "s1",
            title: "连接池排查",
            lastActiveAt: Date.now(),
            hasWorktree: false,
          },
        ],
      },
      {
        // 远端会话：转录在远端 daemon 上，宿主读不到，语言上也不该被送进请求。
        host: "build-box",
        workdir: "/srv/app",
        sessions: [
          {
            sessionId: "r1",
            title: "远端构建",
            lastActiveAt: Date.now(),
            hasWorktree: false,
          },
        ],
      },
    ],
  });
  return vscode;
}

type MockVscode = ReturnType<typeof createMockVscode>;

const contentRequests = (vscode: MockVscode) =>
  vscode.postMessage.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((msg) => msg?.command === "desktopSearchSessionContents");

const searchBox = () =>
  screen.getByTestId("desktop-session-search") as HTMLInputElement;

const typeQuery = (value: string) =>
  fireEvent.change(searchBox(), { target: { value } });

const isIdle = () => new Promise((resolve) => setTimeout(resolve, 420));

describe("侧栏会话内容搜索", () => {
  it("关键词不足 2 个字符不发请求，够长才防抖后发一次（不送远端会话）", async () => {
    const vscode = renderApp();

    typeQuery("池");
    await isIdle();
    expect(contentRequests(vscode)).toHaveLength(0);
    expect(screen.queryByTestId("desktop-content-hits")).toBeNull();

    typeQuery("连接池");
    await waitFor(() => expect(contentRequests(vscode)).toHaveLength(1));
    const request = contentRequests(vscode)[0];
    expect(request.query).toBe("连接池");
    // 远端的会话不参与正文搜索（场景 10）。
    expect(request.sessionIds).toEqual(["s1"]);
  });

  it("搜索中给「正在搜索会话内容…」，回包后平铺「内容命中」并高亮命中词", async () => {
    const vscode = renderApp();
    typeQuery("连接池");

    expect(
      screen.getByTestId("desktop-content-hits-searching").textContent,
    ).toContain("正在搜索会话内容");

    await waitFor(() => expect(contentRequests(vscode)).toHaveLength(1));
    const { requestId } = contentRequests(vscode)[0];
    act(() => {
      sendCommand("desktopSessionContentMatches", {
        requestId,
        query: "连接池",
        matches: [
          {
            sessionId: "s1",
            hitCount: 2,
            snippets: [
              { text: "排查连接池耗尽", offset: 2, length: 3, hitIndex: 0 },
              { text: "连接池配置改小", offset: 0, length: 3, hitIndex: 1 },
            ],
          },
        ],
      });
    });

    const hits = screen.getByTestId("desktop-content-hits");
    expect(hits.textContent).toContain("连接池排查"); // 会话标题
    expect(hits.textContent).toContain("a"); // 所属目录（/work/a 的目录名）
    // 命中词画在 mark 上，两条片段各一处。
    const marks = Array.from(
      hits.querySelectorAll(".desktop-content-hit-mark"),
    ).map((node) => node.textContent);
    expect(marks).toEqual(["连接池", "连接池"]);
  });

  it("点命中项：进入该会话并把查找条预填到那一处", async () => {
    const vscode = renderApp();
    sendCommand("updateCurrentSession", { session: { id: "s1" } });
    sendCommand("updateMessages", {
      messages: [
        userMsg("先看看日志", "m1"),
        assistantMsg("检查发现连接池耗尽，另有一处连接池上限过小", "m2"),
      ],
    });

    typeQuery("连接池");
    await waitFor(() => expect(contentRequests(vscode)).toHaveLength(1));
    const { requestId } = contentRequests(vscode)[0];
    act(() => {
      sendCommand("desktopSessionContentMatches", {
        requestId,
        query: "连接池",
        matches: [
          {
            sessionId: "s1",
            hitCount: 2,
            snippets: [
              { text: "检查发现连接池", offset: 4, length: 3, hitIndex: 1 },
            ],
          },
        ],
      });
    });

    fireEvent.click(screen.getByTestId("desktop-content-hit-s1-1"));

    const select = vscode.postMessage.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((msg) => msg?.command === "desktopSelectSession");
    expect(select).toMatchObject({ workdir: "/work/a", sessionId: "s1" });

    // 查找条以该关键词打开，并且落在第 2 处（hitIndex 是 0 起）。
    await waitFor(() =>
      expect(screen.getByTestId("transcript-find-count").textContent).toBe(
        "2/2",
      ),
    );
    expect(
      (screen.getByTestId("transcript-find-input") as HTMLInputElement).value,
    ).toBe("连接池");
  });

  it("清空关键词：结果区整体消失，迟到的回包不回填", async () => {
    const vscode = renderApp();
    typeQuery("连接池");
    await waitFor(() => expect(contentRequests(vscode)).toHaveLength(1));
    const { requestId } = contentRequests(vscode)[0];

    typeQuery("");
    expect(screen.queryByTestId("desktop-content-hits")).toBeNull();

    act(() => {
      sendCommand("desktopSessionContentMatches", {
        requestId,
        query: "连接池",
        matches: [
          {
            sessionId: "s1",
            hitCount: 1,
            snippets: [{ text: "连接池", offset: 0, length: 3, hitIndex: 0 }],
          },
        ],
      });
    });
    expect(screen.queryByTestId("desktop-content-hits")).toBeNull();
  });

  it("搜索失败给「内容搜索暂不可用」并能重试，不静默成「无结果」", async () => {
    const vscode = renderApp();
    typeQuery("连接池");
    await waitFor(() => expect(contentRequests(vscode)).toHaveLength(1));
    const { requestId } = contentRequests(vscode)[0];

    act(() => {
      sendCommand("desktopSessionContentMatches", {
        requestId,
        query: "连接池",
        matches: [],
        failed: true,
      });
    });

    expect(
      screen.getByTestId("desktop-content-hits-error").textContent,
    ).toContain("内容搜索暂不可用");
    expect(screen.queryByTestId("desktop-content-hits-empty")).toBeNull();

    fireEvent.click(screen.getByTestId("desktop-content-hits-retry"));
    await waitFor(() => expect(contentRequests(vscode)).toHaveLength(2));
  });

  it("标题全无命中但正文有命中时，不显示「未找到匹配的对话」", async () => {
    const vscode = renderApp();
    typeQuery("连接池配置");
    expect(screen.getByTestId("desktop-session-no-match")).toBeTruthy();

    await waitFor(() => expect(contentRequests(vscode)).toHaveLength(1));
    const { requestId } = contentRequests(vscode)[0];
    act(() => {
      sendCommand("desktopSessionContentMatches", {
        requestId,
        query: "连接池配置",
        matches: [
          {
            sessionId: "s1",
            hitCount: 1,
            snippets: [
              { text: "连接池配置改小", offset: 0, length: 5, hitIndex: 0 },
            ],
          },
        ],
      });
    });

    expect(screen.queryByTestId("desktop-session-no-match")).toBeNull();
    expect(screen.getByTestId("desktop-content-hits")).toBeTruthy();
  });
});

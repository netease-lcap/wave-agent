import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendCommand } from "./test-utils";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));
vi.mock("../../src/styles/SessionBoard.css", () => ({}));

/**
 * 侧栏会话搜索与筛选（spec desktop-sessions.md「侧栏会话搜索与筛选」）：
 * 搜索框输入即按会话名过滤（子串、不区分大小写），筛选面板勾完点「确定」才
 * 生效，两者取交集；分组无命中整组隐藏，全无命中给一句提示。
 */
const HOUR = 60 * 60 * 1000;

const session = (
  sessionId: string,
  title: string,
  extra: Record<string, unknown> = {},
) => ({
  sessionId,
  title,
  lastActiveAt: Date.now(),
  hasWorktree: false,
  ...extra,
});

function renderTree() {
  const vscode = createMockVscode();
  render(<DesktopApp vscode={vscode} />);
  sendCommand("desktopWorkdirState", {
    workdir: "/work/a",
    recentWorkdirs: ["/work/a"],
  });
  sendCommand("setInitialState", { messages: [] });
  sendCommand("desktopSessionTree", {
    groups: [
      {
        host: "local",
        workdir: "/work/a",
        sessions: [
          session("s1", "Refactor Payment Service"),
          session("s2", "写登录页单测", {
            createdAt: Date.now() - 3 * 24 * HOUR,
          }),
          session("s3", "排查连接池耗尽", { running: true }),
        ],
      },
      {
        host: "local",
        workdir: "/work/b",
        sessions: [
          session("s4", "payment 回调核对", { waitingConfirmation: true }),
        ],
      },
    ],
  });
  return vscode;
}

const searchBox = () =>
  screen.getByTestId("desktop-session-search") as HTMLInputElement;

const typeQuery = (value: string) =>
  fireEvent.change(searchBox(), { target: { value } });

const visibleSessionIds = () =>
  screen
    .queryAllByTestId(/^desktop-session-item-/)
    .map((el) =>
      el.getAttribute("data-testid")!.replace("desktop-session-item-", ""),
    );

/** 打开筛选面板，勾选给定的状态/日期，再点「确定」。 */
function applyFilter({
  statuses = [] as string[],
  date,
}: {
  statuses?: string[];
  date?: string;
}) {
  fireEvent.click(screen.getByTestId("desktop-session-filter-btn"));
  for (const status of statuses) {
    fireEvent.click(
      screen.getByTestId(`desktop-session-filter-status-${status}`),
    );
  }
  if (date) {
    fireEvent.click(screen.getByTestId(`desktop-session-filter-date-${date}`));
  }
  fireEvent.click(screen.getByTestId("desktop-session-filter-confirm"));
}

describe("侧栏会话搜索", () => {
  it("输入即按会话名子串过滤，不区分大小写，改词即时重新过滤", () => {
    renderTree();
    expect(visibleSessionIds()).toEqual(["s1", "s2", "s3", "s4"]);

    typeQuery("PAYMENT");
    expect(visibleSessionIds()).toEqual(["s1", "s4"]);

    typeQuery("登录");
    expect(visibleSessionIds()).toEqual(["s2"]);

    typeQuery("");
    expect(visibleSessionIds()).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("分组内无命中时整组隐藏（分组标题一并隐藏）", () => {
    renderTree();
    typeQuery("登录");

    expect(visibleSessionIds()).toEqual(["s2"]);
    expect(
      screen.queryByTestId("desktop-session-group-local:/work/b"),
    ).toBeNull();
    expect(
      screen.getByTestId("desktop-session-group-local:/work/a"),
    ).toBeTruthy();
  });

  it("全无命中时给「未找到匹配的对话」，清空关键词后恢复", () => {
    renderTree();
    expect(screen.queryByTestId("desktop-session-no-match")).toBeNull();

    typeQuery("不存在的会话");
    expect(visibleSessionIds()).toEqual([]);
    expect(screen.getByTestId("desktop-session-no-match").textContent).toBe(
      "未找到匹配的对话",
    );

    typeQuery("");
    expect(screen.queryByTestId("desktop-session-no-match")).toBeNull();
    expect(visibleSessionIds()).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("Esc 先清关键词、再按一次失焦", () => {
    renderTree();
    typeQuery("payment");
    expect(visibleSessionIds()).toEqual(["s1", "s4"]);

    fireEvent.keyDown(searchBox(), { key: "Escape" });
    expect(searchBox().value).toBe("");
    expect(visibleSessionIds()).toEqual(["s1", "s2", "s3", "s4"]);
  });
});

describe("侧栏会话筛选", () => {
  it("面板里有会话状态与创建日期两组，勾选后须点「确定」才生效", () => {
    renderTree();
    fireEvent.click(screen.getByTestId("desktop-session-filter-btn"));

    expect(screen.getByTestId("desktop-session-filter-pop")).toBeTruthy();
    for (const status of ["waiting", "running", "done"]) {
      expect(
        screen.getByTestId(`desktop-session-filter-status-${status}`),
      ).toBeTruthy();
    }
    for (const date of ["today", "7d", "30d"]) {
      expect(
        screen.getByTestId(`desktop-session-filter-date-${date}`),
      ).toBeTruthy();
    }

    // 勾了但没点「确定」：列表不动。
    fireEvent.click(
      screen.getByTestId("desktop-session-filter-status-running"),
    );
    expect(visibleSessionIds()).toEqual(["s1", "s2", "s3", "s4"]);

    fireEvent.click(screen.getByTestId("desktop-session-filter-confirm"));
    expect(visibleSessionIds()).toEqual(["s3"]);
  });

  it("会话状态多选取并集（等待中 / 运行中 / 已完成）", () => {
    renderTree();

    // 已完成 = 既没在跑也没等确认的会话（与活动看板同口径）。
    applyFilter({ statuses: ["done"] });
    expect(visibleSessionIds()).toEqual(["s1", "s2"]);

    fireEvent.click(screen.getByTestId("desktop-session-filter-btn"));
    fireEvent.click(
      screen.getByTestId("desktop-session-filter-status-waiting"),
    );
    fireEvent.click(screen.getByTestId("desktop-session-filter-confirm"));
    expect(visibleSessionIds()).toEqual(["s1", "s2", "s4"]);

    fireEvent.click(screen.getByTestId("desktop-session-filter-btn"));
    fireEvent.click(
      screen.getByTestId("desktop-session-filter-status-running"),
    );
    fireEvent.click(screen.getByTestId("desktop-session-filter-confirm"));
    expect(visibleSessionIds()).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("创建日期单选「今天」只留今天创建的会话（无 createdAt 时回落 lastActiveAt）", () => {
    renderTree();
    applyFilter({ date: "today" });

    // s2 是 3 天前创建的；s1/s3/s4 没有 createdAt，按 lastActiveAt（今天）算。
    expect(visibleSessionIds()).toEqual(["s1", "s3", "s4"]);
  });

  it("「重置」只清面板里的勾选，已生效的筛选要再点「确定」才清", () => {
    renderTree();
    applyFilter({ statuses: ["running"], date: "today" });
    expect(visibleSessionIds()).toEqual(["s3"]);

    const filterBtn = screen.getByTestId("desktop-session-filter-btn");
    expect(filterBtn.className).toContain("is-active");
    expect(filterBtn.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(filterBtn);
    // 打开的瞬间回填的是已生效条件。
    expect(
      screen
        .getByTestId("desktop-session-filter-status-running")
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByTestId("desktop-session-filter-reset"));
    // 只清了草稿，列表仍是筛过的。
    expect(visibleSessionIds()).toEqual(["s3"]);

    fireEvent.click(screen.getByTestId("desktop-session-filter-confirm"));
    expect(visibleSessionIds()).toEqual(["s1", "s2", "s3", "s4"]);
    expect(
      screen.getByTestId("desktop-session-filter-btn").className,
    ).not.toContain("is-active");
  });

  it("搜索与筛选取交集", () => {
    renderTree();
    typeQuery("p");
    applyFilter({ statuses: ["waiting"] });

    expect(visibleSessionIds()).toEqual(["s4"]);

    // 换成只有已完成会话能命中的关键词：交集为空 → 提示语出现。
    typeQuery("登录");
    expect(visibleSessionIds()).toEqual([]);
    expect(screen.getByTestId("desktop-session-no-match")).toBeTruthy();
  });

  it("Esc 关闭面板且不改动已生效的筛选", () => {
    renderTree();
    applyFilter({ statuses: ["done"] });
    expect(visibleSessionIds()).toEqual(["s1", "s2"]);

    fireEvent.click(screen.getByTestId("desktop-session-filter-btn"));
    fireEvent.click(
      screen.getByTestId("desktop-session-filter-status-running"),
    );
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("desktop-session-filter-pop")).toBeNull();
    expect(visibleSessionIds()).toEqual(["s1", "s2"]);
  });
});

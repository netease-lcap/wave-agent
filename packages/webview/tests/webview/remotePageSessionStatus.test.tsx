/**
 * The remote page has no sidebar: its 「会话」 list is the only place that can say
 * 「谁在等我确认、谁还在跑、谁还有后台任务」 (spec remote/remote-web.md「待确认只在它
 * 自己的对话里弹，对话状态在会话列表标出来」+「手机端的会话列表与删除」场景 2).
 * This pins the rendering rule those stories state:
 *
 * - 运行中 marks every generating session **including the one on screen**;
 * - 待确认 marks only the *other* ones — the current conversation already has its
 *   card in front of it, so repeating it in the list adds nothing;
 * - one marker per row, 待确认 > 运行中 > 有后台任务在跑;
 * - and none of it exists when the host sends no status (an older machine).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  fireEvent,
  renderChatApp,
  screen,
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

/** Render the page on session-2, deliver the markers, open the 「会话」 page. */
function openPage(status?: {
  waiting: string[];
  running: string[];
  background?: string[];
}) {
  window.waveRemotePage = true;
  renderChatApp();
  act(() => {
    sendHostMessage(
      fixtures.setInitialState({
        sessions: SESSIONS,
        session: SESSIONS[1],
        sessionStatus: status,
      }),
    );
  });
  act(() => {
    fireEvent.click(screen.getByTestId("session-switch-btn"));
  });
  return screen.getByTestId("remote-session-page");
}

/** The marker slot of one row, as the reader sees it. */
function slot(page: HTMLElement, sessionId: string) {
  return within(page).getByTestId(`remote-session-marker-${sessionId}`);
}

afterEach(() => {
  delete window.waveRemotePage;
});

describe("remote page session status markers", () => {
  it("marks the other conversation as waiting and the current one as running", () => {
    const page = openPage({
      waiting: ["session-1", "session-2"],
      running: ["session-2"],
    });

    // Both sets contain the current conversation, but it shows only its 运行中
    // ring: its own wait is already a card on screen, so a second reminder in the
    // list carries no information.
    expect(
      within(slot(page, "session-1")).getByLabelText("等待确认"),
    ).toBeInTheDocument();
    expect(
      within(slot(page, "session-2")).getByLabelText("正在运行"),
    ).toBeInTheDocument();
    expect(
      within(slot(page, "session-2")).queryByLabelText("等待确认"),
    ).not.toBeInTheDocument();
  });

  it("shows one marker per row, 待确认 over 运行中", () => {
    const page = openPage({
      waiting: ["session-1"],
      running: ["session-1"],
    });

    // 「被审批卡住的对话不算在跑」— the desktop sidebar's priority, kept here so a
    // double-marked row cannot appear.
    expect(
      within(slot(page, "session-1")).getByLabelText("等待确认"),
    ).toBeInTheDocument();
    expect(
      within(slot(page, "session-1")).queryByLabelText("正在运行"),
    ).not.toBeInTheDocument();
  });

  it("marks a background run without waiting on anything", () => {
    const page = openPage({ waiting: [], running: ["session-1"] });

    expect(
      within(slot(page, "session-1")).getByLabelText("正在运行"),
    ).toBeInTheDocument();
  });

  it("marks a foreground-idle session that still owns a background task", () => {
    // 「看起来静止、其实还在干活」—— 前台回合结束、后台任务还在跑，这是「它还在动」
    // 的唯一信号，不能显示成静止（spec 场景 2）。
    const page = openPage({
      waiting: [],
      running: [],
      background: ["session-1"],
    });

    expect(
      within(slot(page, "session-1")).getByLabelText("有后台任务在跑"),
    ).toBeInTheDocument();
  });

  it("puts 运行中 above 有后台任务在跑 for the same row", () => {
    const page = openPage({
      waiting: [],
      running: ["session-1"],
      background: ["session-1"],
    });

    expect(
      within(slot(page, "session-1")).getByLabelText("正在运行"),
    ).toBeInTheDocument();
    expect(
      within(slot(page, "session-1")).queryByLabelText("有后台任务在跑"),
    ).not.toBeInTheDocument();
  });

  it("renders no marker at all when the host sends no status", () => {
    const page = openPage();

    // An older machine answers `listDaemonSessions` without the marker facts:
    // no empty slot, no placeholder — the element is not rendered.
    expect(
      within(page).queryByTestId("remote-session-marker-session-1"),
    ).not.toBeInTheDocument();
    expect(within(page).getByText("另一个项目的会话")).toBeInTheDocument();
  });

  it("follows a later marker broadcast without rebuilding the list", () => {
    const page = openPage();

    act(() => {
      sendHostMessage(
        fixtures.updateSessionStatus(["session-1"], ["session-2"]),
      );
    });

    expect(
      within(slot(page, "session-1")).getByLabelText("等待确认"),
    ).toBeInTheDocument();
  });
});

/**
 * The remote page has no sidebar: its 「会话」 popup is the only place that can
 * say 「谁在等我确认、谁还在跑」 (spec remote-control.md「待确认只在它自己的对话里
 * 弹，对话状态在会话列表标出来」). This pins the rendering rule that story states:
 *
 * - 运行中 marks every generating session **including the one on screen**;
 * - 待确认 marks only the *other* ones — the current conversation already has its
 *   card in front of it, so repeating it in the list adds nothing;
 * - one marker per row, 待确认 > 运行中;
 * - and none of it exists for the four IDE/desktop hosts, which pass no status.
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

/** Render the page on session-2, deliver the markers, open the 「会话」 popup. */
function openPopup(status?: { waiting: string[]; running: string[] }) {
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
  return screen.getByTestId("session-list-popup");
}

/** The marker slot of one row, as the reader sees it. */
function slot(popup: HTMLElement, sessionId: string) {
  return within(popup).getByTestId(`session-list-status-${sessionId}`);
}

afterEach(() => {
  delete window.waveRemotePage;
});

describe("remote page session status markers", () => {
  it("marks the other conversation as waiting and the current one as running", () => {
    const popup = openPopup({
      waiting: ["session-1", "session-2"],
      running: ["session-2"],
    });

    // Both sets contain the current conversation, but it shows only its 运行中
    // ring: its own wait is already a card on screen, so a second reminder in the
    // list carries no information.
    expect(
      within(slot(popup, "session-1")).getByLabelText("等待确认"),
    ).toBeInTheDocument();
    expect(
      within(slot(popup, "session-2")).getByLabelText("正在运行"),
    ).toBeInTheDocument();
    expect(
      within(slot(popup, "session-2")).queryByLabelText("等待确认"),
    ).not.toBeInTheDocument();
  });

  it("shows one marker per row, 待确认 over 运行中", () => {
    const popup = openPopup({
      waiting: ["session-1"],
      running: ["session-1"],
    });

    // 「被审批卡住的对话不算在跑」— the desktop sidebar's priority, kept here so a
    // double-marked row cannot appear.
    expect(
      within(slot(popup, "session-1")).getByLabelText("等待确认"),
    ).toBeInTheDocument();
    expect(
      within(slot(popup, "session-1")).queryByLabelText("正在运行"),
    ).not.toBeInTheDocument();
  });

  it("marks a background run without waiting on anything", () => {
    const popup = openPopup({ waiting: [], running: ["session-1"] });

    expect(
      within(slot(popup, "session-1")).getByLabelText("正在运行"),
    ).toBeInTheDocument();
  });

  it("renders no marker slot at all when the host sends no status", () => {
    const popup = openPopup();

    // The four IDE/desktop hosts share this list and must keep the row they had:
    // no empty slot, no placeholder — the marker element is not rendered when
    // there is nothing to mark.
    expect(
      within(popup).queryByTestId("session-list-status-session-1"),
    ).not.toBeInTheDocument();
    expect(within(popup).getByText("另一个项目的会话")).toBeInTheDocument();
  });

  it("follows a later marker broadcast without rebuilding the list", () => {
    const popup = openPopup();

    act(() => {
      sendHostMessage(
        fixtures.updateSessionStatus(["session-1"], ["session-2"]),
      );
    });

    expect(
      within(slot(popup, "session-1")).getByLabelText("等待确认"),
    ).toBeInTheDocument();
  });
});

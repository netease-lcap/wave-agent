/**
 * The 通知 entry in the remote page's 更多 menu (spec remote/remote-pwa.md
 * 「锁屏也能知道——会话等着我、或者跑完了」场景 6/7).
 *
 * The page is the only host with a browser subscription to switch, so the entry
 * is gated on that host alone — the four local hosts render no such line. What
 * the line *says* is driven entirely by the shim's `pushState`: an actionable
 * entry while the browser can hold a subscription, and, when it cannot, a
 * passive note naming the reason (add to home screen / this browser / refused
 * permission), because those three are three different next steps.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  fireEvent,
  renderChatApp,
  screen,
  sendHostMessage,
} from "./test-utils";
import { fixtures } from "wave-webview-fixtures";

type PushState = Parameters<typeof fixtures.updatePushState>[0];

/** Render the page, deliver a push state, and open the 更多 menu. */
function openMoreMenu(state?: PushState) {
  window.waveRemotePage = true;
  const rendered = renderChatApp();
  act(() => {
    sendHostMessage(
      fixtures.setInitialState({ sessions: [], session: undefined }),
    );
  });
  if (state) act(() => sendHostMessage(fixtures.updatePushState(state)));
  act(() => {
    fireEvent.click(screen.getByTestId("more-btn"));
  });
  return rendered;
}

const CAN: PushState = {
  supported: true,
  subscribed: false,
  needsHomeScreen: false,
  reason: "",
};

/** The commands the webview sent, in order. */
function commands(vscode: ReturnType<typeof renderChatApp>["vscode"]) {
  return vscode.postMessage.mock.calls.map(
    (call) => (call[0] as { command?: string }).command,
  );
}

afterEach(() => {
  delete window.waveRemotePage;
});

describe("remote page push notification entry", () => {
  it("asks the shim for the state on mount", () => {
    window.waveRemotePage = true;
    const { vscode } = renderChatApp();

    // The page does not guess: the browser capability and the subscription id
    // live in the shim, so the menu has no state to render until this answers.
    expect(commands(vscode)).toContain("getPushState");
  });

  it("offers 开启通知 and sends the enable command", () => {
    const { vscode } = openMoreMenu(CAN);

    const entry = screen.getByTestId("more-menu-push-on");
    expect(entry.textContent).toContain("开启通知");
    act(() => {
      fireEvent.click(entry);
    });

    expect(commands(vscode)).toContain("enablePushNotifications");
  });

  it("offers 关闭通知 once subscribed, and sends the disable command", () => {
    const { vscode } = openMoreMenu({ ...CAN, subscribed: true });

    const entry = screen.getByTestId("more-menu-push-off");
    expect(entry.textContent).toContain("关闭通知");
    act(() => {
      fireEvent.click(entry);
    });

    expect(commands(vscode)).toContain("disablePushNotifications");
  });

  it("tells an iOS tab to add the page to the home screen first", () => {
    openMoreMenu({ ...CAN, supported: false, needsHomeScreen: true });

    // 场景 7: not a silent failure and not 「不支持」 — the capability is missing
    // for a reason the user can fix, and the page says which one.
    expect(screen.getByTestId("more-menu-push-note").textContent).toContain(
      "添加到主屏幕",
    );
    expect(screen.queryByTestId("more-menu-push-on")).toBeNull();
    expect(screen.queryByTestId("more-menu-push-off")).toBeNull();
  });

  it("says so when the browser simply cannot, and when permission was refused", () => {
    const browser = openMoreMenu({ ...CAN, supported: false });
    expect(screen.getByTestId("more-menu-push-note").textContent).toContain(
      "此浏览器不支持",
    );
    browser.unmount();

    openMoreMenu({ ...CAN, reason: "denied" });
    // Refused permission cannot be re-prompted from here; the browser's own
    // settings is the only place it can be undone, so that is what it says.
    expect(screen.getByTestId("more-menu-push-note").textContent).toContain(
      "浏览器设置",
    );
    expect(screen.queryByTestId("more-menu-push-on")).toBeNull();
  });

  it("offers a retry after a failed attempt instead of claiming it is on", () => {
    const { vscode } = openMoreMenu({ ...CAN, reason: "failed" });

    const entry = screen.getByTestId("more-menu-push-on");
    expect(entry.textContent).toContain("重试");
    act(() => {
      fireEvent.click(entry);
    });

    expect(commands(vscode)).toContain("enablePushNotifications");
  });

  it("also says 重试 when it was a revocation that failed", () => {
    // The relay still has the subscription, so the switch is genuinely still on
    // — and the label has to carry that the last attempt did not take, or the
    // user reads a failed 关闭 as "nothing happened".
    openMoreMenu({ ...CAN, subscribed: true, reason: "failed" });

    expect(screen.getByTestId("more-menu-push-off").textContent).toContain(
      "重试",
    );
  });

  it("renders nothing before the shim has answered", () => {
    openMoreMenu();

    // A state we do not have yet is not a state: showing 「开启通知」 for a phone
    // that cannot use it (or already has it on) would be a lie the next reply
    // immediately contradicts.
    expect(screen.queryByTestId("more-menu-push-on")).toBeNull();
    expect(screen.queryByTestId("more-menu-push-off")).toBeNull();
    expect(screen.queryByTestId("more-menu-push-note")).toBeNull();
  });

  it("stays out of the four local hosts", () => {
    renderChatApp();
    act(() => {
      // Even a stray pushState cannot put a browser switch in front of a host
      // that has no browser subscription.
      sendHostMessage(fixtures.updatePushState(CAN));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("more-btn"));
    });

    expect(screen.queryByTestId("more-menu-push-on")).toBeNull();
    expect(screen.queryByTestId("more-menu-push-note")).toBeNull();
    expect(screen.getByTestId("more-menu-settings")).toBeTruthy();
  });
});

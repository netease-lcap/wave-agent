import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendHostMessage } from "./test-utils";
import { sessionUi } from "../../src/utils/sessionUiStore";
import { fixtures } from "wave-webview-fixtures";
import type { ModPanelTree, ModPanelUpdatePayload } from "wave-agent-sdk/types";

/**
 * 「这一端摊开的是哪个 mod 面板、键盘在哪个」（spec `ecosystem/plugin-mods.md`
 * 「面板的显示与焦点」）。
 *
 * `$.ui.panes()` 的 `isShown` / `isFocused` 只有这条通道能填：webview 每变一次就
 * 发一份**全量快照** `modPaneView`，引擎只存一组、后报的生效。于是这几件事都算
 * 状态变化，都要发：面板槽折叠 / 摊开、切到别的 tab、焦点进出面板正文。
 */

const TAB_ID = "mod:todo:panel:p1";

const payload = (
  overrides: Partial<ModPanelUpdatePayload> = {},
): ModPanelUpdatePayload => ({
  sessionId: "s1",
  modId: "todo:panel",
  paneId: "p1",
  title: "待办",
  revision: 1,
  stale: true,
  ...overrides,
});

const TREE: ModPanelTree = { type: "Text", props: {}, children: ["Hello"] };

function renderDesktop() {
  window.waveHostType = "desktop";
  const vscode = createMockVscode();
  const view = render(<DesktopApp vscode={vscode} />);
  sendHostMessage(fixtures.desktopWorkdirState({ workdir: "/work/a" }));
  sendHostMessage(fixtures.authStatusResponse());
  return { vscode, unmount: view.unmount };
}

/** 开一块面板：元信息到达（surface 自己去拉帧）→ 宿主回这一帧。 */
function openPanel() {
  sendHostMessage(fixtures.desktopModPanelUpdate(payload()));
  sendHostMessage(
    fixtures.desktopModPanelRender(TAB_ID, { tree: TREE, revision: 1 }),
  );
}

/** webview→host 的每一次「显示与焦点」上报，按发生顺序。 */
const views = (vscode: ReturnType<typeof createMockVscode>) =>
  vscode.postMessage.mock.calls
    .map(([msg]) => msg as Record<string, unknown>)
    .filter((msg) => msg.command === "modPaneView")
    .map((msg) => msg.payload as { shown: unknown; focused: unknown });

const lastView = (vscode: ReturnType<typeof createMockVscode>) => {
  const all = views(vscode);
  return all[all.length - 1];
};

const PANE_REF = { modId: "todo:panel", paneId: "p1" };

afterEach(() => {
  delete window.waveHostType;
  // 面板 tab 与「摊开没」都按会话缓存在模块级 `SessionUiStore` 里，跨用例存活：
  // 不清的话上一个用例留下的 tab 会抢走 active 位置。
  sessionUi.prune(new Set());
});

describe("webview 上报 mod 面板的显示与焦点", () => {
  it("刚挂载就报一次「谁也没有」，不等人来问", () => {
    const { vscode } = renderDesktop();

    // 装载细节（工作目录先到、组件再挂一次）会让它多发一遍：重要的是**报的内容**
    // —— 没人开面板时绝不能编一个看着像真的值。
    expect(views(vscode).length).toBeGreaterThan(0);
    expect(
      views(vscode).every((v) => v.shown === null && v.focused === null),
    ).toBe(true);
  });

  it("mod 开面板会自动摊开（报 shown），用户收起就报 null", () => {
    const { vscode } = renderDesktop();
    openPanel();

    // 开一块面板会顺手把面板槽摊开，所以这里立刻就有 shown。
    expect(lastView(vscode)).toEqual({ shown: PANE_REF, focused: null });

    // 收起只是这一端不画了：tab 还在，但 `isShown` 该是 false。
    fireEvent.click(screen.getByLabelText("收起面板"));
    expect(lastView(vscode)).toEqual({ shown: null, focused: null });
  });

  it("键盘进正文才报 focused", () => {
    const { vscode } = renderDesktop();
    openPanel();
    expect(lastView(vscode)).toEqual({ shown: PANE_REF, focused: null });

    fireEvent.focus(screen.getByTestId("mod-panel"));
    expect(lastView(vscode)).toEqual({ shown: PANE_REF, focused: PANE_REF });
  });

  it("焦点在面板内部挪不算离开，跑到外面才算", () => {
    const { vscode } = renderDesktop();
    openPanel();
    const pane = screen.getByTestId("mod-panel");
    fireEvent.focus(pane);
    expect(lastView(vscode)).toEqual({ shown: PANE_REF, focused: PANE_REF });

    // 面板内部换焦点（输入框 → 按钮）：还是在这块面板里，不发新快照。
    fireEvent.blur(pane, {
      relatedTarget: screen.getByTestId("mod-panel-root"),
    });
    expect(lastView(vscode)).toEqual({ shown: PANE_REF, focused: PANE_REF });

    // 真跑出去了：键盘回输入框，面板还摊着 —— 只动 focused。
    fireEvent.blur(pane, { relatedTarget: document.body });
    expect(lastView(vscode)).toEqual({ shown: PANE_REF, focused: null });
  });

  it("mod 把面板关掉之后两个都报 null", () => {
    const { vscode } = renderDesktop();
    openPanel();
    fireEvent.focus(screen.getByTestId("mod-panel"));
    expect(lastView(vscode)).toEqual({ shown: PANE_REF, focused: PANE_REF });

    sendHostMessage(
      fixtures.desktopModPanelUpdate(payload({ closed: true, revision: 2 })),
    );

    expect(lastView(vscode)).toEqual({ shown: null, focused: null });
  });

  it("焦点翻转之后补拉这一块的一帧，且是报完再拉", () => {
    // `ui.render` 的 `e.props.isFocused` 与 `$.ui.panes()` 同源，但只在**拉那一帧**
    // 时算（spec「`ui.render` 的 `e.props`」）：不补拉，mod 要等下一次无关的重画
    // 才看到键盘进来了。Claude Code 那边 props 一变就重画，这里是同一个语义。
    const { vscode } = renderDesktop();
    openPanel();
    const pulls = () =>
      vscode.postMessage.mock.calls
        .map(([msg]) => msg as Record<string, unknown>)
        .filter((msg) => msg.command === "modPanelRender");
    const before = pulls().length;

    const pane = screen.getByTestId("mod-panel");
    fireEvent.focus(pane);
    expect(pulls()).toHaveLength(before + 1);
    expect(pulls()[before]?.payload).toMatchObject({
      modId: "todo:panel",
      paneId: "p1",
    });
    // 顺序：先把快照报给引擎，引擎才填得出这次 `ui.render` 的 `isFocused`。
    // 判据是「报了焦点之后还有一次拉取」，而不只是「两者都发生过」。
    const sent = vscode.postMessage.mock.calls.map(
      ([msg]) => msg as Record<string, unknown>,
    );
    const reportAt = sent.findIndex(
      (msg) =>
        msg.command === "modPaneView" &&
        (msg.payload as { focused?: unknown }).focused !== null,
    );
    const pullAt = sent.findIndex(
      (msg, index) => index > reportAt && msg.command === "modPanelRender",
    );
    expect(reportAt).toBeGreaterThanOrEqual(0);
    expect(pullAt).toBeGreaterThan(reportAt);

    // 焦点没真翻（在面板内部换一个控件）不再多拉一帧。
    fireEvent.blur(pane, {
      relatedTarget: screen.getByTestId("mod-panel-root"),
    });
    expect(pulls()).toHaveLength(before + 1);
  });
});

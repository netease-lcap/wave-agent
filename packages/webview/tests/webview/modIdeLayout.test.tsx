import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderChatApp, sendHostMessage, createMockVscode } from "./test-utils";
import { sessionUi } from "../../src/utils/sessionUiStore";
import { fixtures } from "wave-webview-fixtures";
import type { ModPanelTree, ModPanelUpdatePayload } from "wave-agent-sdk/types";

/**
 * IDE 聊天面板里的 mod 面板与「输入框上方那个栈」（spec
 * `ecosystem/plugin-mods.md`「在 IDE 插件里画」）。
 *
 * 与桌面端同一份数据源（`desktopMod*` 那套消息），只有摆法不同：宽于 800px 时
 * dock 在对话右侧、下面窄了落到输入框上方；带、状态行、toast 在桌面端是三处
 * 落点，这一端收进 `mod-ide-stack` 一个栈。所以这些用例钉的是**落点与请求里
 * 报上去的摆法**，树本身怎么校验在 SDK 侧。
 */

/** jsdom 没有 matchMedia：装一个只能回答一条查询的假实现（`useMediaQuery` 用它）。 */
function setWide(wide: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: wide,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function renderPluginHost() {
  delete window.waveHostType; // 插件端（VS Code / JetBrains 都用这份 webview）
  return renderChatApp(createMockVscode());
}

const text = (value: string): ModPanelTree => ({
  type: "Text",
  props: {},
  children: [value],
});

const panelUpdate = (
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

/** 一次完整往返：元信息（stale）→ surface 自己发请求 → 宿主回包。 */
function openPanel(
  tree: ModPanelTree | null,
  modId = "todo:panel",
  paneId = "p1",
  revision = 1,
): void {
  sendHostMessage(
    fixtures.desktopModPanelUpdate(panelUpdate({ modId, paneId, revision })),
  );
  sendHostMessage(
    fixtures.desktopModPanelRender(`mod:${modId}:${paneId}`, {
      tree,
      revision,
    }),
  );
}

const renderRequests = (vscode: ReturnType<typeof createMockVscode>) =>
  vscode.postMessage.mock.calls
    .map(([msg]) => msg as Record<string, unknown>)
    .filter((m) => m.command === "modPanelRender")
    .map((m) => m.payload as Record<string, unknown>);

const events = (vscode: ReturnType<typeof createMockVscode>) =>
  vscode.postMessage.mock.calls
    .map(([msg]) => msg as Record<string, unknown>)
    .filter((m) => m.command === "modPanelEvent")
    .map((m) => m.payload as Record<string, unknown>);

/** 最后一条 —— 目标 lib 里没有 `Array.prototype.at`。 */
const last = <T,>(list: T[]): T => list[list.length - 1];

afterEach(() => {
  delete window.waveHostType;
  delete (window as { matchMedia?: unknown }).matchMedia;
  vi.useRealTimers();
  sessionUi.prune(new Set());
});

describe("IDE 聊天面板里的 mod 面板", () => {
  it("宽面板：dock 在对话右侧，请求里报 placement=dock / isFullscreen", () => {
    setWide(true);
    const { vscode, container } = renderPluginHost();
    openPanel(text("Hello"));

    const panes = screen.getByTestId("mod-ide-panes");
    expect(panes.getAttribute("data-placement")).toBe("dock");
    // dock 那一列挂在 `.ide-chat-wrap` 里（与对话同一行），不在输入框上的栈里。
    expect(
      container.querySelector(".ide-chat-wrap > .mod-ide-panes"),
    ).toBeTruthy();
    expect(
      container.querySelector(".mod-ide-stack [data-testid='mod-ide-panes']"),
    ).toBeNull();
    expect(screen.getByText("Hello")).toBeTruthy();

    const payload = last(renderRequests(vscode));
    expect(payload).toMatchObject({
      modId: "todo:panel",
      paneId: "p1",
      placement: "dock",
      isFullscreen: true,
    });
  });

  it("窄面板：落到输入框上方的栈里，请求里报 placement=inline", () => {
    setWide(false);
    const { vscode, container } = renderPluginHost();
    openPanel(text("Hello"));

    const panes = screen.getByTestId("mod-ide-panes");
    expect(panes.getAttribute("data-placement")).toBe("inline");
    expect(container.querySelector(".mod-ide-stack > .mod-ide-panes")).toBe(
      panes,
    );
    expect(
      container.querySelector(".ide-chat-wrap > .mod-ide-panes"),
    ).toBeNull();

    expect(last(renderRequests(vscode))).toMatchObject({
      placement: "inline",
    });
  });

  it("面板请求带上这一端量到的字符宽高（视口 + 面板自己的正文宽）", () => {
    setWide(true);
    const { vscode } = renderPluginHost();
    // 第一帧请求发出时面板还没挂上 DOM（React 的 state 更新还没落到 DOM），所以
    // 量到宽度之后会再拉一帧 —— 最后一帧三个数齐了（spec「`ui.render` 的
    // `e.props`」：surface 实测上报，不是插件侧猜）。
    openPanel(text("Hello"));

    const payload = last(renderRequests(vscode));
    expect(typeof payload.columns).toBe("number");
    expect(typeof payload.rows).toBe("number");
    expect(typeof payload.bodyColumns).toBe("number");
    // 真 Chromium、1280×800 视口、面板 12px：几百列、几十行；面板比视口窄。
    expect(payload.columns as number).toBeGreaterThan(100);
    expect(payload.rows as number).toBeGreaterThan(20);
    expect(payload.bodyColumns as number).toBeLessThan(
      payload.columns as number,
    );
  });

  it("带也报这一端多大：modBandRender 带 columns / rows / bodyColumns", () => {
    setWide(true);
    const { vscode } = renderPluginHost();
    // 挂载那一次拉取发生在栈还没量出宽度之前（只报视口），所以再触发一次
    // 「这个 mod 的画变了」—— 带的重拉会带上栈那一列的实测宽。
    sendHostMessage(fixtures.desktopModPanelUpdate(panelUpdate()));

    const requests = vscode.postMessage.mock.calls
      .map(([msg]) => msg as Record<string, unknown>)
      .filter((m) => m.command === "modBandRender")
      .map((m) => m.payload as Record<string, unknown>);
    expect(requests.length).toBeGreaterThan(1);
    const payload = last(requests);
    expect(typeof payload.columns).toBe("number");
    expect(typeof payload.rows).toBe("number");
    expect(typeof payload.bodyColumns).toBe("number");
    // 带与输入卡同列（栈最大 800px），比整个视口窄。
    expect(payload.bodyColumns as number).toBeLessThan(
      payload.columns as number,
    );
  });

  it("带、状态行、提示在 IDE 端同处一个栈（桌面端是三处落点）", () => {
    setWide(true);
    renderPluginHost();

    sendHostMessage(
      fixtures.desktopModBand([
        {
          modId: "todo:band",
          plugin: "todo",
          revision: 1,
          tree: { type: "Text", props: {}, children: ["ctx 62%"] },
        },
      ]),
    );
    sendHostMessage(
      fixtures.desktopModStatus({
        sessionId: "s1",
        modId: "todo:panel",
        plugin: "todo",
        text: "3 项待办",
      }),
    );
    sendHostMessage(
      fixtures.desktopModToast({
        sessionId: "s1",
        modId: "todo:panel",
        plugin: "todo",
        text: "已刷新",
        timeoutMs: 4000,
      }),
    );

    const stack = screen.getByTestId("mod-ide-stack");
    expect(stack.querySelector("[data-testid='mod-band']")).toBeTruthy();
    expect(stack.querySelector("[data-testid='mod-status']")).toBeTruthy();
    expect(stack.querySelector("[data-testid='mod-toast']")).toBeTruthy();
    expect(screen.getByText("ctx 62%")).toBeTruthy();
    // 状态行在栈里是竖排那一种（不做桌面端的「+N」收起）。
    expect(screen.getByTestId("mod-status").getAttribute("data-variant")).toBe(
      "stack",
    );
  });

  it("IDE 端要遵守更宽的字符上限：status 200、toast 500", () => {
    setWide(true);
    renderPluginHost();
    const longStatus = "状".repeat(260);
    const longToast = "提".repeat(600);

    sendHostMessage(
      fixtures.desktopModStatus({
        sessionId: "s1",
        modId: "todo:panel",
        plugin: "todo",
        text: longStatus,
      }),
    );
    sendHostMessage(
      fixtures.desktopModToast({
        sessionId: "s1",
        modId: "todo:panel",
        plugin: "todo",
        text: longToast,
        timeoutMs: 4000,
      }),
    );

    const status = screen
      .getByTestId("mod-status")
      .querySelector(".mod-status-text");
    expect(status?.textContent).toBe(`${"状".repeat(199)}…`);
    const toast = screen
      .getByTestId("mod-toast")
      .querySelector(".mod-toast-text");
    expect(toast?.textContent).toBe(`${"提".repeat(499)}…`);
  });

  it("多开时出 tab 栏，激活的那个才画（其余保持挂载）", () => {
    setWide(true);
    renderPluginHost();
    openPanel(text("第一块"), "todo:panel", "p1");
    openPanel(text("第二块"), "note:panel", "p2");

    const tablist = screen.getByRole("tablist");
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBe(2);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");

    fireEvent.click(tabs[0]);
    expect(screen.getAllByRole("tab")[0].getAttribute("aria-selected")).toBe(
      "true",
    );
    // 两块都还在 DOM 里（切回来草稿与滚动位置不丢），只有激活的可见。
    const panes = document.querySelectorAll(".mod-ide-pane");
    expect(panes.length).toBe(2);
    expect((panes[0] as HTMLElement).style.display).not.toBe("none");
    expect((panes[1] as HTMLElement).style.display).toBe("none");
    expect(tablist).toBeTruthy();
  });

  it("面板里的点击以 modId + paneId 回传（宿主再转给 mod）", () => {
    setWide(true);
    const { vscode } = renderPluginHost();
    openPanel({
      type: "Button",
      props: { key: "refresh", label: "刷新" },
      children: [],
    });

    fireEvent.click(screen.getByText("刷新"));
    expect(last(events(vscode))).toMatchObject({
      modId: "todo:panel",
      paneId: "p1",
      key: "refresh",
      kind: "press",
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { MOD_BAND_INSTANCE_ID } from "wave-agent-sdk/types";
import type {
  ModBandRenderResult,
  ModPanelRenderResult,
  ModPanelUpdatePayload,
  ModTreeNode,
} from "wave-agent-sdk/types";
import { cleanup, render } from "../helpers/inkHarness.js";

const chat = vi.hoisted(() => ({
  modPanes: [] as ModPanelUpdatePayload[],
  modFocusPaneId: null as string | null,
  setModFocusPaneId: vi.fn(),
  renderModPanel: vi.fn(),
  renderModBand: vi.fn().mockResolvedValue([]),
  sendModPanelEvent: vi.fn(),
  reportModPaneView: vi.fn(),
}));

vi.mock("../../src/contexts/useChat.js", () => ({ useChat: () => chat }));

const { ModSurface } = await import("../../src/components/mods/ModSurface.js");

function node(
  type: ModTreeNode["type"],
  props: Record<string, unknown> = {},
  children: Array<ModTreeNode | string> = [],
): ModTreeNode {
  return { type, props, children } as unknown as ModTreeNode;
}

function pane(paneId: string, title: string): ModPanelUpdatePayload {
  return {
    sessionId: "s1",
    modId: "todo:index",
    paneId,
    title,
    revision: 1,
    stale: true,
  };
}

/** 刷几帧让首个渲染的树落地（`renderModPanel` 是异步的）。 */
async function settleFrames(view: { settle: () => Promise<number> }) {
  await view.settle();
  await view.settle();
}

describe("ModSurface（终端的插件渲染区）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chat.modFocusPaneId = null;
    chat.modPanes = [];
    chat.renderModPanel.mockImplementation(
      async (modId: string, paneId: string): Promise<ModPanelRenderResult> => ({
        modId,
        paneId,
        revision: 1,
        tree: node("Text", {}, [`${paneId} 的正文`]),
      }),
    );
    chat.renderModBand.mockImplementation(
      async (): Promise<ModBandRenderResult[]> => [],
    );
    // 一次交互的回执：默认「mod 不接」——按 Esc 时就该真收起来。
    chat.sendModPanelEvent.mockImplementation(async () => ({}));
  });

  it("只有一个面板时不画切换行，正文按面板拉树", async () => {
    chat.modPanes = [pane("main", "待办")];
    const { lastFrame } = render(<ModSurface part="pane" />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("main 的正文");
    });
    expect(lastFrame()).not.toContain("1: 待办");
    // 拉树时顺带报版面事实：`bodyRows` 是面板正文这一帧真能用的行数（量不到就
    // 由引擎给缺省值），`columns` / `rows` 是整块画布。
    expect(chat.renderModPanel).toHaveBeenCalledWith("todo:index", "main", {
      placement: "inline",
      columns: 100,
      rows: 24,
      bodyRows: 8,
      bodyColumns: 98,
    });
  });

  it("多个面板时顶部一行可切换（数字键 + tab）", async () => {
    chat.modPanes = [pane("main", "待办"), pane("check", "检查")];
    const { lastFrame, stdin, rerender, settle } = render(
      <ModSurface part="pane" />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("1: 待办");
    });
    expect(lastFrame()).toContain("2: 检查");

    // 键盘不在面板里时数字是打字，不该切面板。
    stdin.write("2");
    await settle();
    expect(chat.setModFocusPaneId).not.toHaveBeenCalled();

    // `$.ui.open({ focus: true })` 之后才归面板。
    chat.modFocusPaneId = "main";
    rerender(<ModSurface part="pane" />);
    await settle();
    stdin.write("2");
    await settle();
    expect(chat.setModFocusPaneId).toHaveBeenCalledWith("check");
  });

  it("Esc 先问 mod（ui.close），mod 不拦才收起这块面板", async () => {
    chat.modPanes = [pane("main", "待办")];
    chat.modFocusPaneId = "main";
    const { lastFrame, stdin } = render(<ModSurface part="pane" />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("main 的正文");
    });

    stdin.write("\u001B");
    await vi.waitFor(() => {
      expect(chat.setModFocusPaneId).toHaveBeenCalledWith(null);
    });
    // 回执是一趟异步（mod 那边先跑 ui.close），收起会晚一帧。
    await vi.waitFor(() => {
      expect(lastFrame()).not.toContain("main 的正文");
    });
    expect(chat.sendModPanelEvent).toHaveBeenCalledWith(
      "todo:index",
      "main",
      "close",
      "",
      undefined,
      undefined,
    );
  });

  it("带用 MOD_BAND_INSTANCE_ID 的推送，面板区不认它、空树不占位置", async () => {
    chat.modPanes = [pane(MOD_BAND_INSTANCE_ID, "")];
    // 面板区不该把带当成一块 pane 画。
    const paneView = render(<ModSurface part="pane" />);
    await settleFrames(paneView);
    expect(chat.renderModPanel).not.toHaveBeenCalled();
    expect(paneView.lastFrame()).toBe("");

    // 空树（mod 这一帧没有带）也不占位置。
    chat.renderModBand.mockResolvedValue([]);
    const emptyBand = render(<ModSurface part="band" />);
    await vi.waitFor(() => {
      expect(chat.renderModBand).toHaveBeenCalled();
    });
    expect(emptyBand.lastFrame()).toBe("");

    chat.renderModBand.mockResolvedValue([
      {
        modId: "todo:index",
        plugin: "todo",
        instanceId: MOD_BAND_INSTANCE_ID,
        revision: 1,
        tree: node("Text", {}, ["3 项未完成"]),
      },
    ]);
    const bandView = render(<ModSurface part="band" />);
    await vi.waitFor(() => {
      expect(bandView.lastFrame()).toContain("3 项未完成");
    });
  });

  it("没有插件时一个像素都不占", async () => {
    const { lastFrame } = render(<ModSurface part="pane" />);
    expect(lastFrame()).toBe("");
    const band = render(<ModSurface part="band" />);
    expect(band.lastFrame()).toBe("");
  });
});

/**
 * 「这一端摊开的是哪个、键盘在哪个」（spec `ecosystem/plugin-mods.md`
 * 「面板的显示与焦点」）：终端是**进程内** surface，这条通道就是 `$.ui.panes()`
 * 的后两项，所以只画面板的那一份实例负责上报，另一份（带）一个字都不说。
 */
describe("ModSurface 上报显示与焦点", () => {
  beforeEach(() => {
    // 上一个用例挂着的实例还活着：它们共用一个 `chat` 假实现，不清掉的话下面
    // 「焦点变了要多拉一帧」会把别人的拉取一起数进来。
    cleanup();
    vi.clearAllMocks();
    chat.modFocusPaneId = null;
    chat.modPanes = [];
    chat.renderModBand.mockResolvedValue([]);
    chat.renderModPanel.mockImplementation(
      async (modId: string, paneId: string): Promise<ModPanelRenderResult> => ({
        modId,
        paneId,
        revision: 1,
        tree: node("Text", {}, [`${paneId} 的正文`]),
      }),
    );
  });

  it("没有面板时两个都报 null", async () => {
    render(<ModSurface part="pane" />);
    await vi.waitFor(() => expect(chat.reportModPaneView).toHaveBeenCalled());
    expect(chat.reportModPaneView.mock.calls).toEqual([[null, null]]);
  });

  it("有面板就报它；键盘进了正文才带 focused", async () => {
    chat.modPanes = [pane("main", "待办")];
    const view = render(<ModSurface part="pane" />);
    await vi.waitFor(() =>
      expect(chat.reportModPaneView).toHaveBeenCalledTimes(1),
    );
    expect(chat.reportModPaneView).toHaveBeenLastCalledWith(
      { modId: "todo:index", paneId: "main" },
      null,
    );

    chat.modFocusPaneId = "main";
    view.rerender(<ModSurface part="pane" />);
    await vi.waitFor(() =>
      expect(chat.reportModPaneView).toHaveBeenCalledTimes(2),
    );
    expect(chat.reportModPaneView).toHaveBeenLastCalledWith(
      { modId: "todo:index", paneId: "main" },
      { modId: "todo:index", paneId: "main" },
    );
  });

  it("键盘翻进面板之后补拉一帧，且那一帧是在上报之后才拉的", async () => {
    // `e.props.isFocused` 只在**拉那一帧**时算（spec「`ui.render` 的 `e.props`」）。
    // 终端里面板是 `ModSurface` 的子组件、子组件的 effect 先跑：若让 `ModPane`
    // 直接跟着 `focused` 重拉，那一帧会和上报同一次提交里发出去，引擎还不知道
    // 焦点变了。所以由父组件「报完再把令牌加一」，那一帧必然在下一个提交里。
    //
    // 树里画的是「拉的时候已经有几次上报了」—— 这就是判据：挂载时报过一次
    // （shown、focused 都为 null 之外的那份快照），拿到焦点这次是第 2 次，补拉
    // 那一帧必须看得见它；跟着 `focused` 直接重拉的话只会看到 1 次。
    chat.renderModPanel.mockImplementation(
      async (modId: string, paneId: string): Promise<ModPanelRenderResult> => ({
        modId,
        paneId,
        revision: 1,
        tree: node("Text", {}, [
          `正文（上报 ${chat.reportModPaneView.mock.calls.length} 次）`,
        ]),
      }),
    );
    chat.modPanes = [pane("main", "待办")];
    const view = render(<ModSurface part="pane" />);
    await vi.waitFor(() => expect(view.lastFrame()).toContain("上报 0 次"));

    chat.modFocusPaneId = "main";
    view.rerender(<ModSurface part="pane" />);
    await vi.waitFor(() => expect(view.lastFrame()).toContain("上报 2 次"));
    expect(chat.renderModPanel).toHaveBeenCalledTimes(2);

    // 焦点没翻的再渲染不多拉（报的内容没变就不发快照，也就不加令牌）。
    view.rerender(<ModSurface part="pane" />);
    await view.settle();
    expect(chat.renderModPanel).toHaveBeenCalledTimes(2);
  });

  it("Esc 收起之后两个都报 null", async () => {
    chat.modPanes = [pane("main", "待办")];
    chat.modFocusPaneId = "main";
    const { stdin } = render(<ModSurface part="pane" />);
    await vi.waitFor(() =>
      expect(chat.reportModPaneView).toHaveBeenLastCalledWith(
        { modId: "todo:index", paneId: "main" },
        { modId: "todo:index", paneId: "main" },
      ),
    );

    stdin.write("\u001B");
    await vi.waitFor(() =>
      expect(chat.reportModPaneView).toHaveBeenLastCalledWith(null, null),
    );
  });

  it("带那一份实例不掺和（它一说话就把真值盖成 null）", async () => {
    chat.modPanes = [pane("main", "待办")];
    render(<ModSurface part="band" />);
    await vi.waitFor(() => expect(chat.renderModBand).toHaveBeenCalled());
    expect(chat.reportModPaneView).not.toHaveBeenCalled();
  });
});

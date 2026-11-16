import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { MOD_BAND_INSTANCE_ID } from "wave-agent-sdk/types";
import type {
  ModBandRenderResult,
  ModPanelRenderResult,
  ModPanelUpdatePayload,
  ModTreeNode,
} from "wave-agent-sdk/types";
import { render } from "../helpers/inkHarness.js";

const chat = vi.hoisted(() => ({
  modPanes: [] as ModPanelUpdatePayload[],
  modFocusPaneId: null as string | null,
  setModFocusPaneId: vi.fn(),
  renderModPanel: vi.fn(),
  renderModBand: vi.fn().mockResolvedValue([]),
  sendModPanelEvent: vi.fn(),
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
  });

  it("只有一个面板时不画切换行，正文按面板拉树", async () => {
    chat.modPanes = [pane("main", "待办")];
    const { lastFrame } = render(<ModSurface part="pane" />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("main 的正文");
    });
    expect(lastFrame()).not.toContain("1: 待办");
    expect(chat.renderModPanel).toHaveBeenCalledWith("todo:index", "main");
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

  it("Esc 收起这块面板，且不再向它推事件", async () => {
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
    expect(lastFrame()).not.toContain("main 的正文");
    // 收起是「这一端不画」，不是 `ui.close`：mod 自己决定要不要真关。
    expect(chat.sendModPanelEvent).not.toHaveBeenCalled();
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

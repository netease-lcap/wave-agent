import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import type {
  ModPanelRenderResult,
  ModPanelUpdatePayload,
  ModTreeNode,
} from "wave-agent-sdk/types";
import { render } from "../helpers/inkHarness.js";
import { ModPane } from "../../src/components/mods/ModPane.js";

/** 小工具：造一个元素树节点。 */
function node(
  type: ModTreeNode["type"],
  props: Record<string, unknown> = {},
  children: Array<ModTreeNode | string> = [],
): ModTreeNode {
  return { type, props, children } as unknown as ModTreeNode;
}

const tree = node("Box", { flexDirection: "column" }, [
  node("Text", {}, ["待办 3 项"]),
  node("Progress", { label: "进度", value: 1, max: 4 }),
  node("Button", { key: "add", label: "新增", hotkey: "a" }),
  node("Input", {
    key: "note",
    label: "备注",
    value: "",
    placeholder: "说点什么",
  }),
  node("Select", {
    key: "level",
    label: "级别",
    value: "low",
    options: [
      { value: "low", label: "低" },
      { value: "high", label: "高" },
    ],
  }),
]);

const panel: ModPanelUpdatePayload = {
  sessionId: "s1",
  modId: "todo:index",
  paneId: "main",
  title: "待办",
  revision: 1,
  stale: true,
};

const renderTree = vi.fn(
  async (modId: string, paneId: string): Promise<ModPanelRenderResult> => ({
    modId,
    paneId,
    revision: 1,
    tree,
  }),
);

function mount(overrides: Partial<React.ComponentProps<typeof ModPane>> = {}) {
  const onEvent = vi.fn();
  const onDismiss = vi.fn();
  const result = render(
    <ModPane
      panel={panel}
      focused
      maxRows={12}
      renderTree={renderTree}
      onEvent={onEvent}
      onDismiss={onDismiss}
      {...overrides}
    />,
  );
  return { ...result, onEvent, onDismiss };
}

/** 拉到树画出来为止（`renderTree` 是异步的，第一帧还是 `…`）。 */
async function mountReady(
  overrides: Partial<React.ComponentProps<typeof ModPane>> = {},
) {
  const mounted = mount(overrides);
  await vi.waitFor(() => {
    expect(mounted.lastFrame()).toContain("待办 3 项");
  });
  return mounted;
}

describe("ModPane（终端里的插件面板）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("把树画成终端文本，Progress 是一行字符条", async () => {
    const { lastFrame } = await mountReady();
    const frame = lastFrame()!;
    // 1/4 的进度：填满 1/4 格，后面补空。
    expect(frame).toContain("█");
    expect(frame).toContain("░");
    expect(frame).toContain("25%");
    // 焦点默认落在第一个可交互节点上。
    expect(frame).toContain("▸ 新增");
  });

  it("Tab 在可交互节点之间移动（方向键归滚动），Enter 触发 press", async () => {
    const { stdin, lastFrame, onEvent, settle } = await mountReady();

    stdin.write("\t"); // Tab 到 Input
    await settle();
    expect(lastFrame()).toContain("备注: 说点什么▏");

    stdin.write("\t"); // Tab 到 Select
    await settle();
    expect(lastFrame()).toContain("级别: 低 ▾");

    stdin.write("\t"); // 环绕回第一个（Button）
    await settle();
    expect(lastFrame()).toContain("▸ 新增");

    stdin.write("\r");
    await settle();
    expect(onEvent).toHaveBeenCalledWith("press", "add");
  });

  it("↑ / ↓ 滚正文而不是移焦点，换一帧回到顶部", async () => {
    // 20 行内容 + 视口 5 行，首尾各一个按钮：方向键若在移焦点，第一行不会被裁掉。
    const lines = Array.from({ length: 20 }, (_, index) =>
      node("Text", {}, [`行 ${index}`]),
    );
    const tall = node("Box", { flexDirection: "column" }, [
      node("Button", { key: "top", label: "顶部按钮" }),
      ...lines,
      node("Button", { key: "bottom", label: "底部按钮" }),
    ]);
    const tallRender = vi.fn(
      async (modId: string, paneId: string): Promise<ModPanelRenderResult> => ({
        modId,
        paneId,
        revision: 1,
        tree: tall,
      }),
    );
    const mounted = mount({ maxRows: 5, renderTree: tallRender });
    // 内容高度是 `ScrolledContent` 实测后回报的（首帧报 1 行、下一帧才报真值），
    // 等它稳定再按键 —— 否则 `maxOffset` 还是 0，第一下方向键会被吞掉。
    // `settle()` 只看输出变没变，而「回报高度」这一步不改一个字符，所以要 flush
    // 几轮把它的 `setState` 冲干净。
    for (let pass = 0; pass < 3; pass++) await mounted.flush();
    expect(mounted.lastFrame()).toContain("▸ 顶部按钮");
    const { stdin, lastFrame, settle, rerender, onEvent, onDismiss } = mounted;

    stdin.write("\u001B[B"); // ↓ 逐行滚
    await settle();
    expect(lastFrame()).not.toContain("顶部按钮");
    expect(lastFrame()).not.toContain("▸ 底部按钮");

    stdin.write("\u001B[F"); // End 到最底
    await settle();
    expect(lastFrame()).toContain("底部按钮");
    stdin.write("\t"); // Tab 一步落到最后一个可交互节点 = 焦点确实还停在 `top`
    await settle();
    expect(lastFrame()).toContain("▸ 底部按钮");

    // 换一帧（mod 推了新 revision）就回到顶部：新内容不该停在旧偏移上。
    rerender(
      <ModPane
        panel={{ ...panel, revision: 2 }}
        focused
        maxRows={5}
        renderTree={tallRender}
        onEvent={onEvent}
        onDismiss={onDismiss}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("顶部按钮");
    });
  });

  it("hotkey 字母直接触发对应按钮", async () => {
    const { stdin, onEvent, settle } = await mountReady();
    stdin.write("a");
    await settle();
    expect(onEvent).toHaveBeenCalledWith("press", "add");
  });

  it("Input 上的字符进本地草稿，回车才提交给 mod", async () => {
    const { stdin, lastFrame, onEvent, settle } = await mountReady();

    stdin.write("\t"); // Tab 到 Input
    await settle();

    // 焦点在 Input 上时字母归输入缓冲，不能当成热键发出去。
    stdin.write("hi");
    await settle();
    expect(lastFrame()).toContain("备注: hi");
    expect(onEvent).not.toHaveBeenCalled();

    stdin.write("\r");
    await settle();
    expect(onEvent).toHaveBeenCalledWith("input", "note", "hi");
  });

  it("Select 回车展开候选，↓ + 回车选中", async () => {
    const { stdin, lastFrame, onEvent, settle } = await mountReady();

    stdin.write("\t"); // Tab 到 Input
    await settle();
    stdin.write("\t"); // Tab 到 Select
    await settle();
    expect(lastFrame()).toContain("级别: 低 ▾");

    stdin.write("\r");
    await settle();
    expect(lastFrame()).toContain("❯ 低");

    stdin.write("\u001B[B"); // 展开时 ↓ 选下一项
    await settle();
    expect(lastFrame()).toContain("❯ 高");

    stdin.write("\r");
    await settle();
    expect(onEvent).toHaveBeenCalledWith("select", "level", "high");
  });

  it("Esc 收起面板（不发 ui.close，交给 mod 自己决定）", async () => {
    const { stdin, onDismiss } = await mountReady();
    stdin.write("\u001B");
    // 孤立的一个 ESC 要等 ink 的转义缓冲判完才知道是「Esc 键」还是某个序列的
    // 前缀 —— 那是真实的时间等待，不是帧，所以这里等 promise 而不刷帧。
    await vi.waitFor(() => {
      expect(onDismiss).toHaveBeenCalled();
    });
  });

  it("没拿到键盘时一个键都不接", async () => {
    const { stdin, onEvent, onDismiss, settle } = await mountReady({
      focused: false,
    });
    stdin.write("a");
    stdin.write("\r");
    stdin.write("\u001B");
    await settle();
    // 键盘在输入框那边：面板不该抢走任何一个键。
    expect(onEvent).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("渲染失败时画错误条，树保留上一帧", async () => {
    const failing = vi.fn(
      async (modId: string, paneId: string): Promise<ModPanelRenderResult> => ({
        modId,
        paneId,
        revision: 2,
        tree,
        error: "ui.render 抛错：boom",
      }),
    );
    const mounted = mount({ renderTree: failing });
    await vi.waitFor(() => {
      expect(mounted.lastFrame()).toContain("ui.render 抛错：boom");
    });
    expect(mounted.lastFrame()).toContain("待办 3 项");
  });
});

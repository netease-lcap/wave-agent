import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { ModPanelRenderer } from "../../src/components/ModPanelRenderer";
import type { ModPanelTree } from "wave-agent-sdk/types";

/**
 * `Button.hotkey`（spec `ecosystem/plugin-mods.md`「用户交互的结果」）。
 *
 * 只在面板这棵树里生效：监听挂根节点，事件靠冒泡上来。所以下面每条用例都是
 * 「往某个元素上派一次 keydown，看 `onEvent` 收到什么」—— 焦点在哪、按了哪个
 * 键、那几个按钮谁最后写的，全由这三个事实决定。
 */

const root = (children: ModPanelTree[]): ModPanelTree => ({
  type: "Box",
  props: {},
  children,
});

const button = (key: string, hotkey?: string): ModPanelTree => ({
  type: "Button",
  props: {
    key,
    label: key,
    ...(hotkey ? { hotkey } : {}),
  },
  children: [],
});

function renderTree(tree: ModPanelTree) {
  const onEvent = vi.fn();
  const utils = render(<ModPanelRenderer tree={tree} onEvent={onEvent} />);
  return { onEvent, ...utils };
}

describe("ModPanelRenderer 的 Button.hotkey", () => {
  it("面板里按热键等于点了那个按钮", () => {
    const { onEvent } = renderTree(
      root([button("allow", "y"), button("deny", "n")]),
    );

    fireEvent.keyDown(screen.getByTestId("mod-panel-root"), { key: "y" });

    expect(onEvent).toHaveBeenCalledWith("press", "allow");
  });

  it("键帽画在标签旁边（不画的话用户不知道有热键）", () => {
    renderTree(root([button("allow", "y")]));

    expect(screen.getByText("y")).toHaveClass("mod-button-hotkey");
  });

  it("焦点在输入框里时打这个字母归输入框", () => {
    const tree = root([
      {
        type: "Input",
        props: { key: "note" },
        children: [],
      },
      button("allow", "y"),
    ]);
    const { onEvent } = renderTree(tree);

    // keydown 从输入框冒泡到根，处理器看到 target 是 INPUT 就放行。
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "y" });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("撞键时后写的那个赢", () => {
    const { onEvent } = renderTree(
      root([button("first", "y"), button("second", "y")]),
    );

    fireEvent.keyDown(screen.getByTestId("mod-panel-root"), { key: "y" });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith("press", "second");
  });

  it("带修饰键的是宿主快捷键，不触发热键", () => {
    const { onEvent } = renderTree(root([button("allow", "y")]));
    const panel = screen.getByTestId("mod-panel-root");

    fireEvent.keyDown(panel, { key: "y", ctrlKey: true });
    fireEvent.keyDown(panel, { key: "y", metaKey: true });
    fireEvent.keyDown(panel, { key: "y", altKey: true });
    fireEvent.keyDown(panel, { key: "y", shiftKey: true });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it("大写锁定时也是一个字母（大小写不区分）", () => {
    const { onEvent } = renderTree(root([button("allow", "y")]));

    fireEvent.keyDown(screen.getByTestId("mod-panel-root"), { key: "Y" });

    expect(onEvent).toHaveBeenCalledWith("press", "allow");
  });
});

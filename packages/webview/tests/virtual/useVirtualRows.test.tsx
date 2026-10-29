import { render } from "@testing-library/react";
import { createRef, useImperativeHandle } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  useVirtualRows,
  type VirtualRows,
} from "../../src/virtual/useVirtualRows";

// jsdom 没有 ResizeObserver；内核用它盯行高与容器尺寸，这里给个空实现。
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

/** 行高固定的 20 行，总量 2000px；测试视口由 tests/setup.ts 固定为 600px。 */
const rowKeys = (prefix: string) =>
  Array.from({ length: 20 }, (_, i) => `${prefix}-${i}`);
const ROW_HEIGHT = 100;
const VIEWPORT = 600;
const TOTAL = 20 * ROW_HEIGHT;
const BOTTOM = TOTAL - VIEWPORT;

function Harness({
  keys,
  docKey,
  apiRef,
}: {
  keys: string[];
  docKey: string;
  apiRef: React.MutableRefObject<VirtualRows | null>;
}) {
  const rows = useVirtualRows({
    keys,
    estimate: () => ROW_HEIGHT,
    docKey,
  });
  useImperativeHandle(apiRef as never, () => rows, [rows]);
  return <div ref={rows.containerRef} data-testid="messages-container" />;
}

/** 用户真的滚了一下：写 scrollTop 再派发 scroll（jsdom 不会自己派发）。 */
function userScroll(container: HTMLElement, top: number) {
  container.scrollTop = top;
  container.dispatchEvent(new Event("scroll"));
}

function mount(keys: string[], docKey: string) {
  const apiRef =
    createRef<VirtualRows>() as React.MutableRefObject<VirtualRows | null>;
  const utils = render(<Harness keys={keys} docKey={docKey} apiRef={apiRef} />);
  const container = utils.getByTestId("messages-container");
  return { ...utils, apiRef, container };
}

describe("useVirtualRows 阅读位置恢复", () => {
  it("锚点那一行还在首屏一页里：回到离开时的位置", () => {
    const keys = rowKeys("hit");
    const first = mount(keys, "doc-hit");
    userScroll(first.container, 700);
    first.apiRef.current?.unpin();
    first.unmount();

    const second = mount(keys, "doc-hit");
    expect(second.container.scrollTop).toBe(700);
    second.unmount();
  });

  it("锚点那一行不在首屏一页里：落到首屏默认的钉底位置，不留在顶部", () => {
    const first = mount(rowKeys("visited"), "doc-missing");
    userScroll(first.container, 700);
    first.apiRef.current?.unpin();
    first.unmount();

    // 切回来时只加载了首屏一页，且那一页里没有离开时锚定的行。
    const second = mount(rowKeys("other"), "doc-missing");
    expect(second.container.scrollTop).toBe(BOTTOM);
    expect(second.container.scrollTop).toBe(BOTTOM);
    expect(second.apiRef.current?.isPinned()).toBe(true);
    second.unmount();
  });
});

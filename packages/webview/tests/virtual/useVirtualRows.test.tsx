import { render } from "@testing-library/react";
import { createRef, useImperativeHandle } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  useVirtualRows,
  type VirtualRows,
} from "../../src/virtual/useVirtualRows";

// ResizeObserver 只在真浏览器里存在；这里的 harness 不渲染行（用估计值当账本），
// 内核挂它只是为了盯行高与容器尺寸，空实现足够。
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

/**
 * 行高固定的 20 行，总量 2000px；视口 600px —— harness 自己给出可滚的真实尺寸
 * （容器 600px 高 + overflow，spacer 撑出总高），滚动位置才是真的。
 */
const rowKeys = (prefix: string) =>
  Array.from({ length: 20 }, (_, i) => `${prefix}-${i}`);
const ROW_HEIGHT = 100;
const VIEWPORT = 600;

function Harness({
  keys,
  apiRef,
}: {
  keys: string[];
  apiRef: React.MutableRefObject<VirtualRows | null>;
}) {
  const rows = useVirtualRows({
    keys,
    estimate: () => ROW_HEIGHT,
  });
  useImperativeHandle(apiRef as never, () => rows, [rows]);
  return (
    <div
      ref={rows.containerRef}
      data-testid="messages-container"
      style={{ height: VIEWPORT, overflowY: "auto", position: "relative" }}
    >
      <div style={{ height: rows.totalSize }} />
    </div>
  );
}

/** 用户真的滚了一下：写 scrollTop 再派发 scroll（合成滚动不会自带事件）。 */
function userScroll(container: HTMLElement, top: number) {
  container.scrollTop = top;
  container.dispatchEvent(new Event("scroll"));
}

function mount(keys: string[]) {
  const apiRef =
    createRef<VirtualRows>() as React.MutableRefObject<VirtualRows | null>;
  const utils = render(<Harness keys={keys} apiRef={apiRef} />);
  const container = utils.getByTestId("messages-container");
  return { ...utils, apiRef, container };
}

describe("useVirtualRows 挂载状态", () => {
  it("上翻离开底部后卸载再挂载：不恢复上一次的阅读位置", () => {
    const keys = rowKeys("a");
    const first = mount(keys);
    userScroll(first.container, 700);
    first.apiRef.current?.unpin();
    expect(first.container.scrollTop).toBe(700);
    first.unmount();

    const second = mount(keys);
    expect(second.container.scrollTop).not.toBe(700);
    // 新挂载默认就是「钉底」：后续任何一次高度变化或使用方的跟随 effect 都会把
    // 视口带到真实底部，而不是回到上面那次离开的位置。
    expect(second.apiRef.current?.isPinned()).toBe(true);
    second.unmount();
  });
});

describe("useVirtualRows 锚点", () => {
  it("视口顶那一行的 key 被换掉：视口跟着内容走，不甩到底", () => {
    // 上翻取回一页 / 聚焦视图折叠卡换身份的形状：上面插进新行，且原来视口顶那
    // 一行的 key 变了，下面一行都没动。锚点记着下一行的起点，照着它补偿即可。
    const before = rowKeys("a");
    const first = mount(before);
    userScroll(first.container, 1000);
    userScroll(first.container, 700); // 往上滚 ⇒ 松手
    expect(first.apiRef.current?.isPinned()).toBe(false);
    expect(first.container.scrollTop).toBe(700);

    const after = [
      "p-0",
      "p-1",
      ...before.slice(0, 7),
      "changed",
      ...before.slice(8),
    ];
    first.rerender(<Harness keys={after} apiRef={first.apiRef} />);

    // a8 的起点 800 → 1000：视口跟着往下推 200，看的还是原来那几行；
    // 掉到「按末尾重钉」的话这里是 1600（2200 - 视口 600）。
    expect(first.container.scrollTop).toBe(900);
    expect(first.apiRef.current?.isPinned()).toBe(false);
    first.unmount();
  });
});

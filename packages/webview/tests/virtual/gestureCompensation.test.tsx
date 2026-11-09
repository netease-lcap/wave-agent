import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { createRef, useImperativeHandle, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  useVirtualRows,
  type VirtualRows,
} from "../../src/virtual/useVirtualRows";

/**
 * 手势期的补偿落点。
 *
 * 高度账本在用户手指还没松开时变了（流式增长、折叠展开、行宽变化重测都是同一件
 * 事），内核不能去写 `scrollTop`：触控设备上中途改它既打断惯性、读回的值又是陈旧
 * 的，用户看到的是「滑着滑着定位突变」。所以手势期把这一截写成画布的 `translateY`，
 * 等手势（含惯性尾巴）停稳后再折算回 `scrollTop`。
 *
 * 这里锁的是分工，不是像素：手势期**只有** transform、`scrollTop` 一次都不写；
 * 停稳后反过来——transform 清空、`scrollTop` 一次性补上被顶开的那一截。
 * 真浏览器里的可见跳变由 `e2e/virtual-scroll-drift.e2e.ts` 量。
 */

type ResizeEntry = { target: Element; borderBoxSize: { blockSize: number }[] };

/** 内核只在第一行挂载时建一个 RO；这里留个把手，用来手动推一次「行变高了」。 */
let resizeCallback: ((entries: ResizeEntry[]) => void) | undefined;

vi.stubGlobal(
  "ResizeObserver",
  class {
    constructor(callback: (entries: ResizeEntry[]) => void) {
      resizeCallback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const ROW_HEIGHT = 80;
const ROW_COUNT = 20;
const ROW_KEYS = Array.from({ length: ROW_COUNT }, (_, i) => `k${i}`);
/**
 * 视口 600px：真浏览器没有「offsetHeight 桩」，harness 自己给出可以真的滚的
 * 尺寸——容器 600px 高 + overflow，spacer 撑出 20 行的内容高。
 */
const VIEWPORT_HEIGHT = 600;
const START_SCROLL = 400;
const GROWTH = ROW_HEIGHT;

const estimate = () => ROW_HEIGHT;

function Harness({
  apiRef,
}: {
  apiRef: React.MutableRefObject<VirtualRows | null>;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const rows = useVirtualRows({ keys: ROW_KEYS, estimate, canvasRef });
  useImperativeHandle(apiRef as never, () => rows, [rows]);
  // 定位与高度照 app 的 MessageList.css 来（canvas 绝对定位铺满列、行绝对定位）：
  // 只有 spacer 参与流，`scrollHeight` 才等于账本总高。
  return (
    <div
      ref={rows.containerRef}
      data-testid="messages-container"
      style={{
        height: VIEWPORT_HEIGHT,
        overflowY: "auto",
        position: "relative",
      }}
    >
      <div className="messages-column">
        <div className="virtual-spacer" style={{ height: rows.totalSize }} />
        <div
          className="virtual-canvas"
          ref={canvasRef}
          style={{ position: "absolute", inset: 0 }}
        >
          {rows.rows.map((row) => (
            <div
              key={row.key}
              data-virtual-key={row.key}
              ref={rows.measureRow}
              className="virtual-row"
              style={{
                position: "absolute",
                top: row.start,
                height: ROW_HEIGHT,
                width: "100%",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function mount() {
  const apiRef =
    createRef<VirtualRows>() as React.MutableRefObject<VirtualRows | null>;
  const utils = render(<Harness apiRef={apiRef} />);
  const container = utils.getByTestId("messages-container");
  const canvas = container.querySelector(".virtual-canvas") as HTMLElement;
  return { ...utils, apiRef, container, canvas };
}

/** 松手（脱离钉底）并滚到一个视口中段的位置，锚点落在第 5 行上。 */
function scrollUpTo(
  container: HTMLElement,
  apiRef: React.MutableRefObject<VirtualRows | null>,
) {
  act(() => {
    container.scrollTop = START_SCROLL;
    fireEvent.scroll(container);
    apiRef.current?.unpin();
  });
}

/** 视口上方那一行（下标 1）长高：账本重算，补偿量为 +GROWTH。 */
function growRowAbove(container: HTMLElement) {
  growRowTo(container, "k1", ROW_HEIGHT + GROWTH);
}

/** 让某一行被量到指定高度（`data-virtual-key` 对应账本下标 + 1）。 */
function growRowTo(container: HTMLElement, key: string, blockSize: number) {
  const target = container.querySelector(`[data-virtual-key="${key}"]`);
  expect(target).not.toBeNull();
  act(() => {
    resizeCallback?.([
      { target: target as Element, borderBoxSize: [{ blockSize }] },
    ]);
  });
}

describe("手势期补偿走视觉偏移", () => {
  it("手指按着时行变高：只写画布的 transform，scrollTop 一次都不写", () => {
    const { container, canvas, apiRef } = mount();
    const scrollTo = vi.spyOn(container, "scrollTo");
    scrollUpTo(container, apiRef);

    act(() => {
      fireEvent.touchStart(container);
    });
    growRowAbove(container);

    // 账本确实变了（spacer 长高），补偿却没落到 scrollTop 上。
    expect(container.querySelector(".virtual-spacer")).not.toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(container.scrollTop).toBe(START_SCROLL);
    expect(canvas.style.transform).toBe(`translateY(-${GROWTH}px)`);
  });

  it("松手停稳后：transform 清零，被顶开的那一截一次补进 scrollTop", async () => {
    const { container, canvas, apiRef } = mount();
    const scrollTo = vi.spyOn(container, "scrollTo");
    scrollUpTo(container, apiRef);

    act(() => {
      fireEvent.touchStart(container);
    });
    growRowAbove(container);
    expect(canvas.style.transform).toBe(`translateY(-${GROWTH}px)`);

    act(() => {
      fireEvent.touchEnd(container);
    });
    await waitFor(() => expect(scrollTo).toHaveBeenCalled());
    await waitFor(() => expect(canvas.style.transform).toBe(""));

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({
      top: START_SCROLL + GROWTH,
      behavior: "auto",
    });
    expect(container.scrollTop).toBe(START_SCROLL + GROWTH);
  });

  it("没有手势时仍旧直接写 scrollTop（桌面端不多一层）", () => {
    const { container, canvas, apiRef } = mount();
    const scrollTo = vi.spyOn(container, "scrollTo");
    scrollUpTo(container, apiRef);

    growRowAbove(container);

    expect(scrollTo).toHaveBeenCalledWith({
      top: START_SCROLL + GROWTH,
      behavior: "auto",
    });
    expect(canvas.style.transform).toBe("");
  });

  it("上滑攒下偏移、再反向下甩：一换方向就折算，别拖到底部变成空白", () => {
    const { container, canvas } = mount();

    // 先向下滚一段（建立「往下」这个方向），再往上滚——上滚时账本变，补偿挂成偏移。
    // 真机上的顺序就是这样：上翻读到更早的内容，偏移攒下来；然后用户掉头往下甩。
    act(() => {
      container.scrollTop = START_SCROLL + 200;
      fireEvent.scroll(container);
    });
    act(() => {
      fireEvent.touchStart(container);
    });
    act(() => {
      container.scrollTop = START_SCROLL;
      fireEvent.scroll(container);
    });
    growRowAbove(container);
    expect(canvas.style.transform).toBe(`translateY(-${GROWTH}px)`);

    // 掉头往下甩（手指还按着）。偏移留着的话，越接近底部「偏移 - 离底距离」越大，
    // 屏幕上就是一片越来越大的空白，直到撞到底才被折算清掉（真机实测 358px）。
    act(() => {
      container.scrollTop = START_SCROLL + 240;
      fireEvent.scroll(container);
    });

    expect(canvas.style.transform).toBe("");
    expect(container.scrollTop).toBe(START_SCROLL + 240 + GROWTH);
  });

  it("自己刚写过 scrollTop，紧接着甩到底：那次写入不能把到界折算挡掉", () => {
    const { container, canvas, apiRef } = mount();
    const bottom = () => container.scrollHeight - container.offsetHeight;

    // 钉底 + 账本变化 ⇒ 内核自己把 scrollTop 写到真底，落进「自己那次滚动」的认领
    // 窗口（1500ms / 2px）。真机上的开场就是这样：先钉在底部，然后手指一动。
    act(() => {
      apiRef.current?.pin();
    });
    growRowAbove(container);
    expect(container.scrollTop).toBe(bottom());

    // 手指按着往上翻，账本又变（另一行长高）⇒ 补偿挂成画布偏移。
    act(() => {
      fireEvent.touchStart(container);
    });
    act(() => {
      container.scrollTop = START_SCROLL;
      fireEvent.scroll(container);
    });
    growRowTo(container, "k2", ROW_HEIGHT + GROWTH);
    expect(canvas.style.transform).toBe(`translateY(-${GROWTH}px)`);

    // 手指还按着就甩回真底：这次滚动正落在「我们自己写的那个落点」上，分类会说它
    // 是我们写的——但底部该不该露白跟谁写的无关，到界那一刻就得折算。
    act(() => {
      container.scrollTop = bottom();
      fireEvent.scroll(container);
    });
    expect(canvas.style.transform).toBe("");
  });

  it("手上滑再滑到底：一到底就折算，偏移不留到惯性停", () => {
    const { container, canvas, apiRef } = mount();

    scrollUpTo(container, apiRef);
    act(() => {
      fireEvent.touchStart(container);
    });
    growRowAbove(container);
    expect(canvas.style.transform).toBe(`translateY(-${GROWTH}px)`);

    // 手指还按着，用户继续往下甩到底：真机上这一段就是「底部一大块空白」。
    const bottom = container.scrollHeight - container.offsetHeight;
    act(() => {
      container.scrollTop = bottom;
      fireEvent.scroll(container);
    });

    // 不等 `touchend`、也不等惯性停：到底那一刻偏移就该丢掉（折算在边界上兑现
    // 不了，留着就是把内容顶开、底部一片空白）。claude.ai 的判据是在 scroll 里
    // 「到顶/到底/方向反转 + 还有挂起量」就立刻折算。
    expect(canvas.style.transform).toBe("");
    expect(container.scrollTop).toBe(bottom);
  });
});

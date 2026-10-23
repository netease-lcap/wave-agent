import React from "react";
import { cleanup, render } from "../helpers/inkHarness.js";
import { afterEach, describe, it, expect } from "vitest";
import {
  useLineScroll,
  type UseLineScrollOptions,
} from "../../src/hooks/useLineScroll.js";

const UP = "\u001B[A";
const DOWN = "\u001B[B";
const CTRL_P = "\u0010";
const CTRL_N = "\u000E";
const PGUP = "\u001B[5~";
const PGDN = "\u001B[6~";
const CTRL_U = "\u0015";
const CTRL_D = "\u0004";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type ScrollState = ReturnType<typeof useLineScroll>;

const Probe: React.FC<{ options: UseLineScrollOptions }> = ({ options }) => {
  hookState = useLineScroll(options);
  return null;
};

let hookState: ScrollState | undefined;

const renderScroll = (options: UseLineScrollOptions) => {
  const result = render(<Probe options={options} />);
  return {
    ...result,
    get: (): ScrollState => hookState!,
    rerenderWith: (next: UseLineScrollOptions) =>
      result.rerender(<Probe options={next} />),
  };
};

afterEach(() => {
  cleanup();
});

describe("useLineScroll", () => {
  it("moves lineStep rows per arrow press and clamps at both ends", async () => {
    const { stdin, get } = renderScroll({
      totalLines: 40,
      visibleCount: 10,
      lineStep: 3,
    });
    expect(get().scrollOffset).toBe(0);

    stdin.write(DOWN);
    await sleep(10);
    expect(get().scrollOffset).toBe(3);

    stdin.write(DOWN);
    await sleep(10);
    expect(get().scrollOffset).toBe(6);
    expect(get().hasMoreAbove).toBe(true);
    expect(get().hasMoreBelow).toBe(true);

    // Past the last page the offset stops at maxScroll (40 - 10).
    for (let i = 0; i < 15; i++) {
      stdin.write(DOWN);
      await sleep(5);
    }
    expect(get().scrollOffset).toBe(30);
    expect(get().hasMoreBelow).toBe(false);

    stdin.write(DOWN);
    await sleep(10);
    expect(get().scrollOffset).toBe(30);

    for (let i = 0; i < 15; i++) {
      stdin.write(UP);
      await sleep(5);
    }
    expect(get().scrollOffset).toBe(0);
    expect(get().hasMoreAbove).toBe(false);

    stdin.write(UP);
    await sleep(10);
    expect(get().scrollOffset).toBe(0);
  });

  it("scrolls lineStep rows with Ctrl+N / Ctrl+P as well", async () => {
    const { stdin, get } = renderScroll({
      totalLines: 40,
      visibleCount: 10,
      lineStep: 3,
    });

    stdin.write(CTRL_N);
    await sleep(10);
    expect(get().scrollOffset).toBe(3);

    stdin.write(CTRL_N);
    await sleep(10);
    expect(get().scrollOffset).toBe(6);

    stdin.write(CTRL_P);
    await sleep(10);
    expect(get().scrollOffset).toBe(3);
  });

  it("does not take over the arrow keys when the content fits the viewport", async () => {
    const { stdin, get } = renderScroll({
      totalLines: 4,
      visibleCount: 10,
      lineStep: 3,
    });
    expect(get().canScroll).toBe(false);

    stdin.write(DOWN);
    await sleep(10);
    expect(get().scrollOffset).toBe(0);

    stdin.write(UP);
    await sleep(10);
    expect(get().scrollOffset).toBe(0);

    stdin.write(CTRL_N);
    await sleep(10);
    expect(get().scrollOffset).toBe(0);
  });

  it("leaves the arrow keys alone for callers that do not ask for line scrolling", async () => {
    // PlanView / ConfirmationDetails only opt into the page keys.
    const { stdin, get } = renderScroll({ totalLines: 40, visibleCount: 10 });

    stdin.write(DOWN);
    await sleep(10);
    expect(get().scrollOffset).toBe(0);

    stdin.write(PGDN);
    await sleep(10);
    expect(get().scrollOffset).toBe(10);
  });

  it("keeps the page keys working for line-scrolling callers", async () => {
    const { stdin, get } = renderScroll({
      totalLines: 40,
      visibleCount: 10,
      lineStep: 3,
    });

    stdin.write(PGDN);
    await sleep(10);
    expect(get().scrollOffset).toBe(10);

    stdin.write(CTRL_D);
    await sleep(10);
    expect(get().scrollOffset).toBe(15);

    stdin.write(PGUP);
    await sleep(10);
    expect(get().scrollOffset).toBe(5);

    stdin.write(CTRL_U);
    await sleep(10);
    expect(get().scrollOffset).toBe(0);
  });

  it("resets to the top when resetKey changes", async () => {
    const options: UseLineScrollOptions = {
      totalLines: 40,
      visibleCount: 10,
      lineStep: 3,
      resetKey: "first",
    };
    const { stdin, get, rerenderWith } = renderScroll(options);

    stdin.write(DOWN);
    await sleep(10);
    expect(get().scrollOffset).toBe(3);

    rerenderWith({ ...options, resetKey: "second" });
    await sleep(10);
    expect(get().scrollOffset).toBe(0);
  });
});

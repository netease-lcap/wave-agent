import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { HookTester, HookTesterRef } from "../helpers/HookTester";
import { useMemoryMode } from "../../src/hooks/useMemoryMode";

describe("useMemoryMode", () => {
  it("should not activate memory mode for text starting with # if not already in memory mode", () => {
    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useMemoryMode>>>();
    render(<HookTester hook={() => useMemoryMode()} ref={ref} />);

    const { isMemoryMode, checkMemoryMode } = ref.current!.getState();

    expect(isMemoryMode).toBe(false);

    // Test that text starting with # but not just # doesn't activate memory mode initially
    expect(checkMemoryMode("# Memory")).toBe(false);
    expect(checkMemoryMode("## Heading")).toBe(false);
    expect(checkMemoryMode("#tag")).toBe(false);
  });

  it("should activate memory mode only for single # character", () => {
    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useMemoryMode>>>();
    render(<HookTester hook={() => useMemoryMode()} ref={ref} />);

    const { checkMemoryMode } = ref.current!.getState();

    // Test that only single # activates memory mode
    expect(checkMemoryMode("#")).toBe(true);
  });

  it("should stay in memory mode when adding text after # once already activated", () => {
    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useMemoryMode>>>();
    const { rerender } = render(
      <HookTester hook={() => useMemoryMode()} ref={ref} />,
    );

    let state = ref.current!.getState();

    // Initially not in memory mode
    expect(state.isMemoryMode).toBe(false);

    // Activate memory mode with single #
    state.checkMemoryMode("#");
    rerender(<HookTester hook={() => useMemoryMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isMemoryMode).toBe(true);

    // Stay in memory mode when adding text after #
    expect(state.checkMemoryMode("# something")).toBe(true);
    rerender(<HookTester hook={() => useMemoryMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isMemoryMode).toBe(true);

    expect(state.checkMemoryMode("# remember this")).toBe(true);
    rerender(<HookTester hook={() => useMemoryMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isMemoryMode).toBe(true);
  });

  it("should exit memory mode only when # is removed from the beginning", () => {
    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useMemoryMode>>>();
    const { rerender } = render(
      <HookTester hook={() => useMemoryMode()} ref={ref} />,
    );

    let state = ref.current!.getState();

    // Activate memory mode
    state.checkMemoryMode("#");
    rerender(<HookTester hook={() => useMemoryMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isMemoryMode).toBe(true);

    // Exit memory mode when # is removed
    state.checkMemoryMode("something");
    rerender(<HookTester hook={() => useMemoryMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isMemoryMode).toBe(false);

    // Exit memory mode when input is empty
    state.checkMemoryMode("#");
    rerender(<HookTester hook={() => useMemoryMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isMemoryMode).toBe(true);

    state.checkMemoryMode("");
    rerender(<HookTester hook={() => useMemoryMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isMemoryMode).toBe(false);
  });

  it("should deactivate memory mode when deactivateMemoryMode is called", () => {
    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useMemoryMode>>>();
    const { rerender } = render(
      <HookTester hook={() => useMemoryMode()} ref={ref} />,
    );

    let state = ref.current!.getState();

    // Activate memory mode
    state.checkMemoryMode("#");
    rerender(<HookTester hook={() => useMemoryMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isMemoryMode).toBe(true);

    // Deactivate using the function
    state.deactivateMemoryMode();
    rerender(<HookTester hook={() => useMemoryMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isMemoryMode).toBe(false);
  });

  it("should return false for empty string", () => {
    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useMemoryMode>>>();
    render(<HookTester hook={() => useMemoryMode()} ref={ref} />);

    const { checkMemoryMode } = ref.current!.getState();

    expect(checkMemoryMode("")).toBe(false);
  });

  it("should return false for whitespace when not in memory mode", () => {
    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useMemoryMode>>>();
    render(<HookTester hook={() => useMemoryMode()} ref={ref} />);

    const { checkMemoryMode } = ref.current!.getState();

    expect(checkMemoryMode(" ")).toBe(false);
    expect(checkMemoryMode("  ")).toBe(false);
    expect(checkMemoryMode("\t")).toBe(false);
    expect(checkMemoryMode("\n")).toBe(false);
  });

  it("should return false for # with leading whitespace", () => {
    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useMemoryMode>>>();
    render(<HookTester hook={() => useMemoryMode()} ref={ref} />);

    const { checkMemoryMode } = ref.current!.getState();

    expect(checkMemoryMode(" #")).toBe(false);
    expect(checkMemoryMode(" # ")).toBe(false);
  });

  it("should handle complex flow: enter memory mode, add text, still in memory mode, remove #, exit memory mode", () => {
    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useMemoryMode>>>();
    const { rerender } = render(
      <HookTester hook={() => useMemoryMode()} ref={ref} />,
    );

    let state = ref.current!.getState();

    // Step 1: Not in memory mode initially
    expect(state.isMemoryMode).toBe(false);

    // Step 2: Enter memory mode with #
    expect(state.checkMemoryMode("#")).toBe(true);
    rerender(<HookTester hook={() => useMemoryMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isMemoryMode).toBe(true);

    // Step 3: Add text, still in memory mode
    expect(state.checkMemoryMode("# Hello")).toBe(true);
    rerender(<HookTester hook={() => useMemoryMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isMemoryMode).toBe(true);

    // Step 4: Add more text, still in memory mode
    expect(state.checkMemoryMode("# Hello World")).toBe(true);
    rerender(<HookTester hook={() => useMemoryMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isMemoryMode).toBe(true);

    // Step 5: Remove #, exit memory mode
    expect(state.checkMemoryMode("Hello World")).toBe(false);
    rerender(<HookTester hook={() => useMemoryMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isMemoryMode).toBe(false);

    // Step 6: Try to add # in the middle, should not re-enter memory mode
    expect(state.checkMemoryMode("Hello # World")).toBe(false);
    rerender(<HookTester hook={() => useMemoryMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isMemoryMode).toBe(false);
  });
});

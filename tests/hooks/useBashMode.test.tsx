import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { HookTester, HookTesterRef } from "../helpers/HookTester";
import { useBashMode } from "../../src/hooks/useBashMode";

describe("useBashMode", () => {
  it("should not activate bash mode for text starting with ! if not already in bash mode", () => {
    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useBashMode>>>();
    render(<HookTester hook={() => useBashMode()} ref={ref} />);

    const { isBashMode, checkBashMode } = ref.current!.getState();

    expect(isBashMode).toBe(false);

    // Test that text starting with ! but not just ! doesn't activate bash mode initially
    expect(checkBashMode("! command")).toBe(false);
    expect(checkBashMode("!ls")).toBe(false);
    expect(checkBashMode("!grep")).toBe(false);
  });

  it("should activate bash mode only for single ! character", () => {
    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useBashMode>>>();
    render(<HookTester hook={() => useBashMode()} ref={ref} />);

    const { checkBashMode } = ref.current!.getState();

    // Test that only single ! activates bash mode
    expect(checkBashMode("!")).toBe(true);
  });

  it("should stay in bash mode when adding text after ! once already activated", () => {
    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useBashMode>>>();
    const { rerender } = render(
      <HookTester hook={() => useBashMode()} ref={ref} />,
    );

    let state = ref.current!.getState();

    // Initially not in bash mode
    expect(state.isBashMode).toBe(false);

    // Activate bash mode with single !
    state.checkBashMode("!");
    rerender(<HookTester hook={() => useBashMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isBashMode).toBe(true);

    // Stay in bash mode when adding text after !
    expect(state.checkBashMode("! something")).toBe(true);
    rerender(<HookTester hook={() => useBashMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isBashMode).toBe(true);

    expect(state.checkBashMode("!ls -la")).toBe(true);
    rerender(<HookTester hook={() => useBashMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isBashMode).toBe(true);
  });

  it("should exit bash mode only when ! is removed from the beginning", () => {
    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useBashMode>>>();
    const { rerender } = render(
      <HookTester hook={() => useBashMode()} ref={ref} />,
    );

    let state = ref.current!.getState();

    // Activate bash mode
    state.checkBashMode("!");
    rerender(<HookTester hook={() => useBashMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isBashMode).toBe(true);

    // Exit bash mode when ! is removed
    state.checkBashMode("something");
    rerender(<HookTester hook={() => useBashMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isBashMode).toBe(false);

    // Exit bash mode when input is empty
    state.checkBashMode("!");
    rerender(<HookTester hook={() => useBashMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isBashMode).toBe(true);

    state.checkBashMode("");
    rerender(<HookTester hook={() => useBashMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isBashMode).toBe(false);
  });

  it("should deactivate bash mode when deactivateBashMode is called", () => {
    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useBashMode>>>();
    const { rerender } = render(
      <HookTester hook={() => useBashMode()} ref={ref} />,
    );

    let state = ref.current!.getState();

    // Activate bash mode
    state.checkBashMode("!");
    rerender(<HookTester hook={() => useBashMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isBashMode).toBe(true);

    // Deactivate using the function
    state.deactivateBashMode();
    rerender(<HookTester hook={() => useBashMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isBashMode).toBe(false);
  });

  it("should return false for empty string", () => {
    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useBashMode>>>();
    render(<HookTester hook={() => useBashMode()} ref={ref} />);

    const { checkBashMode } = ref.current!.getState();

    expect(checkBashMode("")).toBe(false);
  });

  it("should return false for whitespace when not in bash mode", () => {
    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useBashMode>>>();
    render(<HookTester hook={() => useBashMode()} ref={ref} />);

    const { checkBashMode } = ref.current!.getState();

    expect(checkBashMode(" ")).toBe(false);
    expect(checkBashMode("  ")).toBe(false);
    expect(checkBashMode("\t")).toBe(false);
    expect(checkBashMode("\n")).toBe(false);
  });

  it("should return false for ! with leading whitespace", () => {
    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useBashMode>>>();
    render(<HookTester hook={() => useBashMode()} ref={ref} />);

    const { checkBashMode } = ref.current!.getState();

    expect(checkBashMode(" !")).toBe(false);
    expect(checkBashMode(" ! ")).toBe(false);
  });

  it("should handle complex flow: enter bash mode, add text, still in bash mode, remove !, exit bash mode", () => {
    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useBashMode>>>();
    const { rerender } = render(
      <HookTester hook={() => useBashMode()} ref={ref} />,
    );

    let state = ref.current!.getState();

    // Step 1: Not in bash mode initially
    expect(state.isBashMode).toBe(false);

    // Step 2: Enter bash mode with !
    expect(state.checkBashMode("!")).toBe(true);
    rerender(<HookTester hook={() => useBashMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isBashMode).toBe(true);

    // Step 3: Add text, still in bash mode
    expect(state.checkBashMode("! ls")).toBe(true);
    rerender(<HookTester hook={() => useBashMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isBashMode).toBe(true);

    // Step 4: Add more text, still in bash mode
    expect(state.checkBashMode("! ls -la")).toBe(true);
    rerender(<HookTester hook={() => useBashMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isBashMode).toBe(true);

    // Step 5: Remove !, exit bash mode
    expect(state.checkBashMode("ls -la")).toBe(false);
    rerender(<HookTester hook={() => useBashMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isBashMode).toBe(false);

    // Step 6: Try to add ! in the middle, should not re-enter bash mode
    expect(state.checkBashMode("ls ! -la")).toBe(false);
    rerender(<HookTester hook={() => useBashMode()} ref={ref} />);
    state = ref.current!.getState();
    expect(state.isBashMode).toBe(false);
  });
});

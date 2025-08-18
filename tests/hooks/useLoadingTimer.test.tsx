import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HookTester, HookTesterRef } from "../helpers/HookTester";
import { useLoadingTimer } from "@/hooks/useLoadingTimer";

// Mock timers
let mockSetInterval: ReturnType<typeof vi.fn>;
let mockClearInterval: ReturnType<typeof vi.fn>;
let mockDateNow: ReturnType<typeof vi.fn>;
let intervalCallbacks: (() => void)[] = [];

describe("useLoadingTimer Hook", () => {
  beforeEach(() => {
    intervalCallbacks = [];

    // Mock setInterval to track callbacks
    mockSetInterval = vi.fn((callback: () => void) => {
      intervalCallbacks.push(callback);
      return `timer-${intervalCallbacks.length - 1}`;
    });

    mockClearInterval = vi.fn();
    mockDateNow = vi.fn();

    vi.stubGlobal("setInterval", mockSetInterval);
    vi.stubGlobal("clearInterval", mockClearInterval);
    vi.stubGlobal("Date", { ...Date, now: mockDateNow });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    intervalCallbacks = [];
  });

  it("should return initial state when not loading", () => {
    mockDateNow.mockReturnValue(1000000000);

    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useLoadingTimer>>>();
    render(<HookTester hook={() => useLoadingTimer(false)} ref={ref} />);

    const state = ref.current?.getState();
    expect(state).toEqual({
      elapsedTime: 0,
      formattedTime: "0s",
    });
    expect(mockSetInterval).not.toHaveBeenCalled();
  });

  it("should start timer when loading begins", () => {
    mockDateNow.mockReturnValue(1000000000);

    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useLoadingTimer>>>();
    render(<HookTester hook={() => useLoadingTimer(true)} ref={ref} />);

    expect(mockSetInterval).toHaveBeenCalledWith(expect.any(Function), 1000);
    expect(mockDateNow).toHaveBeenCalled();
  });

  it("should format time correctly for seconds", () => {
    const startTime = 1000000000;
    mockDateNow.mockReturnValue(startTime);

    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useLoadingTimer>>>();
    const { rerender } = render(
      <HookTester hook={() => useLoadingTimer(true)} ref={ref} />,
    );

    // Simulate 5 seconds passing
    mockDateNow.mockReturnValue(startTime + 5000);

    // Trigger the interval callback
    if (intervalCallbacks.length > 0) {
      intervalCallbacks[0]();
    }

    // Rerender to see the updated state
    rerender(<HookTester hook={() => useLoadingTimer(true)} ref={ref} />);

    const state = ref.current?.getState();
    expect(state?.elapsedTime).toBe(5);
    expect(state?.formattedTime).toBe("5s");
  });

  it("should format time correctly for minutes and seconds", () => {
    const startTime = 1000000000;
    mockDateNow.mockReturnValue(startTime);

    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useLoadingTimer>>>();
    const { rerender } = render(
      <HookTester hook={() => useLoadingTimer(true)} ref={ref} />,
    );

    // Simulate 125 seconds (2m 5s) passing
    mockDateNow.mockReturnValue(startTime + 125000);

    // Trigger the interval callback
    if (intervalCallbacks.length > 0) {
      intervalCallbacks[0]();
    }

    // Rerender to see the updated state
    rerender(<HookTester hook={() => useLoadingTimer(true)} ref={ref} />);

    const state = ref.current?.getState();
    expect(state?.elapsedTime).toBe(125);
    expect(state?.formattedTime).toBe("2m 5s");
  });

  it("should format exact minute correctly", () => {
    const startTime = 1000000000;
    mockDateNow.mockReturnValue(startTime);

    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useLoadingTimer>>>();
    const { rerender } = render(
      <HookTester hook={() => useLoadingTimer(true)} ref={ref} />,
    );

    // Simulate 60 seconds (1m 0s) passing
    mockDateNow.mockReturnValue(startTime + 60000);

    // Trigger the interval callback
    if (intervalCallbacks.length > 0) {
      intervalCallbacks[0]();
    }

    // Rerender to see the updated state
    rerender(<HookTester hook={() => useLoadingTimer(true)} ref={ref} />);

    const state = ref.current?.getState();
    expect(state?.elapsedTime).toBe(60);
    expect(state?.formattedTime).toBe("1m 0s");
  });

  it("should clear interval when loading stops", () => {
    mockDateNow.mockReturnValue(1000000000);

    // Start with loading = true
    const ref =
      React.createRef<HookTesterRef<ReturnType<typeof useLoadingTimer>>>();
    const { rerender } = render(
      <HookTester hook={() => useLoadingTimer(true)} ref={ref} />,
    );

    expect(mockSetInterval).toHaveBeenCalledTimes(1);

    // Change to loading = false
    rerender(<HookTester hook={() => useLoadingTimer(false)} ref={ref} />);

    expect(mockClearInterval).toHaveBeenCalled();
  });
});

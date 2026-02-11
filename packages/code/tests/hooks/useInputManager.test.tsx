import { render } from "ink-testing-library";
import React, { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useInputManager } from "../../src/hooks/useInputManager.js";
import type { InputManagerCallbacks } from "../../src/managers/InputManager.js";
import type { Key } from "ink";

// Mock wave-agent-sdk
vi.mock("wave-agent-sdk", () => ({
  searchFiles: vi.fn().mockResolvedValue([]),
  PromptHistoryManager: {
    addEntry: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock clipboard utils
vi.mock("../../src/utils/clipboard.js", () => ({
  readClipboardImage: vi.fn(),
}));

describe("useInputManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper component to test the hook
  function TestComponent({
    onHookValue,
    callbacks = {},
  }: {
    onHookValue: (value: ReturnType<typeof useInputManager>) => void;
    callbacks?: Partial<InputManagerCallbacks>;
  }) {
    const hookValue = useInputManager(callbacks);
    useEffect(() => {
      onHookValue(hookValue);
    }, [hookValue, onHookValue]);
    return null;
  }

  it("should initialize with default state", async () => {
    let lastValue: ReturnType<typeof useInputManager> | undefined;
    render(
      <TestComponent
        onHookValue={(val) => {
          lastValue = val;
        }}
      />,
    );

    await vi.waitFor(() => expect(lastValue?.isManagerReady).toBe(true));
    expect(lastValue?.inputText).toBe("");
    expect(lastValue?.showTaskManager).toBe(false);
  });

  it("should toggle showTaskManager when setShowTaskManager is called", async () => {
    let lastValue: ReturnType<typeof useInputManager> | undefined;
    render(
      <TestComponent
        onHookValue={(val) => {
          lastValue = val;
        }}
      />,
    );

    await vi.waitFor(() => expect(lastValue?.isManagerReady).toBe(true));

    lastValue?.setShowTaskManager(true);
    await vi.waitFor(() => expect(lastValue?.showTaskManager).toBe(true));

    lastValue?.setShowTaskManager(false);
    await vi.waitFor(() => expect(lastValue?.showTaskManager).toBe(false));
  });

  it("should handle Ctrl+T to toggle task manager", async () => {
    let lastValue: ReturnType<typeof useInputManager> | undefined;
    render(
      <TestComponent
        onHookValue={(val) => {
          lastValue = val;
        }}
      />,
    );

    await vi.waitFor(() => expect(lastValue?.isManagerReady).toBe(true));

    const ctrlTKey = { ctrl: true } as unknown as Key;
    await lastValue?.handleInput("t", ctrlTKey, []);

    await vi.waitFor(() => expect(lastValue?.showTaskManager).toBe(true));

    // Toggle off
    await lastValue?.handleInput("t", ctrlTKey, []);
    await vi.waitFor(() => expect(lastValue?.showTaskManager).toBe(false));
  });
});

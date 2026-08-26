import React, { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render as originalRender } from "ink-testing-library";
import { InputBox } from "../../src/components/InputBox.js";
import { stripAnsiColors } from "wave-agent-sdk";
import type { PlanViewData } from "../../src/contexts/useChat.js";

let unmounts: Array<() => void> = [];
const render = (tree: React.ReactElement) => {
  const result = originalRender(tree);
  unmounts.push(result.unmount);
  return result;
};

afterEach(() => {
  unmounts.forEach((u) => u());
  unmounts = [];
});

vi.mock("wave-agent-sdk", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    PromptHistoryManager: {
      addEntry: vi.fn().mockResolvedValue(undefined),
      searchHistory: vi.fn().mockResolvedValue([]),
    },
  };
});

const mockSetPermissionMode = vi.fn();
const mockHandlePlanCommand = vi.fn();
const mockPlanView: { value: PlanViewData | null } = { value: null };

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: () => {
    // The mock mirrors the real useChat: planView is useState-backed and the
    // setter triggers a re-render (Escape in PlanView calls setPlanView(null)).
    const [, forceRender] = useState(0);
    return {
      permissionMode: "default",
      setPermissionMode: mockSetPermissionMode,
      setIsBtwActive: vi.fn(),
      backgroundTasks: [],
      messages: [],
      handleRewindSelect: vi.fn(),
      backgroundCurrentTask: vi.fn(),
      planView: mockPlanView.value,
      setPlanView: (view: PlanViewData | null) => {
        mockPlanView.value = view;
        forceRender((n) => n + 1);
      },
      handlePlanCommand: mockHandlePlanCommand,
    };
  },
}));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("InputBox /plan overlay", () => {
  it("renders the PlanView overlay and hides the input row when planView is set", async () => {
    mockPlanView.value = {
      path: "/tmp/plan.md",
      content: "plan line 1\nplan line 2",
    };

    const { lastFrame } = render(<InputBox />);

    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("Current Plan");
      expect(frame).toContain("/tmp/plan.md");
      expect(frame).toContain("plan line 1");
      expect(frame).toContain("Press Escape to continue");
      expect(frame).not.toContain("Type your message"); // input row hidden
    });
  });

  it("renders a status-only overlay for the message state", async () => {
    mockPlanView.value = { message: "Enabled plan mode" };

    const { lastFrame } = render(<InputBox />);

    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("Enabled plan mode");
      expect(frame).not.toContain("Current Plan");
    });
  });

  it("dismisses the overlay with Escape and restores the input row", async () => {
    mockPlanView.value = {
      content: "plan line 1",
    };

    const { stdin, lastFrame } = render(<InputBox />);
    await sleep(30);

    stdin.write("\u001B"); // Escape → PlanView onCancel → setPlanView(null)
    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).not.toContain("Current Plan");
      expect(frame).toContain("Type your message");
    });
    expect(mockPlanView.value).toBeNull();
  });

  it("routes the /plan command to handlePlanCommand through the input manager", async () => {
    mockPlanView.value = null;
    const { stdin, lastFrame } = render(<InputBox />);
    await sleep(30);

    stdin.write("/plan Add user auth");
    await sleep(30);
    stdin.write("\r"); // Enter
    await sleep(30);

    expect(mockHandlePlanCommand).toHaveBeenCalledWith("Add user auth");
    const frame = stripAnsiColors(lastFrame() || "");
    expect(frame).not.toContain("/plan Add user auth"); // consumed, not echoed
  });
});

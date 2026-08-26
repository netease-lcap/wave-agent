import { render } from "ink-testing-library";
import React, { createRef } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useInputManager } from "../../src/hooks/useInputManager.js";
import { HookTester, HookTesterRef } from "../helpers/HookTester.js";

type InputManagerState = ReturnType<typeof useInputManager>;

describe("useInputManager /plan command", () => {
  const onPlanCommand = vi.fn();

  const setup = () => {
    const ref = createRef<HookTesterRef<unknown>>();
    render(
      <HookTester
        ref={ref}
        hook={() =>
          useInputManager({
            onPlanCommand,
            onHasSlashCommand: () => false,
          })
        }
      />,
    );
    const getState = () => ref.current?.getState() as InputManagerState;
    return { getState };
  };

  beforeEach(() => {
    onPlanCommand.mockClear();
  });

  it("should call onPlanCommand with undefined when bare /plan is selected from the command selector", async () => {
    const { getState } = setup();
    await vi.waitFor(() => {
      expect(refReady(getState)).toBe(true);
    });

    // Typing "/plan" opens the command selector (slash trigger); Enter selects
    // the highlighted command rather than submitting the raw text.
    getState().handlePasteInput("/plan");
    await vi.waitFor(() => {
      expect(getState().showCommandSelector).toBe(true);
    });
    getState().handleCommandSelect("plan");

    await vi.waitFor(() => {
      expect(onPlanCommand).toHaveBeenCalledTimes(1);
    });
    expect(onPlanCommand).toHaveBeenCalledWith(undefined);
  });

  it("should call onPlanCommand with the description for /plan <desc>", async () => {
    const { getState } = setup();
    await vi.waitFor(() => {
      expect(refReady(getState)).toBe(true);
    });

    getState().handlePasteInput("/plan Add user auth");
    await getState().handleSubmit();

    await vi.waitFor(() => {
      expect(onPlanCommand).toHaveBeenCalledWith("Add user auth");
    });
  });

  it("should call onPlanCommand with open for /plan open", async () => {
    const { getState } = setup();
    await vi.waitFor(() => {
      expect(refReady(getState)).toBe(true);
    });

    getState().handlePasteInput("/plan open");
    await getState().handleSubmit();

    await vi.waitFor(() => {
      expect(onPlanCommand).toHaveBeenCalledWith("open");
    });
  });

  it("should not send unknown /commands to onPlanCommand", async () => {
    const onSendMessage = vi.fn();
    const ref = createRef<HookTesterRef<unknown>>();
    render(
      <HookTester
        ref={ref}
        hook={() =>
          useInputManager({
            onPlanCommand,
            onSendMessage,
            onHasSlashCommand: () => false,
          })
        }
      />,
    );
    const getState = () => ref.current?.getState() as InputManagerState;
    await vi.waitFor(() => {
      expect(refReady(getState)).toBe(true);
    });

    // A description after the command avoids the slash-triggered selector, so
    // the input submits normally and routes to SEND_MESSAGE.
    getState().handlePasteInput("/unknown-command arg");
    await getState().handleSubmit();

    await vi.waitFor(() => {
      expect(onSendMessage).toHaveBeenCalledWith(
        "/unknown-command arg",
        undefined,
        {},
      );
    });
    expect(onPlanCommand).not.toHaveBeenCalled();
  });
});

// The HookTester ref is populated only after the first render commits.
const refReady = (getState: () => InputManagerState | undefined): boolean =>
  getState() !== undefined;

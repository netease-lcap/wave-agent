import { render } from "ink-testing-library";
import React, { createRef } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useInputManager } from "../../src/hooks/useInputManager.js";
import { HookTester, HookTesterRef } from "../helpers/HookTester.js";

type InputManagerState = ReturnType<typeof useInputManager>;

// /plan is now a builtin slashCommandManager command (aligned with /subtask):
// once registered, hasSlashCommand("plan") is true and the command routes to
// onSendMessage → agent.slashCommandManager (which surfaces the output as a
// user-message tool block). No CLI-local plan handler remains.
describe("useInputManager /plan command", () => {
  const onSendMessage = vi.fn();
  const onHasSlashCommand = (command: string) => command === "plan";

  const setup = () => {
    const ref = createRef<HookTesterRef<unknown>>();
    render(
      <HookTester
        ref={ref}
        hook={() =>
          useInputManager({
            onSendMessage,
            onHasSlashCommand,
          })
        }
      />,
    );
    const getState = () => ref.current?.getState() as InputManagerState;
    return { getState };
  };

  beforeEach(() => {
    onSendMessage.mockClear();
  });

  it("should route bare /plan from the command selector to onSendMessage", async () => {
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
      expect(onSendMessage).toHaveBeenCalledTimes(1);
    });
    expect(onSendMessage).toHaveBeenCalledWith("/plan", undefined, {});
  });

  it("should route /plan <desc> to onSendMessage with the full command", async () => {
    const { getState } = setup();
    await vi.waitFor(() => {
      expect(refReady(getState)).toBe(true);
    });

    getState().handlePasteInput("/plan Add user auth");
    await getState().handleSubmit();

    await vi.waitFor(() => {
      expect(onSendMessage).toHaveBeenCalledWith(
        "/plan Add user auth",
        undefined,
        {},
      );
    });
  });

  it("should route /plan open to onSendMessage", async () => {
    const { getState } = setup();
    await vi.waitFor(() => {
      expect(refReady(getState)).toBe(true);
    });

    getState().handlePasteInput("/plan open");
    await getState().handleSubmit();

    await vi.waitFor(() => {
      expect(onSendMessage).toHaveBeenCalledWith("/plan open", undefined, {});
    });
  });

  it("should not treat unknown /commands as /plan", async () => {
    const ref = createRef<HookTesterRef<unknown>>();
    render(
      <HookTester
        ref={ref}
        hook={() =>
          useInputManager({
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
  });
});

// The HookTester ref is populated only after the first render commits.
const refReady = (getState: () => InputManagerState | undefined): boolean =>
  getState() !== undefined;

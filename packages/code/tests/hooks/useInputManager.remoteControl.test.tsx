import { render } from "../helpers/inkHarness.js";
import React, { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { useInputManager } from "../../src/hooks/useInputManager.js";
import { HookTester, HookTesterRef } from "../helpers/HookTester.js";

type InputManagerState = ReturnType<typeof useInputManager>;

/**
 * `/remote-control` opens the remote-control overlay and takes no arguments:
 * the panel itself shows the state and the one action that is valid right now,
 * so there is no `on` / `off` / `status` grammar to hand through.
 * (spec: docs/specs/ui/remote-control.md, 前台 CLI 故事场景 13)
 */
describe("useInputManager /remote-control command", () => {
  const setup = () => {
    const ref = createRef<HookTesterRef<unknown>>();
    render(
      <HookTester
        ref={ref}
        hook={() =>
          useInputManager({
            onHasSlashCommand: () => false,
          })
        }
      />,
    );
    const getState = () => ref.current?.getState() as InputManagerState;
    return { getState };
  };

  it("should open the remote-control overlay for /remote-control <args>", async () => {
    const { getState } = setup();
    await vi.waitFor(() => {
      expect(getState()).toBeDefined();
    });
    expect(getState().showRemoteControl).toBe(false);

    getState().handlePasteInput("/remote-control off");
    await getState().handleSubmit();

    await vi.waitFor(() => {
      expect(getState().showRemoteControl).toBe(true);
    });
  });

  it("should open the remote-control overlay when bare /remote-control is selected from the command selector", async () => {
    const { getState } = setup();
    await vi.waitFor(() => {
      expect(getState()).toBeDefined();
    });

    getState().handlePasteInput("/remote-control");
    await vi.waitFor(() => {
      expect(getState().showCommandSelector).toBe(true);
    });
    getState().handleCommandSelect("remote-control");

    await vi.waitFor(() => {
      expect(getState().showRemoteControl).toBe(true);
    });
  });

  it("should not route unknown commands to the remote-control overlay", async () => {
    const onSendMessage = vi.fn();
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
      expect(getState()).toBeDefined();
    });

    getState().handlePasteInput("/remote-controller on");
    await getState().handleSubmit();

    await vi.waitFor(() => {
      expect(onSendMessage).toHaveBeenCalledWith(
        "/remote-controller on",
        undefined,
        {},
      );
    });
    expect(getState().showRemoteControl).toBe(false);
  });
});

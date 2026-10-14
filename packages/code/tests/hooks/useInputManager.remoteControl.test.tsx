import { render } from "ink-testing-library";
import React, { createRef } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useInputManager } from "../../src/hooks/useInputManager.js";
import { HookTester, HookTesterRef } from "../helpers/HookTester.js";

type InputManagerState = ReturnType<typeof useInputManager>;

describe("useInputManager /remote-control command", () => {
  const onRemoteControlCommand = vi.fn();

  const setup = () => {
    const ref = createRef<HookTesterRef<unknown>>();
    render(
      <HookTester
        ref={ref}
        hook={() =>
          useInputManager({
            onRemoteControlCommand,
            onHasSlashCommand: () => false,
          })
        }
      />,
    );
    const getState = () => ref.current?.getState() as InputManagerState;
    return { getState };
  };

  beforeEach(() => {
    onRemoteControlCommand.mockClear();
  });

  it("should hand the subcommand through for /remote-control <args>", async () => {
    const { getState } = setup();
    await vi.waitFor(() => {
      expect(getState()).toBeDefined();
    });

    getState().handlePasteInput("/remote-control off");
    await getState().handleSubmit();

    await vi.waitFor(() => {
      expect(onRemoteControlCommand).toHaveBeenCalledWith("off");
    });
  });

  it("should call onRemoteControlCommand with undefined when bare /remote-control is selected from the command selector", async () => {
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
      expect(onRemoteControlCommand).toHaveBeenCalledWith(undefined);
    });
  });

  it("should not route unknown commands to onRemoteControlCommand", async () => {
    const onSendMessage = vi.fn();
    const ref = createRef<HookTesterRef<unknown>>();
    render(
      <HookTester
        ref={ref}
        hook={() =>
          useInputManager({
            onRemoteControlCommand,
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
    expect(onRemoteControlCommand).not.toHaveBeenCalled();
  });
});

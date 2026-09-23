import { render } from "ink-testing-library";
import React, { createRef } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useInputManager } from "../../src/hooks/useInputManager.js";
import { HookTester, HookTesterRef } from "../helpers/HookTester.js";

type InputManagerState = ReturnType<typeof useInputManager>;

describe("useInputManager /rename command", () => {
  const onRenameSession = vi.fn();

  const setup = () => {
    const ref = createRef<HookTesterRef<unknown>>();
    render(
      <HookTester
        ref={ref}
        hook={() =>
          useInputManager({
            onRenameSession,
            onHasSlashCommand: () => false,
          })
        }
      />,
    );
    const getState = () => ref.current?.getState() as InputManagerState;
    return { getState };
  };

  beforeEach(() => {
    onRenameSession.mockClear();
  });

  it("should call onRenameSession with the title for /rename <title>", async () => {
    const { getState } = setup();
    await vi.waitFor(() => {
      expect(getState()).toBeDefined();
    });

    getState().handlePasteInput("/rename My title");
    await getState().handleSubmit();

    await vi.waitFor(() => {
      expect(onRenameSession).toHaveBeenCalledWith("My title");
    });
  });

  it("should call onRenameSession with undefined when bare /rename is selected from the command selector", async () => {
    const { getState } = setup();
    await vi.waitFor(() => {
      expect(getState()).toBeDefined();
    });

    // Typing "/rename" opens the command selector; Enter selects the command.
    getState().handlePasteInput("/rename");
    await vi.waitFor(() => {
      expect(getState().showCommandSelector).toBe(true);
    });
    getState().handleCommandSelect("rename");

    await vi.waitFor(() => {
      expect(onRenameSession).toHaveBeenCalledWith(undefined);
    });
  });

  it("should not route unknown commands to onRenameSession", async () => {
    const onSendMessage = vi.fn();
    const ref = createRef<HookTesterRef<unknown>>();
    render(
      <HookTester
        ref={ref}
        hook={() =>
          useInputManager({
            onRenameSession,
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

    getState().handlePasteInput("/rename-it arg");
    await getState().handleSubmit();

    await vi.waitFor(() => {
      expect(onSendMessage).toHaveBeenCalledWith(
        "/rename-it arg",
        undefined,
        {},
      );
    });
    expect(onRenameSession).not.toHaveBeenCalled();
  });
});

import { render } from "../helpers/inkHarness.js";
import React, { createRef } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useInputManager } from "../../src/hooks/useInputManager.js";
import { HookTester, HookTesterRef } from "../helpers/HookTester.js";

type InputManagerState = ReturnType<typeof useInputManager>;

/**
 * Agent-side slash commands read their arguments out of the message text, so
 * the CLI has to forward the whole line — `/subtask <task>` dispatched as a
 * bare `/subtask` would start a subtask with nothing to do.
 */
describe("useInputManager / agent-side slash command arguments", () => {
  const onSendMessage = vi.fn();

  const setup = () => {
    const ref = createRef<HookTesterRef<unknown>>();
    render(
      <HookTester
        ref={ref}
        hook={() =>
          useInputManager({
            onSendMessage,
            onHasSlashCommand: (command) => command === "subtask",
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

  it("should forward the arguments of an agent-side slash command", async () => {
    const { getState } = setup();
    await vi.waitFor(() => {
      expect(getState()).toBeDefined();
    });

    getState().handlePasteInput("/subtask summarize the repo");
    await getState().handleSubmit();

    await vi.waitFor(() => {
      expect(onSendMessage).toHaveBeenCalledWith(
        "/subtask summarize the repo",
        undefined,
        {},
      );
    });
  });

  it("should keep a multi-line task list intact", async () => {
    const { getState } = setup();
    await vi.waitFor(() => {
      expect(getState()).toBeDefined();
    });

    getState().handlePasteInput("/subtask fix these\n1. a\n2. b");
    await getState().handleSubmit();

    await vi.waitFor(() => {
      expect(onSendMessage).toHaveBeenCalledWith(
        "/subtask fix these\n1. a\n2. b",
        undefined,
        {},
      );
    });
  });
});

import { describe, it, expect } from "vitest";
import type { Key } from "ink";
import {
  handleWorkflowAgentKey,
  initialWorkflowAgentView,
  type WorkflowAgentView,
} from "../../src/reducers/workflowAgentView.js";

const key = (partial: Partial<Key>): Key => partial as unknown as Key;

describe("handleWorkflowAgentKey", () => {
  const list = (selectedIndex: number): WorkflowAgentView => ({
    selectedIndex,
    openIndex: null,
  });

  it("moves the highlight and clamps at both ends", () => {
    // One below the top stays at the top instead of wrapping to the last row.
    expect(handleWorkflowAgentKey(list(0), key({ upArrow: true }), 3)).toEqual({
      handled: true,
      view: { selectedIndex: 0, openIndex: null },
    });
    expect(
      handleWorkflowAgentKey(list(0), key({ downArrow: true }), 3),
    ).toEqual({ handled: true, view: { selectedIndex: 1, openIndex: null } });
    expect(
      handleWorkflowAgentKey(list(2), key({ downArrow: true }), 3),
    ).toEqual({ handled: true, view: { selectedIndex: 2, openIndex: null } });
  });

  it("opens the highlighted row on Enter", () => {
    expect(handleWorkflowAgentKey(list(1), key({ return: true }), 3)).toEqual({
      handled: true,
      view: { selectedIndex: 1, openIndex: 1 },
    });
  });

  it("closes the card on Escape and on the left arrow", () => {
    const open: WorkflowAgentView = { selectedIndex: 1, openIndex: 1 };
    for (const close of [key({ escape: true }), key({ leftArrow: true })]) {
      expect(handleWorkflowAgentKey(open, close, 3)).toEqual({
        handled: true,
        view: { selectedIndex: 1, openIndex: null },
      });
    }
  });

  it("leaves the run's own keys alone while a card is open", () => {
    // `k` (stop) and `s` (save) still describe the run the card is a lens on,
    // so they must reach the run-level handler; so must ↑/↓.
    const open: WorkflowAgentView = { selectedIndex: 1, openIndex: 1 };
    for (const untouched of [
      key({ upArrow: true }),
      key({ downArrow: true }),
      key({ return: true }),
    ]) {
      expect(handleWorkflowAgentKey(open, untouched, 3)).toEqual({
        handled: false,
      });
    }
  });

  it("falls through when the run started no agent", () => {
    // An empty list owns nothing, otherwise ↑/↓ would stop moving the run list
    // behind a detail view with no rows to move in.
    for (const k of [
      key({ upArrow: true }),
      key({ downArrow: true }),
      key({ return: true }),
      key({ escape: true }),
    ]) {
      expect(handleWorkflowAgentKey(initialWorkflowAgentView, k, 0)).toEqual({
        handled: false,
      });
    }
  });

  it("falls through in the list for keys it does not own", () => {
    expect(handleWorkflowAgentKey(list(0), key({ tab: true }), 2)).toEqual({
      handled: false,
    });
  });
});

import type { Key } from "ink";

/**
 * Where the user is inside one run's agent list (spec
 * `multi-agent/workflow.md`「查看单个 agent 的执行详情」).
 *
 * The two CLI panels that inspect a run — `/workflows` and `/tasks` — both
 * drill from "run detail" into "agent list" into "agent card", and that is the
 * only place the three states can disagree. Keeping the shape here (instead of
 * a copy inside each reducer) is what stops them from drifting the way the
 * renderers themselves would if they each modelled the run twice.
 *
 * Indices are **positions in `run.agents`**, not `agent.index`: the list only
 * ever grows, and the row the user picked is what "back" has to return to.
 */
export interface WorkflowAgentView {
  /** Highlighted row in the run's agent list. */
  selectedIndex: number;
  /** Row whose card is open, or `null` while the list is showing. */
  openIndex: number | null;
}

export const initialWorkflowAgentView: WorkflowAgentView = {
  selectedIndex: 0,
  openIndex: null,
};

export type WorkflowAgentKeyResult =
  /** Not an agent-list key: the panel's own detail keys keep working. */
  { handled: false } | { handled: true; view: WorkflowAgentView };

/**
 * Agent-list keys inside a run's detail view: ↑/↓ move, Enter opens a card,
 * Esc / ← close it.
 *
 * Once a card is open only the way out is consumed — the run-level keys (`k`
 * stop, `s` save) still act on the run they describe, because the card is a
 * lens on that same run.
 */
export function handleWorkflowAgentKey(
  view: WorkflowAgentView,
  key: Key,
  agentCount: number,
): WorkflowAgentKeyResult {
  if (view.openIndex !== null) {
    if (key.escape || key.leftArrow) {
      return { handled: true, view: { ...view, openIndex: null } };
    }
    return { handled: false };
  }

  if (agentCount === 0) return { handled: false };

  if (key.upArrow) {
    return {
      handled: true,
      view: { ...view, selectedIndex: Math.max(0, view.selectedIndex - 1) },
    };
  }

  if (key.downArrow) {
    return {
      handled: true,
      view: {
        ...view,
        selectedIndex: Math.min(agentCount - 1, view.selectedIndex + 1),
      },
    };
  }

  if (key.return) {
    return {
      handled: true,
      view: {
        ...view,
        selectedIndex: Math.min(agentCount - 1, view.selectedIndex),
        openIndex: Math.min(agentCount - 1, view.selectedIndex),
      },
    };
  }

  return { handled: false };
}

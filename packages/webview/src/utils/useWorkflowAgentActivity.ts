/**
 * Tail of one workflow agent's activity log (spec
 * `multi-agent/workflow.md`「查看单个 agent 的执行详情」).
 *
 * The host owns the file — `<runDir>/agents/<index>.log`, the same shape a
 * background subagent's log has — so the panel can only ask for it. Two rules
 * come from the earlier task-output surface and are kept identical here:
 *
 * - one read per (runId, agentIndex, running) transition, plus a fixed cadence
 *   while the agent still runs (a terminal agent never moves again, so polling
 *   it would only spend frames);
 * - replies carry the page's `requestId` and only the newest one lands: a
 *   1.5 s poll and a selection change can be in flight together, and the older
 *   answer must never be painted onto the agent the user just moved to.
 */

import { useEffect, useRef, useState } from "react";
import { useHostMessage } from "./useHostMessage";
import { BACKGROUND_TASK_OUTPUT_POLL_MS } from "./useBackgroundTaskDetail";

/**
 * Activity lines rendered on this side. Claude Code's workflow agent card shows
 * the last 20 tool calls; the CLI panel caps at 10 because an Ink panel cannot
 * scroll (spec 场景 2).
 */
export const WORKFLOW_AGENT_ACTIVITY_LINES = 20;

export interface UseWorkflowAgentActivityOptions {
  runId: string;
  agentIndex: number;
  /** The selected agent is still running — keep re-reading its log. */
  running: boolean;
  vscode: { postMessage: (msg: unknown) => void };
}

/**
 * Monotonic request counter, module-level on purpose: the card unmounts and
 * remounts every time the user opens another agent, so a per-component counter
 * restarts at 1 and a reply for the previous card would carry the same id as
 * the new card's request — which is exactly the "late answer paints the wrong
 * agent" case the ids exist to prevent.
 */
let requestSeq = 0;

export function useWorkflowAgentActivity({
  runId,
  agentIndex,
  running,
  vscode,
}: UseWorkflowAgentActivityOptions): string {
  // The last reply we accepted, tagged with the agent it belongs to: the panel
  // re-renders for the NEXT agent before its read comes back, so "is this text
  // even about the agent on screen?" has to be answerable during render — that
  // is what keeps the previous agent's lines off the panel (previously an
  // effect blanked the state one frame later).
  const [activity, setActivity] = useState<{
    runId: string;
    agentIndex: number;
    lines: string;
  } | null>(null);
  // The newest request this panel issued, with the agent it asked about. Any
  // reply carrying an older id describes an agent the user has already left.
  const pendingRef = useRef<{
    requestId: string;
    runId: string;
    agentIndex: number;
  } | null>(null);

  // Kept in a ref so the read never changes identity: the effect below is keyed
  // on (runId, agentIndex) only, and a re-created callback would restart the
  // read (and the poll) on every render.
  const readRef = useRef<() => void>(() => {});
  readRef.current = () => {
    requestSeq += 1;
    const requestId = `workflow-agent-${requestSeq}`;
    pendingRef.current = { requestId, runId, agentIndex };
    vscode.postMessage({
      command: "getWorkflowAgentActivity",
      requestId,
      runId,
      agentIndex,
    });
  };

  useEffect(() => {
    // Selection changed: the stored lines belong to another (runId, agentIndex),
    // so the returned value below already reads as empty until the new read
    // lands — all this effect has to do is start that read.
    readRef.current();
  }, [runId, agentIndex]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(
      () => readRef.current(),
      BACKGROUND_TASK_OUTPUT_POLL_MS,
    );
    return () => clearInterval(timer);
  }, [runId, agentIndex, running]);

  useHostMessage((message) => {
    if (message.command !== "workflowAgentActivity") return;
    const pending = pendingRef.current;
    if (!pending || message.requestId !== pending.requestId) return;
    pendingRef.current = null;
    setActivity({
      runId: pending.runId,
      agentIndex: pending.agentIndex,
      lines: typeof message.activity === "string" ? message.activity : "",
    });
  });

  // Lines are shown only while they belong to the agent on screen.
  return activity &&
    activity.runId === runId &&
    activity.agentIndex === agentIndex
    ? activity.lines
    : "";
}

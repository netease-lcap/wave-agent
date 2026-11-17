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
  const [activity, setActivity] = useState("");
  // The newest request this panel issued. Any reply carrying an older id
  // describes an agent the user has already left.
  const pendingRef = useRef<string | null>(null);

  // Kept in a ref so the read never changes identity: the effect below is keyed
  // on (runId, agentIndex) only, and a re-created callback would re-clear the
  // panel on every render.
  const readRef = useRef<() => void>(() => {});
  readRef.current = () => {
    requestSeq += 1;
    const requestId = `workflow-agent-${requestSeq}`;
    pendingRef.current = requestId;
    vscode.postMessage({
      command: "getWorkflowAgentActivity",
      requestId,
      runId,
      agentIndex,
    });
  };

  useEffect(() => {
    // Selection changed: never show the previous agent's lines while the new
    // read is in flight.
    setActivity("");
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
    if (!pendingRef.current || message.requestId !== pendingRef.current) return;
    pendingRef.current = null;
    setActivity(typeof message.activity === "string" ? message.activity : "");
  });

  return activity;
}

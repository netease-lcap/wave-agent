/**
 * WorkflowAgentDetail — one workflow agent's own card, rendered for the terminal.
 *
 * Same information model as the webview's agent card (spec
 * `multi-agent/workflow.md`「查看单个 agent 的执行详情」场景 2): title, `Prompt`,
 * `Activity`, `Outcome`. The carrier is what differs — Ink text lines, and the
 * activity tail is capped at 10 lines because a TUI panel does not scroll
 * (matching this panel's OUTPUT block convention).
 *
 * Activity is the tail of `agents/<index>.log`, read in-process (CLI embeds the
 * Agent) on the same 1.5 s cadence the run itself is rendered at, and only
 * while the agent still runs.
 */

import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { getLastLines } from "wave-agent-sdk";
import type { WorkflowAgentState } from "wave-agent-sdk";
import { useChat } from "../contexts/useChat.js";
import { agentStatusColor } from "./WorkflowRunDetail.js";

/** Activity lines an Ink panel can afford — see `MAX_RUN_LOG_LINES`. */
export const MAX_AGENT_ACTIVITY_LINES = 10;

/**
 * Poll cadence while the agent runs. The same value the webview uses (and the
 * background-task output poll) — one constant per side, because the CLI reads
 * in-process and must not import the webview's module.
 */
export const AGENT_ACTIVITY_POLL_MS = 1500;

/** What this agent's Outcome block says, in the order the states degrade. */
export const agentOutcomeText = (agent: WorkflowAgentState): string => {
  // Replayed from a previous run's journal: no subagent ran, so there is no
  // result to preview and no log to tail.
  if (agent.cached) return "来自恢复日志";
  switch (agent.status) {
    case "completed":
      return agent.resultPreview || "已完成";
    case "failed":
      return agent.error || "失败";
    case "skipped":
      return agent.error ? `已被跳过：${agent.error}` : "已被跳过";
    case "interrupted":
      return agent.error || "进程已结束";
    default:
      return "仍在运行";
  }
};

const WorkflowAgentDetail: React.FC<{
  runId: string;
  agent: WorkflowAgentState;
}> = ({ runId, agent }) => {
  const { getWorkflowAgentActivity } = useChat();
  const [activity, setActivity] = useState("");
  const running = agent.status === "running";

  // One read per (run, agent) and a fixed cadence while it runs. A terminal
  // agent never logs again, so polling it would only repaint the same tail; a
  // replayed (`cached`) agent never ran here at all, so its file cannot exist —
  // reading it would be one pointless cross-process call per card.
  useEffect(() => {
    if (agent.cached) return;
    setActivity(getWorkflowAgentActivity(runId, agent.index));
    if (!running) return;
    const timer = setInterval(() => {
      setActivity(getWorkflowAgentActivity(runId, agent.index));
    }, AGENT_ACTIVITY_POLL_MS);
    return () => clearInterval(timer);
  }, [runId, agent.index, agent.cached, running, getWorkflowAgentActivity]);

  const lines = getLastLines(activity, MAX_AGENT_ACTIVITY_LINES).trim();
  const outcome = agentOutcomeText(agent);

  return (
    <>
      <Text>
        <Text color="cyan" bold>
          Agent #{agent.index + 1}
        </Text>{" "}
        {agent.label || agent.agentType || "agent"}
        {" · "}
        <Text color={agentStatusColor(agent.status)}>{agent.status}</Text>
      </Text>

      {agent.promptPreview && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="cyan" bold>
            Prompt:
          </Text>
          <Box marginLeft={2}>
            <Text>{agent.promptPreview}</Text>
          </Box>
        </Box>
      )}

      {/* No log file exists for an agent replayed from the journal, so the block
          is dropped rather than shown empty (spec 场景 2/5). */}
      {!agent.cached && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="cyan" bold>
            Activity (last {MAX_AGENT_ACTIVITY_LINES} lines):
          </Text>
          <Box marginLeft={2}>
            <Text dimColor={!lines}>{lines || "暂无活动"}</Text>
          </Box>
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Text color="cyan" bold>
          Outcome:
        </Text>
        <Box marginLeft={2}>
          <Text color={agentStatusColor(agent.status)}>{outcome}</Text>
        </Box>
      </Box>
    </>
  );
};

export default WorkflowAgentDetail;

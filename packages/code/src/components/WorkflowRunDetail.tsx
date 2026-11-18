/**
 * WorkflowRunDetail - one workflow run's own fields, rendered for the terminal.
 *
 * Rendered by the CLI's background-task panel when the selected task is a
 * workflow (a workflow background task's id IS its run id, so the panel joins on
 * it); `/workflows` opens that same panel (2026-11-18: the standalone workflow
 * panel is gone). One component, so the two commands cannot disagree about what
 * a run's progress looks like.
 *
 * The information set matches what the webview renders through
 * `WorkflowRunProgress` — same fields, same order, same zero-value rules — but
 * the carrier differs: Ink text lines instead of a DOM block, and the log lines
 * are capped because an Ink panel does not scroll. That split is the spec's
 * cross-renderer rule (docs/specs/multi-agent/workflow.md 边界情况).
 */

import React from "react";
import { Box, Text } from "ink";
import { getLastLines } from "wave-agent-sdk";
import type { WorkflowRun, WorkflowAgentState } from "wave-agent-sdk";
import {
  WORKFLOW_SIZE_WARNING_AGENTS,
  WORKFLOW_SIZE_WARNING_TOKENS,
} from "wave-agent-sdk/constants";

export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
};

export const formatTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleTimeString();
};

export const formatTokens = (tokens: number): string => {
  if (tokens < 1000) return `${tokens}`;
  // Millions matter here: a run crosses the 1.5M size threshold already showing
  // "1500.0k", and the marker line names that threshold.
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
};

export const workflowStatusColor = (
  status: WorkflowRun["status"],
): "green" | "blue" | "red" | "yellow" => {
  switch (status) {
    case "running":
      return "green";
    case "completed":
      return "blue";
    case "failed":
    case "aborted":
      return "red";
    case "paused":
      return "yellow";
  }
};

/**
 * Log lines rendered. Same convention as this panel's OUTPUT block ("last 10
 * lines"): a TUI panel cannot scroll, and a workflow that logs inside a loop can
 * hold hundreds of retained lines.
 */
export const MAX_RUN_LOG_LINES = 10;

/** Status colour for one agent's row / card (same palette as the run's). */
export const agentStatusColor = (
  status: WorkflowAgentState["status"],
): "green" | "blue" | "red" | "yellow" => {
  switch (status) {
    case "running":
      return "green";
    case "completed":
      return "blue";
    case "failed":
    case "interrupted":
      return "red";
    case "skipped":
      return "yellow";
  }
};

const WorkflowRunDetail: React.FC<{
  run: WorkflowRun;
  /**
   * Highlighted agent row (the CLI's ↑/↓ selection). Left out when the panel
   * has no agent drill-down — the list still renders, just without a cursor.
   */
  agentSelectionIndex?: number;
}> = ({ run, agentSelectionIndex }) => {
  // The thresholds the run was actually judged against: they can be overridden
  // through `WAVE_WORKFLOW_SIZE_WARNING_*`, and printing the constants then
  // would name a number that never applied.
  const limits = run.sizeLimits ?? {
    agents: WORKFLOW_SIZE_WARNING_AGENTS,
    tokens: WORKFLOW_SIZE_WARNING_TOKENS,
  };
  const elapsed = run.endTime
    ? run.endTime - run.startTime
    : Date.now() - run.startTime;
  const logs = run.logs ?? [];
  const failures = run.failures ?? [];

  return (
    <>
      <Box flexDirection="column" gap={0}>
        <Box>
          <Text>
            <Text color="blue">Run ID:</Text> {run.runId}
          </Text>
        </Box>
        {run.meta.description && (
          <Box>
            <Text>
              <Text color="blue">Description:</Text> {run.meta.description}
            </Text>
          </Box>
        )}
        <Box>
          <Text>
            <Text color="blue">Status:</Text>{" "}
            <Text color={workflowStatusColor(run.status)}>{run.status}</Text>
          </Text>
        </Box>
        <Box>
          <Text>
            <Text color="blue">Started:</Text> {formatTime(run.startTime)}
            {run.endTime && (
              <Text>
                {" "}
                | <Text color="blue">Ended:</Text> {formatTime(run.endTime)}
              </Text>
            )}
            {" | "}
            <Text color="blue">Duration:</Text> {formatDuration(elapsed)}
          </Text>
        </Box>
        <Box>
          <Text>
            <Text color="blue">Agents:</Text> {run.totalAgents} {" | "}
            <Text color="blue">Tokens:</Text> {formatTokens(run.totalTokens)}
          </Text>
        </Box>
        {/* Oversized marker (spec「预算与规模硬上限」场景 7): the run is bigger
            than the thresholds, which is the human's cue to stop it — the model
            is never told, so this line has to carry the scale and the
            thresholds itself. Stopping stays with this panel's own affordance
            (the footer's `k`), so the line only names it when the run is still
            running and there is something to stop. */}
        {run.sizeWarning && (
          <Box>
            <Text color="yellow">
              ⚠ Large run: {run.scheduledAgents ?? run.totalAgents} agents /{" "}
              {formatTokens(run.totalTokens)} tokens — over the {limits.agents}{" "}
              agents / {formatTokens(limits.tokens)} tokens threshold.
              {run.status === "running" && " Press k to stop it."}
            </Text>
          </Box>
        )}
        <Box>
          <Text>
            <Text color="blue">Script:</Text> {run.scriptPath}
          </Text>
        </Box>
        {run.error && (
          <Box>
            <Text color="red">
              <Text color="blue">Error:</Text> {run.error}
            </Text>
          </Box>
        )}
      </Box>

      {failures.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red" bold>
            Failures:
          </Text>
          {failures.map((failure, i) => (
            <Box key={i} marginLeft={2}>
              <Text color="red">{failure}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Only render a section that has content: an empty "Phases:" / "Logs:"
          block reads as missing data rather than "nothing happened yet". */}
      {run.phases.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="cyan" bold>
            Phases:
          </Text>
          {run.phases.map((phase, i) => (
            <Box key={i} marginLeft={2}>
              <Text>
                <Text color="blue">{phase.title}</Text>
                {" — "}
                {phase.agentCount} agents | {formatTokens(phase.tokens)} tokens
                | {formatDuration(phase.elapsed)}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Agent list (spec「查看单个 agent 的执行详情」场景 1): one row per started
          agent, same fields and order as the webview. A run without any drops
          the block — an empty "Agents:" title reads as missing data. */}
      {(run.agents ?? []).length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="cyan" bold>
            Agents:
          </Text>
          {(run.agents ?? []).map((agent, position) => {
            const selected = position === agentSelectionIndex;
            // Duration reads only when both ends exist: a running agent's
            // elapsed time would otherwise freeze at whatever frame drew it.
            const duration =
              agent.startTime !== undefined && agent.endTime !== undefined
                ? formatDuration(agent.endTime - agent.startTime)
                : "";
            // Zero counts are dropped so an agent that has not called a tool
            // yet does not claim "0 tools".
            const meta = [
              agent.tokens ? `${formatTokens(agent.tokens)} tokens` : "",
              agent.toolUses
                ? `${agent.toolUses} ${agent.toolUses === 1 ? "tool" : "tools"}`
                : "",
              duration,
            ].filter(Boolean);
            return (
              <Box key={agent.index} marginLeft={2}>
                <Text>
                  {selected ? "▶ " : "  "}
                  {agent.index + 1}.{" "}
                  <Text color="blue">
                    {agent.label || agent.agentType || "agent"}
                  </Text>
                  {" · "}
                  <Text color={agentStatusColor(agent.status)}>
                    {agent.status}
                  </Text>
                  {meta.length > 0 && ` · ${meta.join(" · ")}`}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {logs.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="cyan" bold>
            Logs (last {MAX_RUN_LOG_LINES} lines):
          </Text>
          <Box marginLeft={2}>
            <Text>{getLastLines(logs.join("\n"), MAX_RUN_LOG_LINES)}</Text>
          </Box>
        </Box>
      )}
    </>
  );
};

export default WorkflowRunDetail;

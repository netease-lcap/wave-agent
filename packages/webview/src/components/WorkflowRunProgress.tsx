/**
 * WorkflowRunProgress - the progress block for one workflow run.
 *
 * Rendered wherever a run is inspected: the background-task surface (the
 * desktop right panel's tab, the plugin host's dialog) when the selected task is
 * a workflow, and the agent drill-down inside it. `/workflows` is an alias for
 * that same surface (2026-11-18: the standalone workflow dialog is gone). A
 * workflow background task's id IS its runId, so the run comes straight out of
 * chat state and one component keeps every host from drifting apart — a workflow
 * task that renders "no output" next to a live progress panel reads as stuck
 * (spec `multi-agent/workflow`「在后台任务面板里看到工作流进度」场景 1).
 */

import React, { useState } from "react";
import {
  WORKFLOW_SIZE_WARNING_AGENTS,
  WORKFLOW_SIZE_WARNING_TOKENS,
} from "wave-agent-sdk/constants";
import type { SerializableWorkflowRun, WorkflowAgentState } from "../types";
import { getLastLines } from "../utils/useBackgroundTaskDetail";
import {
  useWorkflowAgentActivity,
  WORKFLOW_AGENT_ACTIVITY_LINES,
} from "../utils/useWorkflowAgentActivity";
import "../styles/WorkflowRunProgress.css";

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
  // "1500.0k", and the oversized line names that threshold.
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
};

export const workflowStatusColor = (status: string): string => {
  switch (status) {
    case "running":
      return "#4ec9b0";
    case "completed":
      return "#569cd6";
    case "failed":
    case "aborted":
    case "interrupted":
      return "#f48771";
    case "paused":
    case "skipped":
      return "#dcdcaa";
    default:
      return "var(--vscode-descriptionForeground)";
  }
};

/** What one agent's Outcome block says, in the order the states can degrade. */
export const agentOutcomeText = (agent: WorkflowAgentState): string => {
  // A resumed run replays journal entries: no subagent ran, so there is no
  // result to preview and no log to tail (spec 场景 2).
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

/**
 * One agent's card: what it was asked to do, what it has been doing, and how it
 * ended. The activity is the tail of its log file — the same simplification the
 * spec chooses over rendering the agent's transcript (spec 边界情况「agent 卡片是
 * 够定位而不是全转录」).
 */
const WorkflowAgentCard: React.FC<{
  runId: string;
  agent: WorkflowAgentState;
  vscode: { postMessage: (msg: unknown) => void };
  onBack: () => void;
}> = ({ runId, agent, vscode, onBack }) => {
  const activity = useWorkflowAgentActivity({
    runId,
    agentIndex: agent.index,
    running: agent.status === "running",
    vscode,
  });
  const lines = getLastLines(activity, WORKFLOW_AGENT_ACTIVITY_LINES).trim();
  const outcome = agentOutcomeText(agent);

  return (
    <>
      <div className="workflow-agent-card-title">
        Agent #{agent.index + 1} · {agent.label || agent.agentType || "agent"} ·{" "}
        <span style={{ color: workflowStatusColor(agent.status) }}>
          {agent.status}
        </span>
      </div>

      {agent.promptPreview && (
        <div className="workflow-run-section">
          <div className="workflow-run-section-title">Prompt:</div>
          <div className="workflow-run-row workflow-run-script">
            {agent.promptPreview}
          </div>
        </div>
      )}

      {/* No log file exists for an agent replayed from the journal, so the
          block is dropped rather than shown empty (spec 场景 2/5). */}
      {!agent.cached && (
        <div
          className="workflow-run-section"
          data-testid="workflow-agent-activity"
        >
          <div className="workflow-run-section-title">
            Activity (last {WORKFLOW_AGENT_ACTIVITY_LINES} lines):
          </div>
          {lines ? (
            <pre className="workflow-run-logs">{lines}</pre>
          ) : (
            <div className="workflow-agent-empty">暂无活动</div>
          )}
        </div>
      )}

      <div className="workflow-run-section">
        <div className="workflow-run-section-title">Outcome:</div>
        <div className="workflow-run-row">{outcome}</div>
      </div>

      <button
        type="button"
        className="workflow-agent-back"
        onClick={onBack}
        data-testid="workflow-agent-back"
      >
        返回运行详情
      </button>
    </>
  );
};

/**
 * The run's agent list: one row per started `agent()` call, same fields and
 * order as the CLI panel (spec 场景 1).
 */
const WorkflowAgentList: React.FC<{
  agents: WorkflowAgentState[];
  onSelect: (agentIndex: number) => void;
}> = ({ agents, onSelect }) => (
  <div className="workflow-run-section" data-testid="workflow-agent-list">
    <div className="workflow-run-section-title">Agents:</div>
    {agents.map((agent) => {
      // Duration reads only when both ends exist: a running agent's elapsed
      // time would otherwise freeze at whatever frame it was rendered.
      const duration =
        agent.startTime !== undefined && agent.endTime !== undefined
          ? formatDuration(agent.endTime - agent.startTime)
          : "";
      // Zero counts are dropped so an agent that has not called a tool yet does
      // not claim "0 tools".
      const meta = [
        agent.status,
        agent.tokens ? `${formatTokens(agent.tokens)} tokens` : "",
        agent.toolUses
          ? `${agent.toolUses} ${agent.toolUses === 1 ? "tool" : "tools"}`
          : "",
        duration,
      ].filter(Boolean);
      return (
        <button
          key={agent.index}
          type="button"
          className="workflow-agent-row"
          onClick={() => onSelect(agent.index)}
          data-testid={`workflow-agent-row-${agent.index}`}
        >
          <span className="workflow-agent-index">#{agent.index + 1}</span>{" "}
          {agent.label || agent.agentType || "agent"}{" "}
          <span className="workflow-agent-meta">{meta.join(" · ")}</span>
        </button>
      );
    })}
  </div>
);

const WorkflowRunProgress: React.FC<{
  run: SerializableWorkflowRun;
  vscode: { postMessage: (msg: unknown) => void };
}> = ({ run, vscode }) => {
  const [selectedAgentIndex, setSelectedAgentIndex] = useState<number | null>(
    null,
  );
  const agents = run.agents ?? [];
  const selectedAgent =
    selectedAgentIndex === null
      ? null
      : (agents.find((a) => a.index === selectedAgentIndex) ?? null);

  // An agent card replaces the run detail (spec 场景 2): the panel is one
  // surface, and the two views would otherwise compete for the same height.
  if (selectedAgent) {
    return (
      <WorkflowAgentCard
        runId={run.runId}
        agent={selectedAgent}
        vscode={vscode}
        onBack={() => setSelectedAgentIndex(null)}
      />
    );
  }

  // 2026-11-11 走查（评论点后台任务面板的 workflow 详情）：「这里也检查并修复」。
  // 原来这一整块是内联 style、颜色写死成 VS Code **暗色**调色板（标签 #569cd6 /
  // 段落标题 #4ec9b0 / 错误 #f48771），放到浅色面上分别只有 2.95 / 2.04 / 2.46，
  // 三个都过不了 AA 4.5。改成类名后样式集中在 styles/WorkflowRunProgress.css：
  // 基档（无宿主前缀）逐值保留旧内联值 —— 这个组件也还长在插件端的任务对话框
  // 里，那处不动，外观必须零变化；桌面端后台任务面板内的覆写才换 token
  // （见该 CSS 的 `[data-host="desktop"] .background-tasks-pane` 段）。

  const elapsed = run.endTime
    ? run.endTime - run.startTime
    : Date.now() - run.startTime;
  const logs = run.logs ?? [];
  const failures = run.failures ?? [];
  // The thresholds the run was actually judged against: they can be overridden
  // through `WAVE_WORKFLOW_SIZE_WARNING_*`, and printing the constants then
  // would name a number that never applied (spec「预算与规模硬上限」场景 7).
  const limits = run.sizeLimits ?? {
    agents: WORKFLOW_SIZE_WARNING_AGENTS,
    tokens: WORKFLOW_SIZE_WARNING_TOKENS,
  };

  return (
    <>
      <div className="workflow-run-row">
        <span className="workflow-run-label">Run ID:</span> {run.runId}
      </div>
      {run.meta.description && (
        <div className="workflow-run-row">
          <span className="workflow-run-label">Description:</span>{" "}
          {run.meta.description}
        </div>
      )}
      <div className="workflow-run-row">
        <span className="workflow-run-label">Started:</span>{" "}
        {formatTime(run.startTime)}
        {run.endTime && (
          <>
            {" | "}
            <span className="workflow-run-label">Ended:</span>{" "}
            {formatTime(run.endTime)}
          </>
        )}
        {" | "}
        <span className="workflow-run-label">Duration:</span>{" "}
        {formatDuration(elapsed)}
      </div>
      <div className="workflow-run-row">
        <span className="workflow-run-label">Agents:</span> {run.totalAgents}
        {" | "}
        <span className="workflow-run-label">Tokens:</span>{" "}
        {formatTokens(run.totalTokens)}
      </div>
      <div className="workflow-run-row workflow-run-script">
        <span className="workflow-run-label">Script:</span> {run.scriptPath}
      </div>
      {/* Oversized marker (spec「预算与规模硬上限」场景 7): past the thresholds is
          the human's cue to stop the run, and the model is never told, so the
          line has to state the scale and the thresholds itself. It renders in
          the run detail of every host that inspects a run (desktop panel tab,
          plugin dialog), each of which shows its own 停止 button while the run
          is running — so the hint points at that button, not at another panel.
          The row-level marker lives in the task list (`BackgroundTasksPane`). */}
      {run.sizeWarning && (
        <div
          data-testid="workflow-oversized"
          className="workflow-run-row workflow-run-oversized"
        >
          <span role="img" aria-label="运行过大">
            ⚠
          </span>{" "}
          运行过大：{run.scheduledAgents ?? run.totalAgents} agents /{" "}
          {formatTokens(run.totalTokens)} tokens · 越过阈值 {limits.agents}{" "}
          agents / {formatTokens(limits.tokens)} tokens
          {run.status === "running" && " · 运行中，可点「停止」按钮中止"}
        </div>
      )}

      {run.error && (
        <div className="workflow-run-row workflow-run-error">
          <span className="workflow-run-label">Error:</span> {run.error}
        </div>
      )}

      {failures.length > 0 && (
        <div className="workflow-run-section">
          <div className="workflow-run-section-title">Failures:</div>
          {failures.map((failure, i) => (
            <div key={i} className="workflow-run-row workflow-run-failure">
              {failure}
            </div>
          ))}
        </div>
      )}

      {/* Only render a section when it has content: an empty "Phases:" /
          "Logs:" block reads as missing data rather than "nothing happened
          yet". */}
      {run.phases.length > 0 && (
        <div className="workflow-run-section">
          <div className="workflow-run-section-title">Phases:</div>
          {run.phases.map((phase, i) => (
            <div key={i} className="workflow-run-row workflow-run-phase">
              <span className="workflow-run-phase-title">{phase.title}</span>
              {" — "}
              {phase.agentCount} agents | {formatTokens(phase.tokens)} tokens |{" "}
              {formatDuration(phase.elapsed)}
            </div>
          ))}
        </div>
      )}

      {/* Agent list (spec「查看单个 agent 的执行详情」场景 1): only agents that
          actually started appear, and a run without any drops the block
          entirely — an empty "Agents:" title reads as missing data. */}
      {agents.length > 0 && (
        <WorkflowAgentList
          agents={agents}
          onSelect={(agentIndex) => setSelectedAgentIndex(agentIndex)}
        />
      )}

      {logs.length > 0 && (
        <div className="workflow-run-section">
          <div className="workflow-run-section-title">Logs:</div>
          <pre className="workflow-run-logs">{logs.join("\n")}</pre>
        </div>
      )}
    </>
  );
};

export default WorkflowRunProgress;

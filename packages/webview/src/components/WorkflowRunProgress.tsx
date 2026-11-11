/**
 * WorkflowRunProgress - the progress block for one workflow run.
 *
 * Shared by the two places a run is inspected: the detail view of the
 * `/workflows` dialog, and the `/tasks` panel when the selected task is a
 * workflow. Both read the same run object out of chat state (a workflow
 * background task's id IS its runId), so rendering it through one component is
 * what keeps the two from drifting apart — a workflow task that renders "no
 * output" next to a live progress panel elsewhere reads as stuck (spec
 * `multi-agent/workflow`「在后台任务面板里看到工作流进度」场景 1).
 */

import React from "react";
import {
  WORKFLOW_SIZE_WARNING_AGENTS,
  WORKFLOW_SIZE_WARNING_TOKENS,
} from "wave-agent-sdk/constants";
import type { SerializableWorkflowRun } from "../types";
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
      return "#f48771";
    case "paused":
      return "#dcdcaa";
    default:
      return "var(--vscode-descriptionForeground)";
  }
};

// 2026-11-11 走查（评论点后台任务面板的 workflow 详情）：「这里也检查并修复」。
// 原来这一整块是内联 style、颜色写死成 VS Code **暗色**调色板（标签 #569cd6 /
// 段落标题 #4ec9b0 / 错误 #f48771），放到浅色面上分别只有 2.95 / 2.04 / 2.46，
// 三个都过不了 AA 4.5。改成类名后样式集中在 styles/WorkflowRunProgress.css：
// 基档（无宿主前缀）逐值保留旧内联值 —— 这个组件还被 /workflows 对话框和插件端
// 的旧任务弹窗复用，那两处本轮不动，外观必须零变化；桌面端后台任务面板内的
// 覆写才换 token（见该 CSS 的 `[data-host="desktop"] .background-tasks-pane` 段）。

const WorkflowRunProgress: React.FC<{ run: SerializableWorkflowRun }> = ({
  run,
}) => {
  const elapsed = run.endTime
    ? run.endTime - run.startTime
    : Date.now() - run.startTime;
  const logs = run.logs ?? [];
  const failures = run.failures ?? [];

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
          both panels that inspect a run (`/workflows` detail and `/tasks`
          detail), and both show their own 停止 button while a run is running —
          so the hint points at that button rather than at another panel. */}
      {run.sizeWarning && (
        <div
          data-testid="workflow-oversized"
          className="workflow-run-row workflow-run-oversized"
        >
          <span role="img" aria-label="运行过大">
            ⚠
          </span>{" "}
          运行过大：{run.totalAgents} agents / {formatTokens(run.totalTokens)}{" "}
          tokens · 越过阈值 {WORKFLOW_SIZE_WARNING_AGENTS} agents /{" "}
          {formatTokens(WORKFLOW_SIZE_WARNING_TOKENS)} tokens
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

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
import type { SerializableWorkflowRun } from "../types";

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
  return `${(tokens / 1000).toFixed(1)}k`;
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

const rowStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "var(--vscode-descriptionForeground)",
};

const labelStyle: React.CSSProperties = { color: "#569cd6" };

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#4ec9b0",
  marginBottom: "4px",
};

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
      <div style={rowStyle}>
        <span style={labelStyle}>Run ID:</span> {run.runId}
      </div>
      {run.meta.description && (
        <div style={rowStyle}>
          <span style={labelStyle}>Description:</span> {run.meta.description}
        </div>
      )}
      <div style={rowStyle}>
        <span style={labelStyle}>Started:</span> {formatTime(run.startTime)}
        {run.endTime && (
          <>
            {" | "}
            <span style={labelStyle}>Ended:</span> {formatTime(run.endTime)}
          </>
        )}
        {" | "}
        <span style={labelStyle}>Duration:</span> {formatDuration(elapsed)}
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Agents:</span> {run.totalAgents}
        {" | "}
        <span style={labelStyle}>Tokens:</span> {formatTokens(run.totalTokens)}
      </div>
      <div
        style={{
          ...rowStyle,
          fontFamily: "var(--vscode-editor-font-family, monospace)",
          wordBreak: "break-all",
        }}
      >
        <span style={labelStyle}>Script:</span> {run.scriptPath}
      </div>
      {run.error && (
        <div style={{ ...rowStyle, color: "#f48771", wordBreak: "break-all" }}>
          <span style={labelStyle}>Error:</span> {run.error}
        </div>
      )}

      {failures.length > 0 && (
        <div style={{ marginTop: "12px" }}>
          <div style={sectionTitleStyle}>Failures:</div>
          {failures.map((failure, i) => (
            <div
              key={i}
              style={{
                ...rowStyle,
                color: "#f48771",
                marginLeft: "8px",
                marginBottom: "2px",
                wordBreak: "break-all",
              }}
            >
              {failure}
            </div>
          ))}
        </div>
      )}

      {/* Only render a section when it has content: an empty "Phases:" /
          "Logs:" block reads as missing data rather than "nothing happened
          yet". */}
      {run.phases.length > 0 && (
        <div style={{ marginTop: "12px" }}>
          <div style={sectionTitleStyle}>Phases:</div>
          {run.phases.map((phase, i) => (
            <div
              key={i}
              style={{
                ...rowStyle,
                marginLeft: "8px",
                marginBottom: "2px",
              }}
            >
              <span style={labelStyle}>{phase.title}</span>
              {" — "}
              {phase.agentCount} agents | {formatTokens(phase.tokens)} tokens |{" "}
              {formatDuration(phase.elapsed)}
            </div>
          ))}
        </div>
      )}

      {logs.length > 0 && (
        <div style={{ marginTop: "12px" }}>
          <div style={sectionTitleStyle}>Logs:</div>
          <pre
            style={{
              background:
                "var(--vscode-textCodeBlock-background, rgba(0,0,0,0.15))",
              padding: "8px",
              borderRadius: "4px",
              fontSize: "12px",
              fontFamily: "var(--vscode-editor-font-family, monospace)",
              maxHeight: "200px",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              margin: 0,
            }}
          >
            {logs.join("\n")}
          </pre>
        </div>
      )}
    </>
  );
};

export default WorkflowRunProgress;

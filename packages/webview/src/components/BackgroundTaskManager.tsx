/**
 * BackgroundTaskManager - background task management dialog
 *
 * Opened via the /tasks slash command. Lists background tasks
 * (shell/subagent/workflow) with status, and lets the user view
 * output and stop running tasks.
 */

import React, { useState, useEffect, useRef } from "react";
import { useClickOutside } from "../utils/useClickOutside";
import { useHostMessage } from "../utils/useHostMessage";
import { BackgroundTaskManagerProps, BackgroundTaskSummary } from "../types";
import "../styles/ConfigurationDialog.css";

interface BackgroundTaskOutput {
  stdout: string;
  stderr: string;
  status: string;
  outputPath?: string;
  type: string;
  exitCode?: number;
}

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
};

const formatTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleTimeString();
};

const getLastLines = (text: string, count: number): string => {
  if (!text) return "";
  const lines = text.split("\n");
  return lines.slice(Math.max(0, lines.length - count)).join("\n");
};

const BackgroundTaskManager: React.FC<
  BackgroundTaskManagerProps & {
    tasks: BackgroundTaskSummary[];
    vscode: { postMessage: (msg: unknown) => void };
  }
> = ({ onClose, tasks, vscode }) => {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [output, setOutput] = useState<BackgroundTaskOutput | null>(null);
  const [loadingOutput, setLoadingOutput] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // The (taskId, status) we last requested output for. The refetch below is
  // keyed on this rather than on `output === null`: the host always answers
  // with an output object (stdout may be an empty string), so a task first
  // inspected while running kept its empty reply forever after finishing.
  const lastOutputRequestRef = useRef<{
    taskId: string;
    status: string;
  } | null>(null);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;

  // Fetch output for the selected task, and refetch whenever its status
  // changes (running → completed/failed/killed) so the terminal output is not
  // missed by a detail view opened while the task was still running.
  useEffect(() => {
    if (!selectedTaskId) {
      setOutput(null);
      lastOutputRequestRef.current = null;
      return;
    }
    if (!selectedTask) {
      return;
    }
    const last = lastOutputRequestRef.current;
    if (
      last &&
      last.taskId === selectedTaskId &&
      last.status === selectedTask.status
    ) {
      return;
    }
    lastOutputRequestRef.current = {
      taskId: selectedTaskId,
      status: selectedTask.status,
    };
    setLoadingOutput(true);
    vscode.postMessage({
      command: "getBackgroundTaskOutput",
      taskId: selectedTaskId,
    });
  }, [selectedTask, selectedTaskId, vscode]);

  useHostMessage((message) => {
    switch (message.command) {
      case "backgroundTaskOutput":
        if (message.taskId === selectedTaskId) {
          setOutput(message.output || null);
          setLoadingOutput(false);
        }
        break;
      case "backgroundTaskStopped":
        setStoppingId(null);
        break;
    }
  });

  const handleStop = (taskId: string) => {
    setStoppingId(taskId);
    vscode.postMessage({ command: "stopBackgroundTask", taskId });
  };

  // Click-outside close (listener registered one tick later inside the hook,
  // so the click that opened this dialog doesn't immediately close it).
  useClickOutside({
    refs: [dialogRef],
    onClickOutside: onClose,
  });

  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (selectedTaskId) {
          setSelectedTaskId(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleEscapeKey);
    return () => document.removeEventListener("keydown", handleEscapeKey);
  }, [onClose, selectedTaskId]);

  const statusColor = (status: string): string => {
    switch (status) {
      case "running":
        return "#4ec9b0";
      case "completed":
        return "#569cd6";
      case "failed":
        return "#f48771";
      case "killed":
        return "#dcdcaa";
      default:
        return "var(--vscode-descriptionForeground)";
    }
  };

  return (
    <div className="configuration-dialog-overlay">
      <div
        ref={dialogRef}
        className="configuration-dialog"
        data-testid="background-task-manager"
        style={{ maxWidth: "760px" }}
      >
        <div className="configuration-dialog-header">
          <h3>后台任务</h3>
        </div>

        <div className="mcp-container">
          {tasks.length === 0 ? (
            <div className="empty-state">
              <p>暂无后台任务</p>
            </div>
          ) : selectedTask ? (
            <div className="mcp-server-list">
              <div className="mcp-server-item">
                <div className="mcp-server-info">
                  <div className="mcp-server-header">
                    <span style={{ color: statusColor(selectedTask.status) }}>
                      ●
                    </span>
                    <span className="mcp-server-name">
                      [{selectedTask.id}] {selectedTask.type}
                    </span>
                    <span
                      style={{
                        color: statusColor(selectedTask.status),
                        fontSize: "12px",
                      }}
                    >
                      {selectedTask.status}
                      {selectedTask.exitCode !== undefined &&
                        ` (exit ${selectedTask.exitCode})`}
                    </span>
                  </div>
                  {selectedTask.description && (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--vscode-descriptionForeground)",
                      }}
                    >
                      {selectedTask.description}
                    </div>
                  )}
                  {selectedTask.command && (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--vscode-descriptionForeground)",
                        fontFamily:
                          "var(--vscode-editor-font-family, monospace)",
                        wordBreak: "break-all",
                      }}
                    >
                      $ {selectedTask.command}
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--vscode-descriptionForeground)",
                    }}
                  >
                    Started: {formatTime(selectedTask.startTime)}
                    {selectedTask.runtime !== undefined &&
                      ` · Runtime: ${formatDuration(selectedTask.runtime)}`}
                  </div>
                  {selectedTask.outputPath && (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--vscode-descriptionForeground)",
                        fontFamily:
                          "var(--vscode-editor-font-family, monospace)",
                        wordBreak: "break-all",
                      }}
                    >
                      Log: {selectedTask.outputPath}
                    </div>
                  )}
                </div>
                <div className="mcp-server-actions">
                  {selectedTask.status === "running" && (
                    <button
                      className="mcp-disconnect-btn"
                      onClick={() => handleStop(selectedTask.id)}
                      disabled={stoppingId === selectedTask.id}
                    >
                      {stoppingId === selectedTask.id ? "停止中..." : "停止"}
                    </button>
                  )}
                </div>
              </div>

              <div style={{ marginTop: "12px" }}>
                <div
                  style={{
                    fontSize: "12px",
                    color: "#4ec9b0",
                    marginBottom: "4px",
                  }}
                >
                  OUTPUT (last 20 lines):
                </div>
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
                  {loadingOutput
                    ? "加载中..."
                    : output
                      ? getLastLines(output.stdout, 20) || "(无输出)"
                      : "(无输出)"}
                </pre>
                {output && output.stderr && (
                  <>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#f48771",
                        marginTop: "8px",
                        marginBottom: "4px",
                      }}
                    >
                      ERRORS:
                    </div>
                    <pre
                      style={{
                        background:
                          "var(--vscode-textCodeBlock-background, rgba(0,0,0,0.15))",
                        padding: "8px",
                        borderRadius: "4px",
                        fontSize: "12px",
                        color: "#f48771",
                        fontFamily:
                          "var(--vscode-editor-font-family, monospace)",
                        maxHeight: "150px",
                        overflow: "auto",
                        whiteSpace: "pre-wrap",
                        margin: 0,
                      }}
                    >
                      {getLastLines(output.stderr, 20)}
                    </pre>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="mcp-server-list">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="mcp-server-item"
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelectedTaskId(task.id)}
                >
                  <div className="mcp-server-info">
                    <div className="mcp-server-header">
                      <span style={{ color: statusColor(task.status) }}>●</span>
                      <span className="mcp-server-name">
                        [{task.id}] {task.type}
                      </span>
                      <span
                        style={{
                          color: statusColor(task.status),
                          fontSize: "12px",
                        }}
                      >
                        {task.status}
                      </span>
                    </div>
                    {task.description && (
                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--vscode-descriptionForeground)",
                        }}
                      >
                        {task.description}
                      </div>
                    )}
                    {task.command && (
                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--vscode-descriptionForeground)",
                          fontFamily:
                            "var(--vscode-editor-font-family, monospace)",
                          wordBreak: "break-all",
                        }}
                      >
                        $ {task.command}
                      </div>
                    )}
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--vscode-descriptionForeground)",
                      }}
                    >
                      Started: {formatTime(task.startTime)}
                      {task.runtime !== undefined &&
                        ` · ${formatDuration(task.runtime)}`}
                      {task.exitCode !== undefined &&
                        ` · exit ${task.exitCode}`}
                    </div>
                  </div>
                  <div className="mcp-server-actions">
                    {task.status === "running" && (
                      <button
                        className="mcp-disconnect-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStop(task.id);
                        }}
                        disabled={stoppingId === task.id}
                      >
                        {stoppingId === task.id ? "停止中..." : "停止"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="configuration-actions">
            {selectedTask && (
              <button
                type="button"
                onClick={() => setSelectedTaskId(null)}
                className="configuration-cancel-btn"
              >
                返回列表
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="configuration-cancel-btn"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BackgroundTaskManager;

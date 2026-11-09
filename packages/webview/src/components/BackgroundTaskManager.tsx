/**
 * BackgroundTaskManager - background task management dialog
 *
 * Opened via the /tasks slash command on the hosts without a right-hand panel
 * (VS Code / JetBrains / remote web). Lists background tasks
 * (shell/subagent/workflow) with status, and lets the user view
 * output and stop running tasks. The desktop app shows the same data in a
 * right-panel tab instead (see BackgroundTasksPane); both surfaces share
 * `useBackgroundTaskDetail`, so selection / polling / stop semantics can't
 * drift between them.
 */

import React, { useEffect, useRef } from "react";
import { useClickOutside } from "../utils/useClickOutside";
import {
  BackgroundTaskManagerProps,
  BackgroundTaskSummary,
  SerializableWorkflowRun,
} from "../types";
import WorkflowRunProgress, {
  formatDuration,
  formatTime,
} from "./WorkflowRunProgress";
import { ansiToHtml } from "../utils/ansiText";
import {
  getLastLines,
  useBackgroundTaskDetail,
} from "../utils/useBackgroundTaskDetail";
import "../styles/ConfigurationDialog.css";

const BackgroundTaskManager: React.FC<
  BackgroundTaskManagerProps & {
    tasks: BackgroundTaskSummary[];
    workflowRuns: SerializableWorkflowRun[];
    vscode: { postMessage: (msg: unknown) => void };
  }
> = ({ onClose, tasks, workflowRuns, vscode }) => {
  const {
    selectedTask,
    selectedTaskId,
    selectedWorkflowRun,
    output,
    loadingOutput,
    stoppingId,
    selectTask,
    backToList,
    handleStop,
  } = useBackgroundTaskDetail({ tasks, workflowRuns, vscode });
  const dialogRef = useRef<HTMLDivElement>(null);
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
          backToList();
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleEscapeKey);
    return () => document.removeEventListener("keydown", handleEscapeKey);
  }, [onClose, selectedTaskId, backToList]);

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
                    // 与右侧面板同一个口径：命令行自己也限高 + 内部滚动，
                    // 一行几百字符的命令不把对话框撑长（spec
                    // desktop-right-panel.md「后台任务面板」场景 13）。
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--vscode-descriptionForeground)",
                        fontFamily:
                          "var(--vscode-editor-font-family, monospace)",
                        wordBreak: "break-all",
                        maxHeight: "200px",
                        overflow: "auto",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      $ {selectedTask.command}
                    </div>
                  )}
                  {/* The progress block carries Started / Ended / Duration for
                      a workflow run, so the task's own start-and-runtime line
                      would only repeat it with a coarser value. */}
                  {!selectedWorkflowRun && (
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
                  )}
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
                  {selectedWorkflowRun && (
                    <WorkflowRunProgress run={selectedWorkflowRun} />
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

              {/* The text tail is the fallback: a workflow task has no output
                  file to read, so it is only reachable here when the run itself
                  is no longer listed by the session. */}
              {!selectedWorkflowRun && (
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
                    // 命令输出里的 ANSI 原样保留（specs/core/bash-tools.md
                    // 「ANSI 颜色代码」），这里按可见文本渲染：转义序列变成
                    // 颜色，其余控制序列丢弃，否则屏幕上会是一堆 `ESC[31m`。
                    dangerouslySetInnerHTML={{
                      __html: ansiToHtml(
                        loadingOutput
                          ? "加载中..."
                          : output
                            ? getLastLines(output.stdout, 20) || "(无输出)"
                            : "(无输出)",
                      ),
                    }}
                  />
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
                        // stderr 同样保留命令自己输出的颜色；外层红色是默认色，
                        // 带色片段（`ansi-*`）会覆盖它。
                        dangerouslySetInnerHTML={{
                          __html: ansiToHtml(getLastLines(output.stderr, 20)),
                        }}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="mcp-server-list">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="mcp-server-item"
                  style={{ cursor: "pointer" }}
                  onClick={() => selectTask(task.id)}
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
                onClick={backToList}
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

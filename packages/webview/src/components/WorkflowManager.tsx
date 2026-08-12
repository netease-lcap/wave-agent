import React, { useState, useEffect, useRef } from "react";
import { WorkflowManagerProps, SerializableWorkflowRun } from "../types";
import "../styles/ConfigurationDialog.css";

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

const formatTokens = (tokens: number): string => {
  if (tokens < 1000) return `${tokens}`;
  return `${(tokens / 1000).toFixed(1)}k`;
};

const statusColor = (status: string): string => {
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

const WorkflowManager: React.FC<
  WorkflowManagerProps & {
    runs: SerializableWorkflowRun[];
    vscode: { postMessage: (msg: unknown) => void };
  }
> = ({ onCancel, runs, vscode }) => {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const selectedRun = runs.find((r) => r.runId === selectedRunId) || null;

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === "workflowRunStopped") {
        setStoppingId(null);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleStop = (runId: string) => {
    setStoppingId(runId);
    vscode.postMessage({ command: "stopWorkflowRun", runId });
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dialogRef.current &&
        !dialogRef.current.contains(event.target as Node)
      ) {
        onCancel();
      }
    };
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (selectedRunId) {
          setSelectedRunId(null);
        } else {
          onCancel();
        }
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    document.addEventListener("keydown", handleEscapeKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscapeKey);
    };
  }, [onCancel, selectedRunId]);

  const renderDetail = () => {
    if (!selectedRun) return null;
    const elapsed = selectedRun.endTime
      ? selectedRun.endTime - selectedRun.startTime
      : Date.now() - selectedRun.startTime;

    return (
      <div className="mcp-server-list">
        <div className="mcp-server-item">
          <div className="mcp-server-info">
            <div className="mcp-server-header">
              <span style={{ color: statusColor(selectedRun.status) }}>●</span>
              <span className="mcp-server-name">{selectedRun.meta.name}</span>
              <span
                style={{
                  color: statusColor(selectedRun.status),
                  fontSize: "12px",
                }}
              >
                {selectedRun.status}
              </span>
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "var(--vscode-descriptionForeground)",
              }}
            >
              <span style={{ color: "#569cd6" }}>Run ID:</span>{" "}
              {selectedRun.runId}
            </div>
            {selectedRun.meta.description && (
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--vscode-descriptionForeground)",
                }}
              >
                <span style={{ color: "#569cd6" }}>Description:</span>{" "}
                {selectedRun.meta.description}
              </div>
            )}
            <div
              style={{
                fontSize: "12px",
                color: "var(--vscode-descriptionForeground)",
              }}
            >
              <span style={{ color: "#569cd6" }}>Started:</span>{" "}
              {formatTime(selectedRun.startTime)}
              {selectedRun.endTime && (
                <>
                  {" | "}
                  <span style={{ color: "#569cd6" }}>Ended:</span>{" "}
                  {formatTime(selectedRun.endTime)}
                </>
              )}
              {" | "}
              <span style={{ color: "#569cd6" }}>Duration:</span>{" "}
              {formatDuration(elapsed)}
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "var(--vscode-descriptionForeground)",
              }}
            >
              <span style={{ color: "#569cd6" }}>Agents:</span>{" "}
              {selectedRun.totalAgents}
              {" | "}
              <span style={{ color: "#569cd6" }}>Tokens:</span>{" "}
              {formatTokens(selectedRun.totalTokens)}
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "var(--vscode-descriptionForeground)",
                fontFamily: "var(--vscode-editor-font-family, monospace)",
                wordBreak: "break-all",
              }}
            >
              <span style={{ color: "#569cd6" }}>Script:</span>{" "}
              {selectedRun.scriptPath}
            </div>
            {selectedRun.error && (
              <div
                style={{
                  fontSize: "12px",
                  color: "#f48771",
                  wordBreak: "break-all",
                }}
              >
                <span style={{ color: "#569cd6" }}>Error:</span>{" "}
                {selectedRun.error}
              </div>
            )}
          </div>
          <div className="mcp-server-actions">
            {selectedRun.status === "running" && (
              <button
                className="mcp-disconnect-btn"
                onClick={() => handleStop(selectedRun.runId)}
                disabled={stoppingId === selectedRun.runId}
              >
                {stoppingId === selectedRun.runId ? "停止中..." : "停止"}
              </button>
            )}
          </div>
        </div>

        {selectedRun.phases.length > 0 && (
          <div style={{ marginTop: "12px" }}>
            <div
              style={{
                fontSize: "12px",
                color: "#4ec9b0",
                marginBottom: "4px",
              }}
            >
              Phases:
            </div>
            {selectedRun.phases.map((phase, i) => (
              <div
                key={i}
                style={{
                  fontSize: "12px",
                  color: "var(--vscode-descriptionForeground)",
                  marginLeft: "8px",
                  marginBottom: "2px",
                }}
              >
                <span style={{ color: "#569cd6" }}>{phase.title}</span>
                {" — "}
                {phase.agentCount} agents | {formatTokens(phase.tokens)} tokens
                | {formatDuration(phase.elapsed)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderList = () => (
    <div className="mcp-server-list">
      {runs.map((run) => {
        const elapsed = run.endTime
          ? run.endTime - run.startTime
          : Date.now() - run.startTime;
        const phaseText = run.phases.map((p) => p.title).join(" → ");
        return (
          <div
            key={run.runId}
            className="mcp-server-item"
            style={{ cursor: "pointer" }}
            onClick={() => setSelectedRunId(run.runId)}
          >
            <div className="mcp-server-info">
              <div className="mcp-server-header">
                <span style={{ color: statusColor(run.status) }}>●</span>
                <span className="mcp-server-name">
                  [{run.runId.slice(0, 8)}] {run.meta.name}
                </span>
                <span
                  style={{ color: statusColor(run.status), fontSize: "12px" }}
                >
                  {run.status}
                </span>
              </div>
              {run.meta.description && (
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--vscode-descriptionForeground)",
                  }}
                >
                  {run.meta.description}
                </div>
              )}
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--vscode-descriptionForeground)",
                }}
              >
                {run.totalAgents} agents · {formatTokens(run.totalTokens)}{" "}
                tokens · {formatDuration(elapsed)}
              </div>
              {phaseText && (
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--vscode-descriptionForeground)",
                  }}
                >
                  {run.phases.map((p, pi) => (
                    <React.Fragment key={pi}>
                      {pi > 0 && " → "}
                      {p.title}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
            <div className="mcp-server-actions">
              {run.status === "running" && (
                <button
                  className="mcp-disconnect-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStop(run.runId);
                  }}
                  disabled={stoppingId === run.runId}
                >
                  {stoppingId === run.runId ? "停止中..." : "停止"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="configuration-dialog-overlay">
      <div
        ref={dialogRef}
        className="configuration-dialog"
        data-testid="workflow-manager"
        style={{ maxWidth: "760px" }}
      >
        <div className="configuration-dialog-header">
          <h3>工作流</h3>
        </div>

        <div className="mcp-container">
          {runs.length === 0 ? (
            <div className="empty-state">
              <p>暂无工作流运行</p>
            </div>
          ) : selectedRun ? (
            renderDetail()
          ) : (
            renderList()
          )}

          <div className="configuration-actions">
            {selectedRun && (
              <button
                type="button"
                onClick={() => setSelectedRunId(null)}
                className="configuration-cancel-btn"
              >
                返回列表
              </button>
            )}
            <button
              type="button"
              onClick={onCancel}
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

export default WorkflowManager;

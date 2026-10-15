import React, { useEffect, useState, useRef } from "react";
import { useClickOutside } from "../utils/useClickOutside";
import { useHostMessage } from "../utils/useHostMessage";
import { WorkflowManagerProps, SerializableWorkflowRun } from "../types";
import WorkflowRunProgress, {
  formatDuration,
  formatTokens,
  workflowStatusColor,
} from "./WorkflowRunProgress";
import "../styles/ConfigurationDialog.css";

const WorkflowManager: React.FC<
  WorkflowManagerProps & {
    runs: SerializableWorkflowRun[];
    vscode: { postMessage: (msg: unknown) => void };
  }
> = ({ onCancel, runs, vscode }) => {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Newest first. The host hands the runs over in the order its own map holds
  // them (creation order, plus whatever a session restore appended), which puts
  // the run the user just started at the bottom of the list.
  const orderedRuns = [...runs].sort((a, b) => b.startTime - a.startTime);

  const selectedRun = runs.find((r) => r.runId === selectedRunId) || null;

  // A one-run list is pure friction — one row whose only content is the thing
  // the dialog was opened to look at — so a single run opens straight into its
  // detail. Backing out of that detail then closes the dialog rather than
  // landing on a list of one (Claude Code's Dynamic workflows dialog draws the
  // same line for a one-item list), which is also what keeps "back" from being
  // a no-op: with one run the list is unreachable by design, not by accident.
  const onlyRun = orderedRuns.length === 1 ? orderedRuns[0] : null;
  useEffect(() => {
    if (onlyRun && !selectedRunId) {
      setSelectedRunId(onlyRun.runId);
    }
  }, [onlyRun, selectedRunId]);

  useHostMessage((message) => {
    if (message.command === "workflowRunStopped") {
      setStoppingId(null);
    }
  });

  const handleStop = (runId: string) => {
    setStoppingId(runId);
    vscode.postMessage({ command: "stopWorkflowRun", runId });
  };

  const handleBackFromDetail = () => {
    if (runs.length <= 1) {
      onCancel();
      return;
    }
    setSelectedRunId(null);
  };

  // Click-outside close (listener registered one tick later inside the hook,
  // so the click that opened this dialog doesn't immediately close it).
  useClickOutside({
    refs: [dialogRef],
    onClickOutside: onCancel,
  });

  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape leaves the detail, then the dialog — but there is no list to
      // return to when the detail was opened because it is the only run.
      if (selectedRunId && runs.length > 1) {
        setSelectedRunId(null);
      } else {
        onCancel();
      }
    };
    document.addEventListener("keydown", handleEscapeKey);
    return () => document.removeEventListener("keydown", handleEscapeKey);
  }, [onCancel, selectedRunId, runs.length]);

  const renderDetail = () => {
    if (!selectedRun) return null;

    return (
      <div className="mcp-server-list">
        <div className="mcp-server-item">
          <div className="mcp-server-info">
            <div className="mcp-server-header">
              <span
                role="img"
                aria-label={selectedRun.status}
                title={selectedRun.status}
                style={{ color: workflowStatusColor(selectedRun.status) }}
              >
                ●
              </span>
              <span className="mcp-server-name">{selectedRun.meta.name}</span>
              <span
                style={{
                  color: workflowStatusColor(selectedRun.status),
                  fontSize: "12px",
                }}
              >
                {selectedRun.status}
              </span>
            </div>
            <WorkflowRunProgress run={selectedRun} />
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
      </div>
    );
  };

  const renderList = () => (
    <div className="mcp-server-list">
      {orderedRuns.map((run) => {
        const elapsed = run.endTime
          ? run.endTime - run.startTime
          : Date.now() - run.startTime;
        // Duration always reads; the two counters are dropped at zero so an
        // unstarted run does not claim "0 agents · 0 tokens".
        const meta = [
          formatDuration(elapsed),
          run.totalAgents > 0 ? `${run.totalAgents} agents` : "",
          run.totalTokens > 0 ? `${formatTokens(run.totalTokens)} tokens` : "",
        ].filter(Boolean);
        return (
          <div
            key={run.runId}
            className="mcp-server-item"
            style={{ cursor: "pointer" }}
            onClick={() => setSelectedRunId(run.runId)}
          >
            <div className="mcp-server-info">
              <div className="mcp-server-header">
                {/* Status is the dot: its colour is the whole signal, so the
                    word rides along as the accessible name instead of
                    competing with the workflow name for the row's width. */}
                <span
                  role="img"
                  aria-label={run.status}
                  title={run.status}
                  style={{ color: workflowStatusColor(run.status) }}
                >
                  ●
                </span>
                <span className="mcp-server-name">
                  {run.meta.name || run.meta.description}
                </span>
              </div>
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--vscode-descriptionForeground)",
                }}
              >
                {meta.join(" · ")}
              </div>
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

  const runningCount = runs.filter((r) => r.status === "running").length;
  const completedCount = runs.filter((r) => r.status === "completed").length;
  const subtitle = [
    runningCount > 0 ? `${runningCount} 运行中` : "",
    completedCount > 0 ? `${completedCount} 已完成` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="configuration-dialog-overlay">
      <div
        ref={dialogRef}
        className="configuration-dialog"
        data-testid="workflow-manager"
        style={{ maxWidth: "760px" }}
      >
        <div className="configuration-dialog-header">
          <h3
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "8px",
            }}
          >
            工作流
            {subtitle && (
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 400,
                  color: "var(--vscode-descriptionForeground)",
                }}
              >
                {subtitle}
              </span>
            )}
          </h3>
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
            {selectedRun && runs.length > 1 && (
              <button
                type="button"
                onClick={handleBackFromDetail}
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

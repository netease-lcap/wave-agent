/**
 * BackgroundTasksPane - desktop right-panel view of the session's background
 * tasks (spec `desktop/desktop-right-panel.md`「后台任务面板」).
 *
 * Same data and semantics as the `BackgroundTaskManager` dialog that the
 * panel-less hosts keep using (both run on `useBackgroundTaskDetail`): the
 * list groups running tasks first, a task opens a detail view with its command,
 * status, log tail and — for a workflow — its structured progress.
 *
 * Two things are panel-specific:
 * - the command block and the output block each cap their own height and
 *   scroll internally, so a long command or a chatty task never stretches the
 *   panel (spec 场景 13);
 * - the output only auto-follows while the user is parked at the bottom, so
 *   scrolling up to read earlier lines is never yanked back by the 1.5s
 *   refresh (spec 场景 14, same 16px threshold as CC).
 */

import React, { useEffect, useMemo, useRef } from "react";
import { PanePlaceholder, PaneShell } from "./PaneShell";
import { PanelKindIcon } from "./PanelKindIcon";
import { SettingsBackIcon } from "./HeaderIcons";
import WorkflowRunProgress, {
  formatDuration,
  formatTime,
} from "./WorkflowRunProgress";
import { ansiToHtml } from "../utils/ansiText";
import { TOOL_STATUS_COLORS } from "../utils/statusColors";
import {
  getLastLines,
  useBackgroundTaskDetail,
} from "../utils/useBackgroundTaskDetail";
import type { BackgroundTaskSummary, SerializableWorkflowRun } from "../types";
import "../styles/BackgroundTasksPane.css";

/** Log tail length shown per block — unchanged from the dialog's口径. */
const OUTPUT_TAIL_LINES = 20;

/**
 * Distance from the bottom (px) still counted as "parked at the bottom".
 * Same value CC uses: smaller and a smooth scroll-follow reads as broken,
 * larger and the user's reading position gets stolen while they are reading
 * the last screenful.
 */
const FOLLOW_BOTTOM_THRESHOLD_PX = 16;

export interface BackgroundTasksPaneProps {
  tasks: BackgroundTaskSummary[];
  workflowRuns: SerializableWorkflowRun[];
  vscode: { postMessage: (msg: unknown) => void };
  width: number;
}

/* 1111 评论（点 `.background-task-dot` 与 `.background-task-status`）：「参考活动那里
   的配色，运行中是蓝色，已完成是绿色，失败是报错，停止是灰色，来统一」⇒ 点和状态文案
   走同一套**状态语义层** `--cc-state-*`（`utils/statusColors.ts` 的 TOOL_STATUS_COLORS，
   全站工具块/任务列表/思考块同源，桌面端由 host-desktop.css 给浅/深两档，切主题自动
   换档）。
   改前三档是坏的：`--cc-status-running` / `--cc-status-danger` 这两个 token **全仓库
   从没定义过**（只剩 fallback 生效）⇒ 运行中是 VS Code 图表的青绿 #4EC9B0、失败是粉红
   #F48771，与产品语义色不是一家；而 completed / killed 干脆返回 undefined，让点和文案
   各自回落（浅色实测点继承正文近黑 #202020、文案走描述灰 #606060 —— 点和字不同色）。
   现在四档一一对应：running 蓝 / completed 绿 / failed 红 / killed 灰，四个状态都
   显式给色，不再有「继承正文色」的半成品。 */
const statusColor = (status: string): string => {
  switch (status) {
    case "running":
      return TOOL_STATUS_COLORS.running;
    case "completed":
      return TOOL_STATUS_COLORS.success;
    case "failed":
      return TOOL_STATUS_COLORS.error;
    default:
      // killed / 未知状态：中性灰，与「无状态历史记录」同一档。
      return TOOL_STATUS_COLORS.idle;
  }
};

export const BackgroundTasksPane: React.FC<BackgroundTasksPaneProps> = ({
  tasks,
  workflowRuns,
  vscode,
  width,
}) => {
  const {
    selectedTask,
    selectedWorkflowRun,
    output,
    loadingOutput,
    stoppingId,
    selectTask,
    backToList,
    handleStop,
  } = useBackgroundTaskDetail({ tasks, workflowRuns, vscode });

  const outputRef = useRef<HTMLPreElement>(null);
  // Whether the user is parked at the bottom of the output block. Starts true
  // (a freshly opened detail should show the newest lines) and is re-evaluated
  // on every scroll (spec 场景 14).
  const followBottomRef = useRef(true);

  const runningTasks = tasks.filter((t) => t.status === "running");
  const finishedTasks = tasks.filter((t) => t.status !== "running");

  const outputHtml = useMemo(
    () =>
      ansiToHtml(
        loadingOutput
          ? "加载中..."
          : output
            ? getLastLines(output.stdout, OUTPUT_TAIL_LINES) || "(无输出)"
            : "(无输出)",
      ),
    [loadingOutput, output],
  );

  // Follow new output only while parked at the bottom: scrolling up to read
  // earlier lines must not be interrupted by the running-task refresh.
  useEffect(() => {
    const el = outputRef.current;
    if (!el || !followBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [outputHtml]);

  const handleOutputScroll = () => {
    const el = outputRef.current;
    if (!el) return;
    followBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <
      FOLLOW_BOTTOM_THRESHOLD_PX;
  };

  /** One task row (list). `status` badge + type + description/command tail. */
  const renderRow = (task: BackgroundTaskSummary) => (
    <div
      key={task.id}
      className="background-task-row"
      data-testid={`tasks-pane-row-${task.id}`}
      role="button"
      tabIndex={0}
      onClick={() => selectTask(task.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectTask(task.id);
        }
      }}
      aria-label={`后台任务 ${task.id}：${task.description || task.command || task.type}`}
    >
      <div className="background-task-row-main">
        <span className="background-task-row-head">
          <span
            className="background-task-dot"
            style={{ color: statusColor(task.status) }}
            aria-hidden="true"
          >
            ●
          </span>
          <span className="background-task-type">{task.type}</span>
          <span
            className="background-task-status"
            style={{ color: statusColor(task.status) }}
          >
            {task.status}
            {task.exitCode !== undefined && ` (exit ${task.exitCode})`}
          </span>
        </span>
        {task.description && (
          <span className="background-task-row-desc">{task.description}</span>
        )}
        {task.command && (
          // Two lines max in the list: the full command lives in the detail
          // view's command block, which scrolls (spec 场景 13).
          <span
            className="background-task-row-command"
            title={task.command}
            data-testid={`tasks-pane-row-command-${task.id}`}
          >
            $ {task.command}
          </span>
        )}
        <span className="background-task-row-meta">
          启动 {formatTime(task.startTime)}
          {task.runtime !== undefined && ` · ${formatDuration(task.runtime)}`}
        </span>
      </div>
      {task.status === "running" && (
        <button
          type="button"
          className="background-task-stop"
          onClick={(e) => {
            // 停止不是「打开详情」：别让点击冒泡到行上。
            e.stopPropagation();
            handleStop(task.id);
          }}
          disabled={stoppingId === task.id}
          data-testid={`tasks-pane-stop-${task.id}`}
        >
          {stoppingId === task.id ? "停止中..." : "停止"}
        </button>
      )}
    </div>
  );

  const detail = selectedTask && (
    <div className="background-task-detail" data-testid="tasks-pane-detail">
      <div className="background-task-detail-head">
        <span
          className="background-task-dot"
          style={{ color: statusColor(selectedTask.status) }}
          aria-hidden="true"
        >
          ●
        </span>
        <span className="background-task-type">
          [{selectedTask.id}] {selectedTask.type}
        </span>
        <span
          className="background-task-status"
          style={{ color: statusColor(selectedTask.status) }}
        >
          {selectedTask.status}
          {selectedTask.exitCode !== undefined &&
            ` (exit ${selectedTask.exitCode})`}
        </span>
        {selectedTask.status === "running" && (
          <button
            type="button"
            className="background-task-stop"
            onClick={() => handleStop(selectedTask.id)}
            disabled={stoppingId === selectedTask.id}
            data-testid="tasks-pane-detail-stop"
          >
            {stoppingId === selectedTask.id ? "停止中..." : "停止"}
          </button>
        )}
      </div>

      {selectedTask.description && (
        <div className="background-task-detail-desc">
          {selectedTask.description}
        </div>
      )}

      {selectedTask.command && (
        <>
          <div className="background-task-block-title">命令:</div>
          {/* Capped and internally scrolling: a long one-liner must not stretch
              the panel nor push the head out of view (spec 场景 13). */}
          <pre
            className="background-task-command"
            data-testid="tasks-pane-command"
          >
            $ {selectedTask.command}
          </pre>
        </>
      )}

      {/* The progress block carries Started / Ended / Duration for a workflow
          run, so the task's own start-and-runtime line would only repeat it
          with a coarser value. */}
      {!selectedWorkflowRun && (
        <div className="background-task-detail-meta">
          启动 {formatTime(selectedTask.startTime)}
          {selectedTask.runtime !== undefined &&
            ` · 运行 ${formatDuration(selectedTask.runtime)}`}
        </div>
      )}
      {selectedTask.outputPath && (
        <div
          className="background-task-detail-path"
          title={selectedTask.outputPath}
        >
          日志 {selectedTask.outputPath}
        </div>
      )}

      {selectedWorkflowRun ? (
        <WorkflowRunProgress run={selectedWorkflowRun} />
      ) : (
        <>
          <div className="background-task-block-title">输出（最近 20 行）:</div>
          <pre
            ref={outputRef}
            onScroll={handleOutputScroll}
            tabIndex={0}
            role="region"
            aria-label="任务输出"
            className="background-task-output"
            data-testid="tasks-pane-output"
            // 命令输出里的 ANSI 原样保留（specs/core/bash-tools.md
            // 「ANSI 颜色代码」），这里按可见文本渲染：转义序列变成颜色，
            // 其余控制序列丢弃，否则屏幕上会是一堆 `ESC[31m`。
            dangerouslySetInnerHTML={{ __html: outputHtml }}
          />
          {output && output.stderr && (
            <>
              <div className="background-task-block-title background-task-block-title--error">
                错误输出:
              </div>
              <pre
                className="background-task-output background-task-output--error"
                data-testid="tasks-pane-stderr"
                dangerouslySetInnerHTML={{
                  __html: ansiToHtml(
                    getLastLines(output.stderr, OUTPUT_TAIL_LINES),
                  ),
                }}
              />
            </>
          )}
        </>
      )}
    </div>
  );

  return (
    <PaneShell
      kind="background-tasks-pane"
      dataTestId="tasks-pane"
      width={width}
      toolbar={
        <>
          {selectedTask && (
            <button
              type="button"
              className="preview-pane-button background-tasks-back"
              aria-label="返回任务列表"
              data-testid="tasks-pane-back"
              onClick={backToList}
            >
              {/* 与文件面板「返回文件列表」同一枚官方矢量，两处手感一致。 */}
              <SettingsBackIcon className="preview-pane-icon" />
            </button>
          )}
          <span className="desktop-panel-toolbar-title">后台任务</span>
          {!selectedTask && tasks.length > 0 && (
            <span className="background-tasks-count">
              {runningTasks.length > 0
                ? `${runningTasks.length} 个运行中`
                : `${tasks.length} 个`}
            </span>
          )}
        </>
      }
      bodyClassName="background-tasks-pane-body"
      bodyTestId="tasks-pane-body"
    >
      {tasks.length === 0 ? (
        <PanePlaceholder className="background-tasks-placeholder-empty">
          <PanelKindIcon
            kind="tasks"
            size={24}
            className="background-tasks-placeholder-icon"
          />
          <span>暂无后台任务</span>
        </PanePlaceholder>
      ) : selectedTask ? (
        detail
      ) : (
        <div className="background-tasks-list">
          {runningTasks.length > 0 && (
            <>
              <div className="background-tasks-group">运行中</div>
              {runningTasks.map(renderRow)}
            </>
          )}
          {finishedTasks.length > 0 && (
            <>
              <div className="background-tasks-group">已结束</div>
              {finishedTasks.map(renderRow)}
            </>
          )}
        </div>
      )}
    </PaneShell>
  );
};

export default BackgroundTasksPane;

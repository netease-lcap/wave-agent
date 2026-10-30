import React, { useCallback, useEffect, useRef, useState } from "react";
import type { SessionMetadata } from "wave-agent-sdk/types";
import type {
  RenameSessionHandler,
  SessionListStatus,
  VsCodeApi,
} from "../types";
import { useHostMessage } from "../utils/useHostMessage";
import { formatSessionLabel } from "../utils/session";
import {
  WORKTREE_DELETE_CHECKING,
  worktreeDeleteWarning,
} from "../utils/worktreeDeleteWarning";
import { ConfirmDialog } from "./ConfirmDialog";
import { LoadingRingIcon, StatusDotIcon } from "./HeaderIcons";
import { WORKTREE_CHANGES_TIMEOUT_MS } from "./DesktopSidebar";
import "../styles/RemoteSessionListPage.css";

/** 「最近活跃时间」的第二行用相对时间：手机上一行的宽度要留给标题和「⋯」，
 *  绝对时间（`toLocaleString`）在那里既长又读不出「刚才还是昨天」。 */
const formatLastActive = (at?: string | Date): string => {
  if (!at) return "";
  const ms = at instanceof Date ? at.getTime() : new Date(at).getTime();
  if (Number.isNaN(ms)) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(ms).toLocaleDateString();
};

/** 项目目录名（不是完整路径）：手机上那一行要和「最近活跃时间」挤在同一行。 */
const projectName = (workdir?: string): string => {
  if (!workdir) return "";
  const parts = workdir.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
};

/**
 * 一条只出一个点，优先级 **待确认 > 运行中 > 有后台任务在跑**（spec
 * remote/remote-web.md「手机端的会话列表与删除」场景 2）：被审批卡住的对话不算
 * 「在跑」，而前台回合结束、后台任务还在转的对话必须标出来——那是「它还在动」的
 * 唯一信号。当前那条只标「运行中」（它自己的审批卡就弹在眼前，重复提醒没有意义）。
 */
const statusMarker = (
  status: SessionListStatus | undefined,
  sessionId: string,
  isCurrent: boolean,
): React.ReactNode => {
  if (!status) return null;
  if (!isCurrent && status.waiting.includes(sessionId))
    return <StatusDotIcon color="#E6A23C" label="等待确认" size={16} />;
  if (status.running.includes(sessionId)) return <LoadingRingIcon size={16} />;
  if (status.background?.includes(sessionId))
    return <StatusDotIcon color="#409EFF" label="有后台任务在跑" size={16} />;
  return null;
};

/** The delete confirmation's three facts (spec 场景 6/7/8). */
interface PendingDelete {
  sessionId: string;
  label: string;
  /** 这条会话的工作目录是 linked worktree（由宿主在列表读里给出）。 */
  isWorktree: boolean;
  /** worktree 计数还在路上：确认键禁用，卡片说「正在检查…」。 */
  checking: boolean;
  /** worktree 警告文案；`undefined` = 干净工作树或不是 worktree，不显示。 */
  warning?: string;
  /** 会话正在回答（`isLoading` 或还有后台任务在跑）：要勾选才能删。 */
  needsAck: boolean;
  ack: boolean;
  /** 请求已发出、回复未到：确认键禁用，避免点两下发出两次删除。 */
  submitting: boolean;
  error?: string;
}

interface RemoteSessionListPageProps {
  sessions: SessionMetadata[];
  currentSession?: SessionMetadata;
  sessionStatus?: SessionListStatus;
  loading: boolean;
  vscode: VsCodeApi;
  /** 切到这条会话。父组件负责「切 + 关掉本页」两件事。 */
  onSelect: (sessionId: string) => void;
  onBack: () => void;
  /** 重命名（乐观更新 → requestId 关联回复 → 失败回滚，`useSessionRename`）。 */
  onRename: RenameSessionHandler;
}

/**
 * 远控 Web 页的**整页**会话列表（spec remote/remote-web.md「手机端的会话列表与
 * 删除」）。只由 `ChatApp` 在 `isRemotePage` 分支挂载——IDE 端的「历史对话」与
 * 桌面端的会话入口仍是 `SessionListPopup`，那份下拉一个字都没改。
 *
 * 为什么是整页而不是下拉：下拉是给指针设备的形态（贴着顶栏、宽度窄、没有行级
 * 动作的位置）。手机上它同时不够宽（标题 + 项目 + 时间 + 状态点挤不下）、不够高
 * （会话一多就得在弹窗里滚）、也没有地方放「⋯」——行级动作正是这一篇要补的东西。
 * 页面因此自己拥有搜索框、行布局、动作面板与删除确认，不借用共享列表的 DOM：
 * 那条共享路径服务四端，改它等于把手机的形状塞给别人。
 *
 * 删除走**两条**请求：`destroy`（信封 `sessionId` 指向被删的那条，页面不是它也能
 * 删）与删除前的 `getSessionWorktreeChanges`（按需读改动计数）。**没有**放行裸
 * `removeWorktree` / `getWorktreeChanges`：手机不该能指名这台机器上的任意目录。
 */
export const RemoteSessionListPage: React.FC<RemoteSessionListPageProps> = ({
  sessions,
  currentSession,
  sessionStatus,
  loading,
  vscode,
  onSelect,
  onBack,
  onRename,
}) => {
  const [query, setQuery] = useState("");
  /** 打开动作面板的那一行（点「⋯」只开面板，不切会话——spec 场景 3）。 */
  const [actionsFor, setActionsFor] = useState<SessionMetadata | null>(null);
  const [renaming, setRenaming] = useState<{
    sessionId: string;
    draft: string;
  } | null>(null);
  const [renameError, setRenameError] = useState<{
    sessionId: string;
    message: string;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  /** 删完列表顶部那条「已删除」（spec 场景 11）。 */
  const [deletedNotice, setDeletedNotice] = useState<string | null>(null);

  // 删除两笔请求的关联：只有匹配的回复被消费（同一行可以反复开关卡片、换一行
  // 再点，晚到的旧回复必须丢弃——与桌面侧栏同一套 requestId 守卫）。
  const deleteRequestRef = useRef<{
    requestId: string;
    sessionId: string;
    isWorktree: boolean;
  } | null>(null);
  const worktreeRequestRef = useRef<{
    requestId: string;
    sessionId: string;
  } | null>(null);
  const worktreeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearWorktreeTimeout = useCallback(() => {
    if (worktreeTimeoutRef.current) {
      clearTimeout(worktreeTimeoutRef.current);
      worktreeTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => clearWorktreeTimeout, [clearWorktreeTimeout]);

  useHostMessage((message) => {
    if (message.command === "sessionWorktreeChanges") {
      const request = worktreeRequestRef.current;
      if (
        !request ||
        String(message.requestId) !== request.requestId ||
        message.sessionId !== request.sessionId
      )
        return;
      clearWorktreeTimeout();
      worktreeRequestRef.current = null;
      setPendingDelete((prev) =>
        prev && prev.sessionId === message.sessionId
          ? {
              ...prev,
              checking: false,
              // `null` = 读不到（超时/宿主失败/工作树已不在），按「降级泛警告」
              // 处理：未知不等于干净，绝不静默删（spec 场景 7）。
              warning: worktreeDeleteWarning(message.changes),
            }
          : prev,
      );
      return;
    }
    if (message.command === "sessionDeleted") {
      const request = deleteRequestRef.current;
      if (!request || String(message.requestId) !== request.requestId) return;
      deleteRequestRef.current = null;
      if (!message.ok) {
        setPendingDelete((prev) =>
          prev && prev.sessionId === message.sessionId
            ? {
                ...prev,
                submitting: false,
                error: message.error || "删除失败",
              }
            : prev,
        );
        return;
      }
      setPendingDelete(null);
      setDeletedNotice(
        // 工作树没跟着删掉不是失败（会话确实删了），但也不是全做完了——说清楚，
        // 而不是把「删了一半」报成彻底成功或彻底失败（spec 场景 8）。
        request.isWorktree && message.worktreeRemoved === false
          ? "已删除（工作树没跟着删掉，可在电脑上手动清理）"
          : "已删除",
      );
    }
  });

  // Esc 先收最上面那一层，最后才退页面：卡片 → 面板 → 页面。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pendingDelete) return; // ConfirmDialog 自己处理 Esc
      if (actionsFor) {
        setActionsFor(null);
        return;
      }
      if (renaming) return; // 行内编辑框自己处理 Esc（回滚）
      onBack();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [actionsFor, pendingDelete, renaming, onBack]);

  const filtered = (() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return sessions;
    return sessions.filter((session) =>
      formatSessionLabel(session).toLowerCase().includes(trimmed),
    );
  })();

  const startRename = (session: SessionMetadata) => {
    setActionsFor(null);
    setRenameError(null);
    setRenaming({ sessionId: session.id, draft: formatSessionLabel(session) });
  };

  const commitRename = async (session: SessionMetadata) => {
    if (!renaming || renaming.sessionId !== session.id) return;
    const next = renaming.draft.trim();
    setRenaming(null);
    // trim 后为空什么都不做（不请求、标题不变、退出编辑 —— spec 场景 5）。
    if (!next || next === formatSessionLabel(session)) return;
    const result = await onRename(
      session.id,
      next,
      formatSessionLabel(session),
    );
    setRenameError(
      result.ok
        ? null
        : { sessionId: session.id, message: result.error ?? "重命名失败" },
    );
  };

  const requestDelete = (session: SessionMetadata) => {
    setActionsFor(null);
    setDeletedNotice(null);
    setRenameError(null);
    const isWorktree = sessionStatus?.worktrees?.includes(session.id) === true;
    // 「正在回答」比「运行中」的点更宽：前台回合结束、后台任务还在跑也会被打断
    // （spec 场景 6）。两个集合都来自同一次注册表读，不另开场查询。
    const needsAck =
      sessionStatus?.running?.includes(session.id) === true ||
      sessionStatus?.background?.includes(session.id) === true;

    clearWorktreeTimeout();
    worktreeRequestRef.current = null;
    setPendingDelete({
      sessionId: session.id,
      label: formatSessionLabel(session),
      isWorktree,
      checking: isWorktree,
      warning: undefined,
      needsAck,
      ack: false,
      submitting: false,
    });
    if (!isWorktree) return;

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    worktreeRequestRef.current = { requestId, sessionId: session.id };
    vscode.postMessage({
      command: "getSessionWorktreeChanges",
      sessionId: session.id,
      requestId,
    });
    // 没有回执（宿主卡住、或将来某条早退路径忘了答）也必须收场：降级成泛警告
    // 让用户自己决定，而不是把确认键永久禁用。
    worktreeTimeoutRef.current = setTimeout(() => {
      worktreeTimeoutRef.current = null;
      // 作废在途请求，晚到的回执照样丢弃——否则会把卡片翻回「正在检查」并把
      // 用户可能已经按下的确认键重新禁用。
      worktreeRequestRef.current = null;
      setPendingDelete((prev) =>
        prev && prev.sessionId === session.id
          ? { ...prev, checking: false, warning: worktreeDeleteWarning(null) }
          : prev,
      );
    }, WORKTREE_CHANGES_TIMEOUT_MS);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    if (pendingDelete.checking) return;
    if (pendingDelete.needsAck && !pendingDelete.ack) return;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    deleteRequestRef.current = {
      requestId,
      sessionId: pendingDelete.sessionId,
      isWorktree: pendingDelete.isWorktree,
    };
    setPendingDelete((prev) => (prev ? { ...prev, submitting: true } : prev));
    vscode.postMessage({
      command: "deleteSession",
      sessionId: pendingDelete.sessionId,
      // 工作树跟着会话走：有工作树时让 daemon 自己从 `createdWorkdir` 定位并删除，
      // 定位不到它会话照删 + `worktreeRemoved: false`。
      removeWorktree: pendingDelete.isWorktree,
      requestId,
    });
  };

  const cancelDelete = () => {
    clearWorktreeTimeout();
    worktreeRequestRef.current = null;
    deleteRequestRef.current = null;
    setPendingDelete(null);
  };

  const confirmDisabled =
    !pendingDelete ||
    pendingDelete.checking ||
    pendingDelete.submitting ||
    (pendingDelete.needsAck && !pendingDelete.ack);

  return (
    <div
      className="remote-session-page"
      data-testid="remote-session-page"
      role="dialog"
      aria-modal="true"
      aria-label="会话"
    >
      <div className="remote-session-page-header">
        <button
          type="button"
          className="remote-session-page-back"
          data-testid="remote-session-page-back"
          aria-label="返回"
          onClick={onBack}
        >
          <span className="codicon codicon-chevron-left" aria-hidden="true" />
          <span>返回</span>
        </button>
        <div className="remote-session-page-title">会话</div>
      </div>

      <input
        type="text"
        className="remote-session-page-search"
        data-testid="remote-session-page-search"
        placeholder="搜索关键词"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {deletedNotice && (
        <div
          className="remote-session-page-notice"
          data-testid="remote-session-deleted-banner"
          role="status"
        >
          {deletedNotice}
        </div>
      )}

      {loading ? (
        <div className="remote-session-page-empty">正在加载...</div>
      ) : filtered.length === 0 ? (
        <div className="remote-session-page-empty">
          {sessions.length === 0
            ? "电脑侧还没有正在跑的会话。"
            : "未找到匹配的会话"}
        </div>
      ) : (
        <ul
          className="remote-session-page-list"
          data-testid="remote-session-page-list"
        >
          {filtered.map((session) => {
            const isCurrent = session.id === currentSession?.id;
            const marker = statusMarker(sessionStatus, session.id, isCurrent);
            const meta = [
              projectName(session.workdir),
              formatLastActive(session.lastActiveAt),
            ]
              .filter(Boolean)
              .join(" · ");
            const isRenaming = renaming?.sessionId === session.id;
            return (
              <li
                key={session.id}
                className={`remote-session-row${isCurrent ? " remote-session-row--current" : ""}`}
                data-testid={`remote-session-row-${session.id}`}
              >
                {isRenaming ? (
                  <input
                    type="text"
                    className="remote-session-row-rename"
                    data-testid={`remote-session-rename-input-${session.id}`}
                    autoFocus
                    value={renaming.draft}
                    onChange={(e) =>
                      setRenaming({
                        sessionId: session.id,
                        draft: e.target.value,
                      })
                    }
                    onBlur={() => void commitRename(session)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void commitRename(session);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        // 回滚：只退出编辑，不发请求（乐观更新从没发生过）。
                        setRenaming(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="remote-session-row-main"
                    data-testid={`remote-session-row-select-${session.id}`}
                    onClick={() => onSelect(session.id)}
                  >
                    <span className="remote-session-row-title">
                      {marker && (
                        <span
                          className="remote-session-row-marker"
                          data-testid={`remote-session-marker-${session.id}`}
                        >
                          {marker}
                        </span>
                      )}
                      <span className="remote-session-row-title-text">
                        {formatSessionLabel(session)}
                      </span>
                    </span>
                    {meta && (
                      <span
                        className="remote-session-row-meta"
                        title={session.workdir}
                      >
                        {meta}
                      </span>
                    )}
                    {renameError?.sessionId === session.id && (
                      <span
                        className="remote-session-row-rename-error"
                        role="alert"
                      >
                        {renameError.message}
                      </span>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  className="remote-session-row-more"
                  data-testid={`remote-session-more-${session.id}`}
                  aria-label="更多操作"
                  aria-haspopup="menu"
                  aria-expanded={actionsFor?.id === session.id || undefined}
                  onClick={(e) => {
                    // 行内「⋯」有自己的可点区：只开面板，不切会话（spec 场景 3）。
                    e.stopPropagation();
                    setRenaming(null);
                    setDeletedNotice(null);
                    setActionsFor((prev) =>
                      prev?.id === session.id ? null : session,
                    );
                  }}
                >
                  <span
                    className="codicon codicon-kebab-horizontal"
                    aria-hidden="true"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {actionsFor && (
        <>
          <div
            className="remote-session-sheet-scrim"
            data-testid="remote-session-actions-scrim"
            onClick={() => setActionsFor(null)}
          />
          <div
            className="remote-session-sheet"
            data-testid="remote-session-actions"
            role="menu"
            aria-label="会话操作"
          >
            <button
              type="button"
              className="remote-session-sheet-item"
              data-testid="remote-session-action-rename"
              role="menuitem"
              onClick={() => startRename(actionsFor)}
            >
              重命名
            </button>
            <button
              type="button"
              className="remote-session-sheet-item remote-session-sheet-item--danger"
              data-testid="remote-session-action-delete"
              role="menuitem"
              onClick={() => requestDelete(actionsFor)}
            >
              删除会话
            </button>
            <button
              type="button"
              className="remote-session-sheet-item remote-session-sheet-item--cancel"
              data-testid="remote-session-action-cancel"
              onClick={() => setActionsFor(null)}
            >
              取消
            </button>
          </div>
        </>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`确定删除会话「${pendingDelete.label}」？`}
          // ① 固定一句：删的是**这台机器上正在跑的这条会话**，不是磁盘上的对话
          // 记录（spec 场景 6/12 的语义核心）。
          description="对话记录仍保留在这台电脑上，可以从桌面端恢复。"
          confirmText={
            pendingDelete.isWorktree ? "删除会话与工作树" : "删除会话"
          }
          cancelText="取消"
          confirmDisabled={confirmDisabled}
          destructive
          onConfirm={confirmDelete}
          onCancel={cancelDelete}
        >
          {pendingDelete.isWorktree && (
            <div
              className="remote-session-delete-warning"
              data-testid="remote-session-delete-worktree-warning"
            >
              {pendingDelete.checking
                ? WORKTREE_DELETE_CHECKING
                : pendingDelete.warning}
            </div>
          )}
          {pendingDelete.needsAck && (
            <div className="remote-session-delete-ack">
              <div
                className="remote-session-delete-ack-text"
                data-testid="remote-session-delete-running-warning"
              >
                会终止这条会话正在进行的回答
              </div>
              <label className="remote-session-delete-ack-label">
                <input
                  type="checkbox"
                  data-testid="remote-session-delete-ack"
                  checked={pendingDelete.ack}
                  onChange={(e) =>
                    setPendingDelete((prev) =>
                      prev ? { ...prev, ack: e.target.checked } : prev,
                    )
                  }
                />
                <span>我知道了</span>
              </label>
            </div>
          )}
          {pendingDelete.error && (
            <div
              className="remote-session-delete-error"
              data-testid="remote-session-delete-error"
              role="alert"
            >
              {pendingDelete.error}
            </div>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
};

export default RemoteSessionListPage;

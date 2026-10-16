import React, { useEffect, useRef, useState } from "react";
import { Tooltip } from "./Tooltip";
import {
  NewSessionIcon,
  HistoryIcon,
  MachineIcon,
  MoreIcon,
  PanelCollapseIcon,
  PanelExpandIcon,
} from "./HeaderIcons";
import { SessionListPopup } from "./SessionListPopup";
import { MoreMenu } from "./MoreMenu";
import { getSessionTitle } from "../utils/session";
import type { ChatHeaderProps } from "../types";
import "../styles/ChatHeader.css";

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  onNewSession,
  newSessionDisabled = false,
  messages,
  sessions,
  currentSession,
  onSessionSelect,
  sessionsLoading,
  sessionStatus,
  onOpenSettings,
  onOpenEnterpriseConsole,
  onOpenHelpDocs,
  onLogin,
  onLogout,
  isAuthenticated,
  hideSessionButtons = false,
  sessionSwitchButton = false,
  onSwitchMachine,
  pushNotifications,
  hideMoreButton = false,
  sessionListOpen = false,
  onSessionListClose,
  panelToggle,
  leading,
  macTrafficSpacer = false,
  headerActions,
  onRenameSession,
}) => {
  const [showSessionList, setShowSessionList] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  // Menu triggers; the popups return focus here on Escape / item activation.
  const moreBtnRef = useRef<HTMLButtonElement>(null);

  // The header button owns this state for its own toggling, but `/resume`
  // (intercepted in ChatApp) opens the very same popup — one list, one scope,
  // no second implementation to drift (spec session-management.md「IDE 插件聊
  // 天头部」场景 8/10).
  const sessionListVisible = showSessionList || sessionListOpen;
  const closeSessionList = () => {
    setShowSessionList(false);
    onSessionListClose?.();
  };

  const title = getSessionTitle(currentSession, messages);

  // 就地编辑会话标题（spec session-management.md「会话重命名入口：CLI 与 IDE
  // 插件」场景 8/9/10）：点击标题即变成输入框，不弹模态、不改变面板布局、不清空
  // 对话；Enter/blur 保存、Esc 回滚、trim 后为空则什么都不做。
  const [draft, setDraft] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | undefined>(undefined);
  const titleInputRef = useRef<HTMLInputElement>(null);
  // 一次性闩锁：Enter/Esc 已经结束编辑后紧跟的 blur 不得再提交一次（场景 9）。
  const editSettledRef = useRef(false);
  const canRename = !!onRenameSession && !!currentSession?.id;
  const editing = draft !== null;

  useEffect(() => {
    if (!editing) return;
    // 自动聚焦 + 内容全选（场景 8）。
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [editing]);

  const beginRename = () => {
    if (!canRename) return;
    editSettledRef.current = false;
    setRenameError(undefined);
    setDraft(title);
  };

  // 结束编辑（保存与回滚共用）：闩锁置位，挡住结束动作自身带来的那次 blur。
  const endRename = () => {
    editSettledRef.current = true;
    setDraft(null);
  };

  const commitRename = async () => {
    if (draft === null) return;
    const next = draft.trim();
    const previous = title;
    endRename();
    // 空标题什么都不做（场景 9）。
    if (!next || !currentSession?.id || !onRenameSession) return;
    // 乐观更新由 onRenameSession 落进状态；失败时它已回滚，这里只负责可见提示
    //（场景 9：不得静默失败）。
    const result = await onRenameSession(currentSession.id, next, previous);
    setRenameError(result.ok ? undefined : (result.error ?? "重命名失败"));
  };

  return (
    <div className="chat-header" data-testid="chat-header">
      {/* macOS 隐藏标题栏 + 侧边栏收起：最左端让给系统红绿灯，该段为窗口
          拖拽区（spec「macOS 隐藏标题栏」场景 3）。 */}
      {macTrafficSpacer && (
        <div
          className="chat-header-mac-traffic"
          aria-hidden="true"
          data-testid="chat-header-mac-traffic"
        />
      )}
      {leading}
      {editing ? (
        <input
          ref={titleInputRef}
          className="header-title header-title-input"
          data-testid="header-title-input"
          value={draft}
          aria-label="会话标题"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            // 场景 9：点击输入框之外保存；Enter/Esc 之后的那次 blur 由闩锁挡掉。
            if (editSettledRef.current) return;
            void commitRename();
          }}
          onKeyDown={(e) => {
            // 场景 10：按键不得冒泡触发宿主快捷键；组合输入中的 Enter/Esc 不算
            // 提交（keyCode 229 是部分 IME 的等价信号）。
            e.stopPropagation();
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") {
              e.preventDefault();
              void commitRename();
            } else if (e.key === "Escape") {
              e.preventDefault();
              // 场景 9：回滚为原标题 —— 取消发生在提交之前，直接退出即可。
              endRename();
            }
          }}
        />
      ) : (
        <div
          className={`header-title${canRename ? " header-title-editable" : ""}`}
          data-testid="header-title"
          {...(canRename
            ? {
                role: "button",
                tabIndex: 0,
                title: "点击修改标题",
                onClick: beginRename,
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    beginRename();
                  }
                },
              }
            : {})}
        >
          {title}
        </div>
      )}
      {renameError && (
        <div className="header-title-error" role="alert">
          {renameError}
        </div>
      )}
      <div className="header-buttons">
        {/* 新建对话：IDE 一对齐全出；远控页与「会话」入口成对出现（图标重绑
            到 RemoteNewSessionDialog，底层是 initialize 而非 clearChat —— spec
            remote-control.md「Web 端也能发起新会话」故事）；桌面端仍由
            DesktopSidebar 拥有，不在此渲染。 */}
        {(!hideSessionButtons || sessionSwitchButton) && (
          <Tooltip text="新建对话" position="bottom">
            <button
              className="header-button"
              onClick={onNewSession}
              disabled={newSessionDisabled}
              data-testid="new-session-btn"
              aria-label="新建对话"
            >
              <NewSessionIcon />
            </button>
          </Tooltip>
        )}
        {/* 历史对话：仅 IDE。远控页的列表入口是右侧的「会话」按钮。 */}
        {!hideSessionButtons && (
          <Tooltip text="历史对话" position="bottom">
            <button
              className="header-button"
              onClick={() => setShowSessionList((prev) => !prev)}
              data-testid="history-btn"
              aria-label="历史对话"
            >
              <HistoryIcon />
            </button>
          </Tooltip>
        )}
        {sessionSwitchButton && (
          <Tooltip text="会话" position="bottom">
            <button
              className="header-button"
              onClick={() => setShowSessionList((prev) => !prev)}
              data-testid="session-switch-btn"
              aria-label="会话"
              aria-expanded={sessionListVisible}
            >
              {/* 这一端列的是**会话**（进程内活会话，可切可标记），不是「历史」——
                  复用 IDE 那个 HistoryIcon（时钟 + 回溯箭头）会让图标说一件页面上
                  不存在的事（页面不提供历史入口，见 spec remote-control.md「Web 页
                  作为第五种宿主」场景 5 / 24）。codicon 双气泡读作「多条对话」，与
                  旁边「新建对话」同一族；字号在手机档随其余图标一起抬（40×40 / 20px，
                  见 remote-page.css 与场景 27）。 */}
              <span
                className="codicon codicon-comment-discussion"
                aria-hidden="true"
              />
            </button>
          </Tooltip>
        )}
        {/* 远控页专属：「换机器」的常驻入口——一个主屏图标管所有机器，入口
            收在页面侧的 shim（REMOTE_PAGE_GATED，audit:commands 把关），不改
            其余四端的顶栏（spec remote-control.md「机器列表与切换」场景 5）。 */}
        {onSwitchMachine && (
          <Tooltip text="切换电脑" position="bottom">
            <button
              className="header-button"
              onClick={onSwitchMachine}
              data-testid="switch-machine-btn"
              aria-label="切换电脑"
            >
              <MachineIcon />
            </button>
          </Tooltip>
        )}
        {!hideMoreButton && (
          <Tooltip text="更多" position="bottom">
            <button
              ref={moreBtnRef}
              className="header-button"
              onClick={() => setShowMoreMenu((prev) => !prev)}
              data-testid="more-btn"
              aria-label="更多"
              aria-haspopup="menu"
              aria-expanded={showMoreMenu}
            >
              <MoreIcon />
            </button>
          </Tooltip>
        )}
        {panelToggle && (
          <Tooltip
            text={panelToggle.expanded ? "收起面板" : "展开面板"}
            position="bottom"
          >
            <button
              className="header-button header-panel-toggle"
              onClick={panelToggle.onToggle}
              data-testid="panel-toggle-btn"
              aria-label={panelToggle.expanded ? "收起面板" : "展开面板"}
              aria-expanded={panelToggle.expanded}
            >
              {panelToggle.expanded ? (
                <PanelCollapseIcon />
              ) : (
                <PanelExpandIcon />
              )}
            </button>
          </Tooltip>
        )}
        {headerActions}
      </div>
      {sessionListVisible && (
        <SessionListPopup
          sessions={sessions}
          currentSession={currentSession}
          onSessionSelect={onSessionSelect}
          loading={sessionsLoading}
          onClose={closeSessionList}
          // The remote page's list holds what the serving process is running, not
          // history, and it spans every working directory of that process — so it
          // says so, and shows the project the way the desktop modal does.
          title={sessionSwitchButton ? "会话" : "历史对话"}
          showProject={sessionSwitchButton}
          sessionStatus={sessionStatus}
        />
      )}
      {showMoreMenu && !hideMoreButton && (
        <MoreMenu
          onOpenSettings={onOpenSettings}
          onOpenEnterpriseConsole={onOpenEnterpriseConsole}
          onOpenHelpDocs={onOpenHelpDocs}
          onLogin={onLogin}
          onLogout={onLogout}
          isAuthenticated={isAuthenticated}
          pushNotifications={pushNotifications}
          onClose={() => setShowMoreMenu(false)}
          triggerRef={moreBtnRef}
        />
      )}
    </div>
  );
};

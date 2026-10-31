/**
 * RemoteNewSessionDialog — 远控 Web 页「新建对话」弹窗。
 *
 * 顶栏「新建对话」图标在远控页被重绑到这里（与桌面端远程主机「新对话」同一
 * 交互形状：最近目录 + 浏览…，见 spec remote/remote-web.md「Web 端也能发起新
 * 会话」）。底下的动作与 插件端的 clearChat 完全不同——它不就地清空当前会话：
 * 目录选定后经 shim 发 `initialize`（中继网关收敛入参）在远端机器上真实建一个
 * 新会话，`newSessionCreated` 回来时 shim 已切到新 sessionId 并拉了首屏快照，
 * 本弹窗只需关闭。
 *
 * 请求/回执全部 requestId 匹配（弹窗开着时用户可以反复换目录、换分支，只有
 * 最新一次请求的回执允许落进 UI —— 设置页的远程控制视图同一纪律）。
 *
 * 分支与 worktree 控件仅在所选目录是 git 仓库时出现：判据不是猜扩展名，而是
 * `listGitBranches` 的回执本身——回执是**一对 `{branches, current}`**（宿主
 * `AgentBridge.listGitBranches` 的形状，与桌面端 `desktopGitBranches` 同一份），
 * 拿到它才渲染，非仓库/无 git 时宿主回错 ⇒ 静默不渲染，创建仍然可用。默认值与
 * 桌面端新建会话页一致：基准分支取 `current`，worktree 开关默认勾选。
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useHostMessage } from "../utils/useHostMessage";
import { DirectoryBrowser } from "./DirectoryBrowser";
import "../styles/ConfigurationDialog.css";
import "../styles/DesktopApp.css";

export interface RemoteNewSessionDialogProps {
  /** 当前进程跑过的会话里去重后的工作目录（最近目录区）。 */
  recentDirs: string[];
  vscode: { postMessage: (msg: unknown) => void };
  onClose: () => void;
}

interface BranchReply {
  requestId: string;
  /** `listGitBranches` 的回执：一对 {branches, current}，非仓库时宿主回错 ⇒ null。 */
  result: { branches: string[]; current: string | null } | null;
  error?: string;
}

interface CreateOkReply {
  requestId: string;
  sessionId: string;
}

interface CreateFailReply {
  requestId: string;
  error: string;
}

const RemoteNewSessionDialog: React.FC<RemoteNewSessionDialogProps> = ({
  recentDirs,
  vscode,
  onClose,
}) => {
  const [workdir, setWorkdir] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [baseBranch, setBaseBranch] = useState("");
  const [useWorktree, setUseWorktree] = useState(false);
  const [worktreeName, setWorktreeName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const branchesRequestRef = useRef<string | null>(null);
  const createRequestRef = useRef<string | null>(null);
  const requestSeqRef = useRef(0);

  const post = useCallback(
    (msg: Record<string, unknown>) => vscode.postMessage(msg),
    [vscode],
  );

  // 目录浏览器：列表请求经 shim 的 newSessionListDirs 转中继 listDirectories
  // RPC；回执 newSessionDirs 由 DirectoryBrowser 按 requestId 消费。号由本弹窗
  // 统一分配（弹窗常驻，浏览器面板重挂不复位——迟到回执不错配新请求）。
  const handleRequestList = useCallback(
    (path: string) => {
      const requestId = `remote-new-session-${++requestSeqRef.current}`;
      post({ command: "newSessionListDirs", dir: path, requestId });
      return requestId;
    },
    [post],
  );

  // 选定目录 → 拉分支（决定下半区是「分支+worktree」还是只有目录）。
  const chooseWorkdir = useCallback(
    (path: string) => {
      setBrowsing(false);
      setWorkdir(path);
      setError(null);
      setBranches(null);
      setBranchesLoading(true);
      // 与桌面端新建会话页同一条默认：worktree 开关**默认勾选**（桌面端在拿到
      // 分支列表时 setWorktreeChecked(true)）。非仓库目录下控件不渲染，
      // handleCreate 里的 `useWorktree && !!baseBranch` 也会把它挡掉。
      setUseWorktree(true);
      setWorktreeName("");
      const requestId = `remote-new-session-${++requestSeqRef.current}`;
      branchesRequestRef.current = requestId;
      post({
        command: "newSessionListBranches",
        workdir: path,
        requestId,
      });
    },
    [post],
  );

  useHostMessage((message) => {
    if (message.command === "newSessionBranches") {
      const reply = message as unknown as BranchReply;
      if (reply.requestId !== branchesRequestRef.current) return;
      branchesRequestRef.current = null;
      setBranchesLoading(false);
      if (reply.result) {
        const list = reply.result.branches ?? [];
        setBranches(list);
        // 基准分支默认 = 该目录的当前分支（桌面端新建会话页同一条默认：
        // `gitBranches.current`）；没有当前分支（detached HEAD / 空仓库）时退到
        // 列表第一项。
        setBaseBranch(reply.result.current ?? list[0] ?? "");
      } else {
        // 非 git 仓库 / 分支读取失败：没有分支控件也能建会话。
        setBranches(null);
      }
      return;
    }
    if (message.command === "newSessionCreated") {
      const reply = message as unknown as CreateOkReply;
      if (reply.requestId !== createRequestRef.current) return;
      // shim 已切到新会话并拉了快照；这里只收尾。
      createRequestRef.current = null;
      setCreating(false);
      onClose();
      return;
    }
    if (message.command === "newSessionCreateFailed") {
      const reply = message as unknown as CreateFailReply;
      if (reply.requestId !== createRequestRef.current) return;
      createRequestRef.current = null;
      setCreating(false);
      setError(reply.error || "创建会话失败");
    }
  });

  const handleCreate = useCallback(() => {
    if (!workdir || creating) return;
    setError(null);
    setCreating(true);
    const requestId = `remote-new-session-${++requestSeqRef.current}`;
    createRequestRef.current = requestId;
    post({
      command: "newSessionCreate",
      workdir,
      useWorktree: useWorktree && !!baseBranch,
      baseBranch: useWorktree ? baseBranch : undefined,
      name: useWorktree ? worktreeName.trim() || undefined : undefined,
      requestId,
    });
  }, [workdir, creating, useWorktree, baseBranch, worktreeName, post]);

  // Escape closes only the dialog (capture phase, so MessageInput never sees
  // it — the settings page's remote-control view does the same).
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscapeKey, true);
    return () => document.removeEventListener("keydown", handleEscapeKey, true);
  }, [onClose]);

  const recents = recentDirs.filter((d) => d !== workdir);

  return (
    <div className="configuration-dialog-overlay">
      <div
        className="configuration-dialog"
        data-testid="remote-new-session-dialog"
        style={{ height: "auto", maxHeight: "min(680px, 88vh)" }}
      >
        <div className="configuration-dialog-header">
          <h3>新建对话</h3>
        </div>
        <div className="configuration-form">
          <div className="configuration-fields-scroll-area">
            {browsing ? (
              <DirectoryBrowser
                replyCommand="newSessionDirs"
                onRequestList={handleRequestList}
                onSelect={chooseWorkdir}
                onClose={() => setBrowsing(false)}
              />
            ) : workdir ? (
              <>
                <div
                  className="remote-new-session-workdir"
                  data-testid="remote-new-session-workdir"
                  style={{
                    fontSize: "13px",
                    fontFamily: "var(--vscode-editor-font-family, monospace)",
                    wordBreak: "break-all",
                    padding: "4px 0",
                  }}
                >
                  {workdir}
                  <button
                    type="button"
                    className="configuration-cancel-btn"
                    style={{ marginLeft: "8px", padding: "2px 10px" }}
                    onClick={() => {
                      setWorkdir(null);
                      setBranches(null);
                    }}
                    data-testid="remote-new-session-change-dir"
                  >
                    更换目录
                  </button>
                </div>
                {branchesLoading ? (
                  <div
                    className="remote-new-session-branches-loading"
                    data-testid="remote-new-session-branches-loading"
                    style={{
                      fontSize: "12px",
                      color: "var(--vscode-descriptionForeground)",
                      padding: "4px 0",
                    }}
                  >
                    正在读取分支…
                  </div>
                ) : branches ? (
                  <>
                    <div className="configuration-field">
                      <label>基于分支:</label>
                      <select
                        value={baseBranch}
                        onChange={(e) => setBaseBranch(e.target.value)}
                        data-testid="remote-new-session-branch-select"
                      >
                        {branches.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="configuration-field">
                      <label
                        style={{
                          display: "flex",
                          gap: "6px",
                          alignItems: "center",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={useWorktree}
                          onChange={(e) => setUseWorktree(e.target.checked)}
                          data-testid="remote-new-session-worktree-check"
                        />
                        在独立 worktree 中打开
                      </label>
                    </div>
                    {useWorktree && (
                      <div className="configuration-field">
                        <label>worktree 名称:</label>
                        <input
                          type="text"
                          value={worktreeName}
                          placeholder="留空自动命名"
                          onChange={(e) => setWorktreeName(e.target.value)}
                          data-testid="remote-new-session-worktree-name"
                        />
                      </div>
                    )}
                  </>
                ) : null}
                {error ? (
                  <div
                    role="alert"
                    data-testid="remote-new-session-error"
                    style={{
                      fontSize: "12px",
                      color: "var(--vscode-errorForeground)",
                      padding: "4px 0",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {error}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                {recents.length > 0 && (
                  <div
                    className="remote-new-session-recents"
                    data-testid="remote-new-session-recents"
                  >
                    <div className="desktop-workdir-menu-label">最近目录</div>
                    {recents.map((dir) => (
                      <div
                        key={dir}
                        className="desktop-workdir-menu-item"
                        role="button"
                        tabIndex={0}
                        title={dir}
                        onClick={() => chooseWorkdir(dir)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            chooseWorkdir(dir);
                          }
                        }}
                        data-testid="remote-new-session-recent-item"
                      >
                        <span className="codicon codicon-folder"></span>
                        <span className="desktop-workdir-menu-path">
                          <span className="desktop-workdir-menu-name">
                            {dir.split("/").filter(Boolean).pop() || dir}
                          </span>
                          <span className="desktop-workdir-menu-parent">
                            {dir.slice(0, dir.lastIndexOf("/"))}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="configuration-field">
                  <button
                    type="button"
                    className="configuration-cancel-btn"
                    onClick={() => setBrowsing(true)}
                    data-testid="remote-new-session-browse"
                  >
                    浏览…
                  </button>
                </div>
                {error ? (
                  <div
                    role="alert"
                    data-testid="remote-new-session-error"
                    style={{
                      fontSize: "12px",
                      color: "var(--vscode-errorForeground)",
                      padding: "4px 0",
                    }}
                  >
                    {error}
                  </div>
                ) : null}
              </>
            )}
          </div>
          <div className="configuration-actions">
            <button
              type="button"
              className="configuration-save-btn"
              onClick={handleCreate}
              disabled={!workdir || creating}
              data-testid="remote-new-session-create"
            >
              {creating ? "创建中…" : "创建"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="configuration-cancel-btn"
              data-testid="remote-new-session-cancel"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RemoteNewSessionDialog;

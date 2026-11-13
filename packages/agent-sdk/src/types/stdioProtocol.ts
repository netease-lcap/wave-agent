/**
 * The stdio JSON-RPC method namespace.
 *
 * This file is the **single** declaration of it, and it is load-bearing rather
 * than documentation: `RpcClient` (host side) and `AgentBridge.handleRequest` /
 * `NotificationEmitter` (CLI side) are all typed with these unions, so the two
 * hand-written implementations cannot drift apart silently.
 *
 * Both directions are compiler-enforced:
 * - a method the bridge implements but the union lacks → the `case` does not
 *   typecheck against the switch's subject (and the `never` check in the
 *   bridge's `default:` branch fails too);
 * - a union member the bridge forgot to implement → the same `never` check
 *   fails;
 * - a typo on either side (host call site, emit call site) → does not compile.
 *
 * JSON-RPC `method` arrives as an untrusted string at the transport boundary;
 * the cast happens exactly there and nowhere else.
 */

// ── Client → Server request methods ─────────────────────────────

export type RequestMethod =
  | "initialize"
  | "destroy"
  | "restoreSession"
  | "listSessions"
  | "listAllSessions"
  | "renameSession"
  | "getSessionInfo"
  | "sendMessage"
  | "bang"
  | "askBtw"
  | "closeBtw"
  | "abortMessage"
  | "clearMessages"
  | "rewindToMessage"
  | "listRewindCheckpoints"
  | "deleteQueuedMessage"
  | "updateQueuedMessage"
  | "deleteQueuedMessageById"
  | "getMessages"
  | "setPermissionMode"
  | "getPermissionMode"
  | "getPlanFile"
  // On-demand image fetch for the remote-control page: read one file **on this
  // machine**, prove it really is an image (by content, not by extension) and
  // return it shrunk to fit a single relay frame. The page cannot read files at
  // all, and message payloads have their image bytes stripped before they cross
  // the relay, so this is the only way a screenshot an agent saved to disk can be
  // seen on a phone (spec remote/remote-web.md「点消息里的图片路径看原图」).
  | "getImagePreview"
  // Read the head of one **text** file from this machine and return it decoded
  // (spec remote/remote-web.md「点消息里的文件路径看内容」). Same on-demand
  // shape as `getImagePreview`, different gate: that one is authorised by the
  // decoded raster container, this one by "are these bytes text at all".
  | "getTextPreview"
  | "getMcpServers"
  | "connectMcpServer"
  | "disconnectMcpServer"
  | "removeMcpServer"
  | "getMcpConfigPaths"
  | "getSlashCommands"
  | "getSubagentConfigurations"
  | "getSkillMetadata"
  | "deleteSkill"
  | "deleteSubagent"
  | "getHooksByScope"
  | "deleteHook"
  | "searchFiles"
  | "writeArtifactFile"
  | "getPromptHistory"
  | "searchPromptHistory"
  | "updateConfig"
  | "getConfiguredModels"
  | "setModel"
  // User preferences (global — read/write user-level ~/.wave/settings.json)
  | "getUserSettings"
  | "updateUserSettings"
  // Permissions (daemon attach: re-surface pending approvals after reconnect)
  | "listPendingPermissions"
  // Daemon (global — list in-memory session registry, no session required)
  | "listDaemonSessions"
  // Daemon-only, and **conditional even there** — do not read this as "every
  // client can call it": the bridge answers `shutdown` only when its transport
  // registered `onShutdownRequest` (daemon stop/restart). A stdio process leaves
  // that unset, so there the RPC is -32601 "Method not found".
  | "shutdown"
  // Remote control (daemon-level: the outbound relay connection that serves a
  // paired phone). The bridge only routes these to the daemon's controller.
  | "remoteControlStatus"
  | "remoteControlConnect"
  | "remoteControlDisconnect"
  // Auth
  | "getAuthStatus"
  | "getAccountInfo"
  | "login"
  | "logout"
  // Git (deep link: install the credential helper git calls)
  | "installGitCredentialHelper"
  // 创作集（Artifacts 画廊）：账号级读写面，global — 无 session 也可调用。
  // 桌面端整页用它拿列表 / 分享状态，并写分享、撤销发布、检索成员。
  | "artifactGalleryList"
  | "artifactShareView"
  | "artifactShareSave"
  | "artifactRevoke"
  | "artifactMembersSearch"
  // Memory files (user-level ~/.wave/AGENTS.md and project-level <workdir>/AGENTS.md)
  | "getAgentsContent"
  | "setAgentsContent"
  // Plugins
  | "listPlugins"
  | "installPlugin"
  | "uninstallPlugin"
  | "enablePlugin"
  | "disablePlugin"
  // Plugin config readers (plugin settings page): these read the config files
  // themselves — settings.json / .mcp.json / hooks config — rather than the
  // plugin registry, so the host can show what is actually on disk.
  | "getProjectSettings"
  | "getHooksConfig"
  | "getMcpConfig"
  | "setBuiltinPluginEnabled"
  | "updatePlugin"
  | "setPluginScope"
  | "reloadPlugins"
  | "listMarketplaces"
  // Re-fetch the marketplace checkouts without upgrading plugins (opening the
  // marketplace page).
  | "refreshMarketplaces"
  | "addMarketplace"
  | "removeMarketplace"
  | "updateMarketplace"
  | "compact"
  | "getBackgroundTaskOutput"
  | "stopBackgroundTask"
  // Move the current turn's work into a background task (Ctrl+B in the CLI).
  | "backgroundCurrentTask"
  | "getWorkflowRuns"
  | "stopWorkflowRun"
  // Git / worktree (global — no session required)
  | "listGitBranches"
  | "createWorktree"
  | "getWorktreeChanges"
  // The *bound session's* uncommitted changes (worktree-aware, no path arg),
  // as opposed to getWorktreeChanges' explicit path/baseBranch pair.
  | "getSessionWorktreeChanges"
  | "removeWorktree"
  // Filesystem (global — no session required): the new-session directory
  // pickers. Host-agnostic like listGitBranches — whichever wave process
  // receives it lists its own machine.
  | "listDirectories"
  // One level of a directory, for the desktop file panel's tree: direct
  // children with a dir/file flag, junk filtered, sorted, capped per level.
  // Host-agnostic like listDirectories — whichever wave process receives it
  // lists its own machine (local stdio client, or a remote daemon over the
  // desktop's tunnel). Kept separate from listDirectories because that one is
  // the new-session *directory picker*: directories only, no cap, and its
  // symlink behaviour is pinned to the shell `find -type d` it replaced.
  | "listDirectoryEntries"
  // Recently opened working directories (global — no session required):
  // `~/.wave/recent-workdirs.json` on **this** machine. Read by the desktop app
  // per host and by the remote-control page, so the two see one list; the write
  // is the caller's "the user picked this directory" moment (spec
  // core/recent-workdirs.md). `forgetRecentWorkdir` is the desktop's
  // 「从列表移除」 — it must land here, or the next read brings the entry back.
  | "getRecentWorkdirs"
  | "rememberRecentWorkdir"
  | "forgetRecentWorkdir"
  // Read-only workspace diff for the desktop diff panel
  | "getWorkspaceDiff"
  // Inline (ghost-text) code completion for the editor plugins. Session-scoped:
  // the model and the gateway credentials are resolved inside that session, and
  // a new request supersedes the session's previous in-flight one.
  | "getCompletion"
  // What the editor host saw happen to the last suggestion: `displayed` when it
  // rendered the ghost text, `accepted` when the user took it. Only the host
  // knows either fact — see `wave.completion.outcome` in the telemetry spec.
  | "reportCompletionOutcome"
  // What the host saw happen to the last next-edit suggestion. Its own method
  // and its own metric (`wave.next_edit.outcome`): completion's rate counts
  // caret insertions, a rewrite is a different capability.
  | "reportNextEditOutcome"
  // Next-edit suggestion for the editor plugins (spec ui/next-edit-suggestion.md).
  // Same session-scoped, supersede-on-new-request shape as `getCompletion`, but
  // the input is the user's edit trajectory plus a rewritable window of the
  // file, and the answer replaces lines instead of being inserted at a caret.
  | "getNextEdit"
  // A user interaction inside a plugin mod's panel (spec
  // ecosystem/plugin-mods.md). Params: `ModPanelEventPayload` — which mod, which
  // pane, which element `key`, and whether it was a press, an input or the tab
  // being closed. The mod itself runs in this process; the host is only carrying
  // the click here.
  | "modPanelEvent"
  // Every open mod panel, as full snapshots. Session-scoped resync: a host that
  // attached after `session.start` (session restore, remote re-attach) would
  // otherwise miss the `modPanelUpdate` notifications that opened them.
  | "getModPanels";

// ── Client → Server notification methods ────────────────────────

export type ClientNotificationMethod = "permissionResponse";

// ── Server → Client notification methods ────────────────────────

/**
 * One step of the first-start path, reported while the loading animation is on
 * screen (spec `ui/stdio-transport.md`「首次启动的进度文案」).
 *
 * Ids, not copy: the CLI emits `startupStage` notifications carrying one of
 * these, and every surface renders it through `startupStageText()` so the four
 * hosts (desktop / VS Code / JetBrains / remote) cannot drift apart. Which of
 * them a host can actually report is host-shaped — `connecting` /
 * `checkingEnvironment` / runtime / CLI stages are host-side (only the host
 * knows its target and transport), while `downloadingToolDeps` and
 * `startingSession` are the CLI's own startup steps and arrive over the wire.
 */
export type StartupStage =
  /** `connecting` — dialing the host (desktop SSH / WSL only). */
  | "connecting"
  /** Probing the target (uname, markers) before deciding what to install. */
  | "checkingEnvironment"
  /** Fetching the managed Node.js runtime archive. */
  | "downloadingRuntime"
  /** Unpacking, verifying and swapping the runtime into place. */
  | "installingRuntime"
  /** Copying / streaming the bundled CLI into `~/.wave/cli/<end>`. */
  | "syncingCli"
  /** CLI startup: installing sharp + ripgrep into `~/.wave/cli/node_modules`. */
  | "downloadingToolDeps"
  /** CLI is up and about to serve `initialize`. */
  | "startingSession";

export type ServerNotificationMethod =
  | "userMessageAdded"
  | "assistantMessageAdded"
  | "assistantMessageDiscarded"
  | "assistantContentUpdated"
  | "assistantReasoningUpdated"
  | "toolBlockUpdated"
  | "noticeAdded"
  | "loadingChange"
  | "commandRunningChange"
  | "queuedMessagesChange"
  | "tasksChange"
  | "sessionIdChange"
  | "permissionModeChange"
  | "mcpServersChange"
  | "workdirChange"
  /**
   * The session's workspace moved (EnterWorktree / ExitWorktree). Distinct from
   * `workdirChange`, which also fires for a bash `cd`: this one means the
   * conversation now works in another working tree, so the host re-points the
   * surfaces that show "the project the user is looking at" (diff panel, file
   * tree, `@` search). Params: `{ workspaceRoot: string }`.
   */
  | "workspaceRootChange"
  | "notificationMessageAdded"
  | "permissionRequest"
  /**
   * 一条待审批请求**不再是待审批**了 —— 有人答了：本机宿主、另一个宿主进程、
   * 手机上那一页，都是一回事。Params: `{ requestId: string }`。
   *
   * 为什么必须有这条：审批卡是**每个客户端各挂一份**的，而请求本身只有一份
   * （`AgentBridge.pendingPermissions`）。答复在谁手里发生，别处那片卡就只能
   * 靠这条通知撤——否则用户从手机答完回到电脑前，桌面上还压着那几张卡（点它
   * 只会发一条 requestId 已消失的 `permissionResponse`，桥静默忽略）。对侧同理：
   * 电脑上答了，手机那张卡不会自己消失。
   *
   * 发点只有一处：桥**每**把一条请求从待审批表里摘掉时都发（含发起方自己收到
   * 的那一次）——收到方按自己那份卡的 id 过滤，重复撤一张已撤的卡是幂等的。
   * 客户端因此不需要判「是不是我答的」。
   */
  | "permissionResolved"
  | "authUrl"
  | "compactBlockAdded"
  | "compactionStateChange"
  | "compactionContentUpdate"
  | "planFileUpdated"
  | "backgroundTasksChange"
  | "btwContent"
  | "contextUsage"
  /**
   * 额度响应头（`x-codechat-quota-*`），来自**每一次**模型调用的响应（成功与
   * 非 2xx 都带）。Params: `{ headers: Record<string, string> }`，键为小写、
   * 原样透传，SDK 不解析字段。只在响应里真的出现这批头时发出——一个都没有
   * （私有化部署 / 自定义网关）就一次都不发，宿主据此不更新、不额外查询
   * （spec: docs/specs/desktop/desktop-account.md「额度响应头」）。
   */
  | "quotaHeaders"
  /**
   * Startup progress for the loading animation (spec
   * `ui/stdio-transport.md`「首次启动的进度文案」). **Global** — no `sessionId`:
   * the CLI emits it before `initialize` returns, when no session is bound yet,
   * so the router hands it to the global handler. Params: `{ stage: StartupStage }`.
   *
   * Report-only: it carries no control semantics (nothing waits for it, nothing
   * is gated on it) and never takes part in a startup/restore completion
   * condition — a dropped or unhandled `startupStage` changes nothing but the
   * caption.
   */
  | "startupStage"
  /**
   * Structural notice, **content-free** (`{}`). The bridge sends it only on the
   * `restoreSession` re-attach branch — a catch-up for a client whose router
   * registered after `initialize` returned — never on the message stream's beat.
   *
   * Nothing mirrors messages from it: the remote relay turns it into the phone's
   * signal and the phone pulls `getMessages({ since })`; IDE hosts ignore the
   * method and pull `getMessages` themselves. Hosts rendering from incremental
   * notifications must therefore **not** subscribe to it.
   */
  | "messagesChange"
  /**
   * A plugin mod's panel changed (spec `ecosystem/plugin-mods.md`). Params:
   * `ModPanelUpdatePayload` — a **full** element tree plus a monotonic
   * `revision`, or `closed: true` when the pane went away.
   *
   * Full snapshots rather than deltas on purpose: a tree is capped at 2000
   * nodes, and a delta protocol would need a stable id per element (keyed
   * reconciliation) for no measurable win at this size.
   */
  | "modPanelUpdate";

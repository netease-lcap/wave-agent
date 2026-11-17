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
  // `/context` 的报告数据：按来源拆开的上下文构成（spec
  // commands/context-command.md）。只读快照，不触发模型请求。
  | "getContextBreakdown"
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
  // Memory files (`scope`: user-level ~/.wave/AGENTS.md, project-level
  // <workdir>/AGENTS.md, personal <workdir>/AGENTS.local.md)
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
  | "getWorkflowAgentActivity"
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
  // The tree for one panel, **pulled by the surface** (spec: trees are pulled,
  // never pushed). Params: `{ modId, paneId }`; returns `ModPanelRenderResult`.
  // Nothing is cached: every call runs the mod's `ui.render` again.
  | "modPanelRender"
  // The trees for the band above the composer (spec 状态带、状态行与提示). Same
  // pull discipline as `modPanelRender`: no params, returns `ModBandRenderResult[]`
  // — one entry per mod that registers `ui.render`; an entry whose `tree` is null
  // takes no space.
  | "modBandRender"
  // Every open mod panel's **metadata** (no trees — the surface pulls each tree
  // with `modPanelRender`). Session-scoped resync: a host that attached after
  // `session.start` (session restore, remote re-attach) would otherwise miss the
  // `modPanelUpdate` notifications that opened them.
  | "getModPanels"
  // The surface's answer to a `modPromptFill` push (spec「把草稿填进输入框」).
  // Params: `{ requestId, filled }`. An unknown `requestId` (the 5 s limit
  // already answered `{ isFilled: false }`) is ignored rather than an error.
  | "modPromptFillResult"
  // The surface's answer to a `modPromptRead` push (spec「输入框里现在有什么」).
  // Params: `{ requestId, text, cursor }`. An unknown `requestId` (the 3 s limit
  // already answered an empty draft) is ignored rather than an error.
  | "modPromptReadResult"
  // The surface's answer to a `modCopy` push (spec「剪贴板与视图」). Params:
  // `{ requestId, isCopied, reason? }`. A refusal is a normal answer.
  | "modCopyResult"
  // The surface's answer to a `modPromptSuggest` push (spec「输入框里的建议与焦
  // 点」). Params: `{ requestId, isShown }`. An unknown `requestId` (the limit
  // already answered `{ isShown: false }`) is ignored rather than an error.
  | "modPromptSuggestResult"
  // 用户在输入框里做完一次编辑（spec「输入框里的建议」）。**方向反过来**：
  // 这次是宿主先说话 —— 只有它知道用户按了什么、草稿变成了什么。Params:
  // `{ key?, text, cursor, start, end, inputText }`（`text`/`cursor` 是编辑**之
  // 前**的草稿与光标）；返回 `{ text, cursor }` 是插件改写后的结果，宿主照它
  // 覆盖输入框。终端不存在这条调用。
  | "promptEdit"
  // The surface's view of the panes: which one it has open in front and where
  // its keyboard is (spec「面板的显示与焦点」). Feeds `$.ui.panes()` 的
  // `isShown` / `isFocused`. Params: `ModPaneViewPayload` — a **full snapshot**
  // (`{ shown, focused }`, each a `{ modId, paneId }` or `null`), not an
  // increment. Two surfaces on one session overwrite each other; the last report
  // wins, same as Claude Code keeps a single `shownId` / `focusedId`.
  | "modPaneView";

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
   * A one-shot notice the SDK owes the user, which belongs to no session (spec
   * `enterprise/server-managed-config.md`「私有化未授权时给出一次性提示」, as
   * well as an expired SSO session and an unparseable settings file).
   * **Global** — no `sessionId`: these come from process-level work that runs
   * before any session is bound (startup, SSO login, hourly poll) or from a
   * subsystem the process owns, so the router hands them to the global handler.
   * Params: `{ kind: HostNoticeKind, message: string }`. `message` is the SDK's
   * own copy — for the license gate it is the server's `error` text verbatim —
   * and the host renders it as-is, never composing a second sentence.
   *
   * Already de-duplicated in the SDK (one per license code, one per expired
   * session, one per broken path), each source re-arming on its own success
   * path; consumers only have to show it. Report-only: a dropped or unhandled
   * notification changes nothing but the notice.
   */
  | "hostNotice"
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
  | "modPanelUpdate"
  /**
   * A mod set or cleared its line under the composer (`$.ui.status`; spec
   * 状态带、状态行与提示). Params: `ModStatusPayload`; `text: null` clears.
   *
   * The host keeps no copy: the mod's own `$.state` is the truth, and it re-posts
   * after a surface re-attaches.
   */
  | "modStatusUpdate"
  /** A mod asked for a transient notice (`$.ui.toast`). Params: `ModToastPayload`. */
  | "modToast"
  /**
   * A mod wants a draft placed in the composer (`$.prompt.fill`; spec
   * 「把草稿填进输入框」). Params: `ModPromptFillRequest`.
   *
   * The one mod push that expects an answer — the host replies with the
   * `modPromptFillResult` RPC, and no answer in time reads as `{ isFilled:
   * false }`. It never touches the conversation: the text is a draft the user
   * still has to send.
   */
  | "modPromptFill"
  /**
   * A mod wants to read the composer (`$.prompt.read`; spec「输入框里现在有什
   * 么」). Params: `ModPromptReadRequest`.
   *
   * The mirror image of `modPromptFill`: the same round trip, and the surface
   * answers with the `modPromptReadResult` RPC. No answer in time reads as an
   * empty draft — "nobody is drawing a composer" and "the user typed nothing"
   * are the same answer to a mod.
   */
  | "modPromptRead"
  /**
   * A mod wants text on the clipboard (`$.ui.copy`; spec「剪贴板与视图」).
   * Params: `ModCopyRequest`; answered with the `modCopyResult` RPC.
   */
  | "modCopy"
  /**
   * One line under a tool call (`$.ui.notice`; spec「工具行下面的一行」).
   * Params: `ModNoticePayload`; `text: null` removes the line.
   *
   * Push-only and **not replayed**: the mod's own `$.state` is the truth and it
   * re-posts on `ui.render`, exactly like `modStatusUpdate`.
   */
  | "modNotice"
  /**
   * A mod wants ghost text above the composer (`$.prompt.suggest`; spec「输入框
   * 里的建议与焦点」). Params: `ModPromptSuggestRequest`; answered with the
   * `modPromptSuggestResult` RPC, and no answer in time reads as
   * `{ isShown: false }`.
   *
   * Unlike `modPromptFill` this never touches the draft: the suggestion is shown
   * dimmed, and only Tab (the person accepting it) puts the text in.
   */
  | "modPromptSuggest";

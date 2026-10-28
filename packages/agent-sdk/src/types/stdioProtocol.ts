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
  | "abortMessage"
  | "clearMessages"
  | "rewindToMessage"
  | "listRewindCheckpoints"
  | "deleteQueuedMessage"
  | "updateQueuedMessage"
  | "deleteQueuedMessageById"
  | "getMessages"
  | "getFullMessageThread"
  | "setPermissionMode"
  | "getPermissionMode"
  | "getPlanFile"
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
  // core/recent-workdirs.md).
  | "getRecentWorkdirs"
  | "rememberRecentWorkdir"
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
  | "getNextEdit";

// ── Client → Server notification methods ────────────────────────

export type ClientNotificationMethod = "permissionResponse";

// ── Server → Client notification methods ────────────────────────

export type ServerNotificationMethod =
  | "userMessageAdded"
  | "assistantMessageAdded"
  | "assistantMessageDiscarded"
  | "assistantContentUpdated"
  | "assistantReasoningUpdated"
  | "toolBlockUpdated"
  | "errorBlockAdded"
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
  | "authUrl"
  | "compactBlockAdded"
  | "compactionStateChange"
  | "compactionContentUpdate"
  | "planFileUpdated"
  | "backgroundTasksChange"
  | "btwContent"
  | "contextUsage"
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
  | "messagesChange";

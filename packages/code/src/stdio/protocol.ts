/**
 * JSON-RPC 2.0-compatible protocol types for stdio communication.
 *
 * Each line on stdin/stdout is one JSON object.
 * - Requests have `id` (number|string) and expect a response.
 * - Responses match the request `id` with either `result` or `error`.
 * - Notifications have no `id` and expect no response.
 */

// ── Envelope types ──────────────────────────────────────────────

export interface JsonRpcRequest {
  id: number | string;
  method: string;
  params?: unknown;
  /** Session-scoped requests carry sessionId for routing to the right Agent. */
  sessionId?: string;
}

export interface JsonRpcResponse {
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
  /** Session-scoped notifications carry sessionId for demultiplexing on the client. */
  sessionId?: string;
}

// ── Error codes (JSON-RPC 2.0 standard) ────────────────────────

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

// ── Client → Server request methods ─────────────────────────────

export type RequestMethod =
  | "initialize"
  | "destroy"
  | "restoreSession"
  | "listSessions"
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
  // User preferences (global — read/write user-level ~/.wave/settings.json,
  // 设置页保存路径，见 docs/specs/core/agent-config.md「设置实时重载」)
  | "getUserSettings"
  | "updateUserSettings"
  // Managed settings (global — 服务端下发的托管配置原文，无 session；设置页
  // 「服务端配置」区块只读展示用，见 docs/specs/enterprise/server-managed-config.md)
  | "getManagedSettings"
  // Permissions (daemon attach: re-surface pending approvals after reconnect)
  | "listPendingPermissions"
  // Daemon (global — list in-memory session registry, no session required)
  | "listDaemonSessions"
  // Auth
  | "getAuthStatus"
  | "getAccountInfo"
  | "login"
  | "logout"
  // Memory files (user-level ~/.wave/AGENTS.md and project-level <workdir>/AGENTS.md)
  | "getAgentsContent"
  | "setAgentsContent"
  // Plugins
  | "listPlugins"
  | "installPlugin"
  | "uninstallPlugin"
  | "enablePlugin"
  | "disablePlugin"
  | "updatePlugin"
  | "setPluginScope"
  | "listMarketplaces"
  | "addMarketplace"
  | "removeMarketplace"
  | "updateMarketplace"
  | "compact"
  | "getBackgroundTaskOutput"
  | "stopBackgroundTask"
  | "getWorkflowRuns"
  | "stopWorkflowRun"
  // Git / worktree (global — no session required)
  | "listGitBranches"
  | "createWorktree"
  | "getWorktreeChanges"
  | "removeWorktree";

// ── Client → Server notification methods ────────────────────────

export type ClientNotificationMethod = "permissionResponse";

// ── Server → Client notification methods ────────────────────────

export type ServerNotificationMethod =
  | "userMessageAdded"
  | "assistantMessageAdded"
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
  | "notificationMessageAdded"
  | "permissionRequest"
  | "authUrl"
  | "compactBlockAdded"
  | "compactionStateChange"
  | "compactionContentUpdate"
  | "backgroundTasksChange"
  | "btwContent"
  | "contextUsage";

// ── Helper: is this a request (has id)? ─────────────────────────

export function isRequest(msg: unknown): msg is JsonRpcRequest {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "method" in msg &&
    "id" in msg &&
    (typeof (msg as { id: unknown }).id === "number" ||
      typeof (msg as { id: unknown }).id === "string")
  );
}

export function isNotification(msg: unknown): msg is JsonRpcNotification {
  return (
    typeof msg === "object" && msg !== null && "method" in msg && !("id" in msg)
  );
}

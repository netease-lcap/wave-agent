/**
 * Shared host → webview fixture factory.
 *
 * Every fixture is a superset of the real host payloads: it carries the union
 * of fields both hosts (VSCE messageHandler, desktop desktopHost) actually
 * send, with defaults pinned to realistic values (setInitialState always
 * carries `inputContent: ''`, `isAuthenticated: true`, `sessions: []`, …).
 *
 * Contract gates must use `toMatchObject(fixture)` / `objectContaining`, NOT
 * `toEqual` — a fixture may contain a field the asserting host does not send.
 *
 * This is test infrastructure, not runtime code: changing a fixture default
 * intentionally breaks the tests that rely on it (that is the point), and the
 * package must be rebuilt (`pnpm -F wave-webview-fixtures build`) for changes
 * to reach consumers, same as agent-sdk.
 */

import type {
  Message,
  Task,
  PermissionMode,
  BackgroundTaskSummary,
  SerializableWorkflowRun,
  SessionMetadata,
  SetInitialStateMessage,
  AuthStatusResponseMessage,
  AgentsContentResponseMessage,
  AgentsContentSavedMessage,
  ContextUsageMessage,
  UpdateMessagesMessage,
  AppendMessageMessage,
  UpdatePermissionModeMessage,
  UpdateCurrentSessionMessage,
  UpdateTasksMessage,
  UpdateToolBlockMessage,
  UpdateErrorBlockMessage,
  UpdateWorkdirMessage,
  StartStreamingMessage,
  EndStreamingMessage,
  CompactionStateChangeMessage,
  CompactionContentUpdateMessage,
  BtwResponseMessage,
  McpServersResponseMessage,
  SubagentConfigurationsResponseMessage,
  SkillMetadataResponseMessage,
  HooksResponseMessage,
  McpConfigPathsResponseMessage,
  DesktopPanesMessage,
  DesktopSessionTreeMessage,
  DesktopWorkdirStateMessage,
  DesktopTogglePanelMessage,
  DesktopPanelKind,
  DesktopAccountInfoMessage,
  ToolBlockUpdateCallbackParams,
  ConfigurationData,
  ConfirmationRequest,
  QueuedMessage,
} from "./types.js";

// Re-export the whole contract (message unions, payload shapes, SDK types) so
// consumers can type test helpers against the shared union without importing
// the deep path. `export *` (not a hand-maintained list) keeps this in sync
// when types.ts grows.
export * from "./types.js";

type Overrides<T> = Partial<T>;

export interface Fixtures {
  setInitialState: (
    overrides?: Overrides<SetInitialStateMessage>,
  ) => SetInitialStateMessage;
  authStatusResponse: (
    overrides?: Overrides<AuthStatusResponseMessage>,
  ) => AuthStatusResponseMessage;
  agentsContentResponse: (
    scope: "user" | "project",
    content: string,
    overrides?: Overrides<AgentsContentResponseMessage>,
  ) => AgentsContentResponseMessage;
  agentsContentSaved: (
    scope: "user" | "project",
    overrides?: Overrides<AgentsContentSavedMessage>,
  ) => AgentsContentSavedMessage;
  contextUsage: (
    percent: number,
    overrides?: Overrides<ContextUsageMessage>,
  ) => ContextUsageMessage;
  updateMessages: (
    messages: Message[],
    overrides?: Overrides<UpdateMessagesMessage>,
  ) => UpdateMessagesMessage;
  appendMessage: (
    message: Message,
    overrides?: Overrides<AppendMessageMessage>,
  ) => AppendMessageMessage;
  updatePermissionMode: (
    mode: PermissionMode,
    overrides?: Overrides<UpdatePermissionModeMessage>,
  ) => UpdatePermissionModeMessage;
  updateCurrentSession: (
    session: SessionMetadata,
    overrides?: Overrides<UpdateCurrentSessionMessage>,
  ) => UpdateCurrentSessionMessage;
  updateTasks: (
    tasks: Task[],
    overrides?: Overrides<UpdateTasksMessage>,
  ) => UpdateTasksMessage;
  updateToolBlock: (
    params: ToolBlockUpdateCallbackParams,
    overrides?: Overrides<UpdateToolBlockMessage>,
  ) => UpdateToolBlockMessage;
  updateErrorBlock: (
    error: unknown,
    overrides?: Overrides<UpdateErrorBlockMessage>,
  ) => UpdateErrorBlockMessage;
  updateWorkdir: (
    workdir: string | undefined,
    overrides?: Overrides<UpdateWorkdirMessage>,
  ) => UpdateWorkdirMessage;
  startStreaming: (
    overrides?: Overrides<StartStreamingMessage>,
  ) => StartStreamingMessage;
  endStreaming: (
    overrides?: Overrides<EndStreamingMessage>,
  ) => EndStreamingMessage;
  compactionStateChange: (
    isCompacting: boolean,
    overrides?: Overrides<CompactionStateChangeMessage>,
  ) => CompactionStateChangeMessage;
  compactionContentUpdate: (
    content: string,
    overrides?: Overrides<CompactionContentUpdateMessage>,
  ) => CompactionContentUpdateMessage;
  btwResponse: (
    question: string,
    answer: string,
    overrides?: Overrides<BtwResponseMessage>,
  ) => BtwResponseMessage;
  mcpServersResponse: (
    servers: unknown[],
    overrides?: Overrides<McpServersResponseMessage>,
  ) => McpServersResponseMessage;
  subagentConfigurationsResponse: (
    configurations: unknown[],
    overrides?: Overrides<SubagentConfigurationsResponseMessage>,
  ) => SubagentConfigurationsResponseMessage;
  skillMetadataResponse: (
    skills: unknown[],
    overrides?: Overrides<SkillMetadataResponseMessage>,
  ) => SkillMetadataResponseMessage;
  hooksResponse: (
    hooks: Record<string, unknown[]>,
    overrides?: Overrides<HooksResponseMessage>,
  ) => HooksResponseMessage;
  mcpConfigPathsResponse: (
    userPath: string | null,
    projectPath: string | null,
    overrides?: Overrides<McpConfigPathsResponseMessage>,
  ) => McpConfigPathsResponseMessage;
  desktopPanes: (
    overrides?: Overrides<DesktopPanesMessage>,
  ) => DesktopPanesMessage;
  desktopSessionTree: (
    overrides?: Overrides<DesktopSessionTreeMessage>,
  ) => DesktopSessionTreeMessage;
  desktopWorkdirState: (
    overrides?: Overrides<DesktopWorkdirStateMessage>,
  ) => DesktopWorkdirStateMessage;
  desktopTogglePanel: (
    kind: DesktopPanelKind,
    overrides?: Overrides<DesktopTogglePanelMessage>,
  ) => DesktopTogglePanelMessage;
  desktopAccountInfo: (
    overrides?: Overrides<DesktopAccountInfoMessage>,
  ) => DesktopAccountInfoMessage;
}

const noopSession = (): SessionMetadata => ({
  id: "test-session",
  sessionType: "main",
  workdir: "/tmp/test",
  lastActiveAt: new Date(),
  createdAt: new Date(),
  latestTotalTokens: 0,
});

export const fixtures: Fixtures = {
  setInitialState: (overrides = {}) => ({
    command: "setInitialState",
    messages: [],
    tasks: [],
    backgroundTasks: [],
    workflowRuns: [],
    isStreaming: false,
    isCommandRunning: false,
    isCompacting: false,
    isTaskListCollapsed: false,
    isRestoring: false,
    sessions: [],
    session: undefined,
    pendingConfirmations: [],
    queuedMessages: [],
    isAuthenticated: true,
    workdir: "/tmp/test",
    theme: { effective: "dark", source: "system" },
    inputContent: "",
    ...overrides,
  }),

  authStatusResponse: (overrides = {}) => ({
    command: "authStatusResponse",
    isAuthenticated: true,
    ...overrides,
  }),

  agentsContentResponse: (scope, content, overrides = {}) => ({
    command: "agentsContentResponse",
    scope,
    content,
    ...overrides,
  }),

  agentsContentSaved: (scope, overrides = {}) => ({
    command: "agentsContentSaved",
    scope,
    ok: true,
    ...overrides,
  }),

  contextUsage: (percent, overrides = {}) => ({
    command: "contextUsage",
    percent,
    ...overrides,
  }),

  updateMessages: (messages, overrides = {}) => ({
    command: "updateMessages",
    messages,
    ...overrides,
  }),

  appendMessage: (message, overrides = {}) => ({
    command: "appendMessage",
    message,
    ...overrides,
  }),

  updatePermissionMode: (mode, overrides = {}) => ({
    command: "updatePermissionMode",
    mode,
    ...overrides,
  }),

  updateCurrentSession: (session, overrides = {}) => ({
    command: "updateCurrentSession",
    session,
    ...overrides,
  }),

  updateTasks: (tasks, overrides = {}) => ({
    command: "updateTasks",
    tasks,
    ...overrides,
  }),

  updateToolBlock: (params, overrides = {}) => ({
    command: "updateToolBlock",
    params,
    ...overrides,
  }),

  updateErrorBlock: (error, overrides = {}) => ({
    command: "updateErrorBlock",
    error,
    ...overrides,
  }),

  updateWorkdir: (workdir, overrides = {}) => ({
    command: "updateWorkdir",
    workdir,
    ...overrides,
  }),

  startStreaming: (overrides = {}) => ({
    command: "startStreaming",
    ...overrides,
  }),

  endStreaming: (overrides = {}) => ({
    command: "endStreaming",
    ...overrides,
  }),

  compactionStateChange: (isCompacting, overrides = {}) => ({
    command: "compactionStateChange",
    isCompacting,
    ...overrides,
  }),

  compactionContentUpdate: (content, overrides = {}) => ({
    command: "compactionContentUpdate",
    content,
    ...overrides,
  }),

  btwResponse: (question, answer, overrides = {}) => ({
    command: "btwResponse",
    question,
    answer,
    ...overrides,
  }),

  mcpServersResponse: (servers, overrides = {}) => ({
    command: "mcpServersResponse",
    servers,
    ...overrides,
  }),

  subagentConfigurationsResponse: (configurations, overrides = {}) => ({
    command: "subagentConfigurationsResponse",
    configurations,
    ...overrides,
  }),

  skillMetadataResponse: (skills, overrides = {}) => ({
    command: "skillMetadataResponse",
    skills,
    ...overrides,
  }),

  hooksResponse: (hooks, overrides = {}) => ({
    command: "hooksResponse",
    hooks,
    ...overrides,
  }),
  mcpConfigPathsResponse: (userPath, projectPath, overrides = {}) => ({
    command: "mcpConfigPathsResponse",
    userPath,
    projectPath,
    ...overrides,
  }),

  desktopPanes: (overrides = {}) => ({
    command: "desktopPanes",
    panes: [],
    rowHeights: undefined,
    focusedPaneId: undefined,
    ...overrides,
  }),

  desktopSessionTree: (overrides = {}) => ({
    command: "desktopSessionTree",
    groups: [],
    ...overrides,
  }),

  desktopWorkdirState: (overrides = {}) => ({
    command: "desktopWorkdirState",
    workdir: undefined,
    host: "local",
    hosts: ["local"],
    recentWorkdirs: [],
    ...overrides,
  }),

  desktopTogglePanel: (kind, overrides = {}) => ({
    command: "desktopTogglePanel",
    kind,
    ...overrides,
  }),

  desktopAccountInfo: (overrides = {}) => ({
    command: "desktopAccountInfo",
    isAuthenticated: true,
    user: { id: "user-1", email: "alice@example.com" },
    plan: null,
    apiQuota: null,
    update: undefined,
    ...overrides,
  }),
};

/** Convenience helpers for the most-constructed nested values. */
export const fixtureSession = noopSession;
export const fixtureConfirmation = (
  overrides: Partial<ConfirmationRequest> = {},
): ConfirmationRequest => ({
  confirmationId: "confirm-1",
  toolName: "Bash",
  confirmationType: "bash",
  toolInput: { command: "ls" },
  ...overrides,
});
export const fixtureQueuedMessage = (
  content: string,
  overrides: Partial<QueuedMessage> = {},
): QueuedMessage => ({
  id: "queued-1",
  type: "message",
  content,
  ...overrides,
});
export const fixtureConfig = (
  overrides: Partial<ConfigurationData> = {},
): ConfigurationData => ({
  model: "glm-5.2",
  fastModel: "deepseek-v4-flash",
  language: "zh",
  ...overrides,
});

// Export all services
export * from "./core/session.js";
export * from "./services/authService.js";
export * from "./services/sessionConsumers.js";
export * from "./services/worktreeHooks.js";
// `/export`：读整份转录 + 导出用的派生量（统计、默认文件名）。渲染成文字归
// 宿主（CLI 用 Ink 组件渲染再剥 ANSI，与 Claude Code 同一条路）。
export {
  buildExportFilename,
  countTranscriptStats,
  describeTranscriptUnavailable,
  ensureTxtExtension,
  extractFirstPrompt,
  formatExportTimestamp,
  loadTranscriptForExport,
  sanitizeFilename,
  TranscriptUnavailableError,
} from "./services/transcriptExport.js";
export type {
  TranscriptExport,
  TranscriptExportStats,
  TranscriptUnavailableReason,
} from "./services/transcriptExport.js";
export {
  buildTranscriptManifest,
  exportTranscriptArchive,
  renderTranscriptMarkdown,
  TRANSCRIPT_EXPORT_MAX_JSONL_BYTES,
} from "./services/transcriptArchive.js";
export type {
  TranscriptArchiveOptions,
  TranscriptManifest,
  TranscriptManifestInput,
  TranscriptMarkdownMeta,
} from "./services/transcriptArchive.js";

// Export constants
export * from "./constants/telemetry.js";
export * from "./constants/tools.js";

// Export main agent
export * from "./agent.js";
export * from "./core/plugin.js";
export * from "./managers/cronManager.js";
export * from "./managers/messageQueue.js";

// Export all utilities
export * from "./utils/bashParser.js";
export * from "./utils/convertMessagesForAPI.js";
export * from "./utils/modelCapabilities.js";
export * from "./utils/fileSearch.js";
export * from "./utils/globalLogger.js";
export * from "./utils/mcpUtils.js";
export * from "./utils/messageOperations.js";
export * from "./utils/notificationXml.js";
export * from "./utils/path.js";
export * from "./utils/promptHistory.js";
export * from "./utils/rewindCheckpoints.js";
export * from "./utils/stringUtils.js";
export * from "./utils/customCommands.js";
export * from "./utils/errorUtils.js";
export * from "./utils/hookMatcher.js";
export * from "./utils/tokenCalculation.js";
export * from "./utils/gitUtils.js";
// `child_process` with `windowsHide: true` forced in — the only sanctioned way
// to run a child process. See the module for why it cannot be left to each call
// site.
export {
  execAsyncHidden,
  execFileAsyncHidden,
  execFileHidden,
  execFileSyncHidden,
  spawnHidden,
  spawnSyncHidden,
} from "./utils/execFileHidden.js";
export * from "./utils/nameGenerator.js";
export * from "./utils/pathEncoder.js";
export {
  MAX_RECENT_WORKDIRS,
  forgetRecentWorkdir,
  readRecentWorkdirs,
  rememberRecentWorkdir,
  recentWorkdirsPath,
} from "./utils/recentWorkdirs.js";
export { ensureRuntimeDeps } from "./utils/runtimeDeps.js";
export type { RuntimeDepsResult } from "./utils/runtimeDeps.js";
// Shrinking an image to fit a transport budget (the remote-control page's
// on-demand screenshot preview) — same ladder as the outbound rewrite, but with
// a caller-supplied byte budget. See `shrinkImageForTransport`.
export { shrinkImageForTransport } from "./utils/imageRewrite.js";
export type { TransportShrinkOutcome } from "./utils/imageRewrite.js";
// A clipboard image saved as BMP is readable but not sendable (the APIs take
// jpeg/png/gif/webp), so the Linux reader rewrites it — same as Claude Code,
// except that a missing codec keeps the BMP instead of failing the read.
export { transcodeBmpToPng } from "./utils/bmpTranscode.js";
export * from "./utils/worktreeSession.js";
export * from "./utils/worktreeRemoval.js";
export * from "./utils/worktreeUtils.js";
export {
  loadMergedWaveConfig,
  loadUserConfigEnv,
  loadWaveConfigFromFile,
} from "./services/configurationService.js";
export {
  REMOTE_CONTROL_DEFAULT_ENABLED,
  isRemoteControlEnabled,
} from "./services/remoteControlAvailability.js";
// 一次性宿主提示（spec enterprise/server-managed-config「私有化未授权时给出一次
// 性提示」，另有登录过期与设置文件解析失败）：来源各自去重，宿主只负责展示
// SDK 给的文案。CLI 的 hint 行与 stdio 转发各订阅一次。
export {
  onHostNotice,
  type HostNotice,
  type HostNoticeKind,
} from "./services/hostNotice.js";
export {
  getUserConfigPaths,
  getProjectConfigPaths,
} from "./utils/configPaths.js";
export {
  readUserPreferenceSettings,
  readUserPreferenceView,
  updateUserPreferenceSettings,
  userSettingsFilePath,
  contextLengthToContextWindow,
  contextWindowToContextLength,
  CONTEXT_WINDOW_ENV_KEY,
} from "./utils/userSettings.js";
export type {
  UserPreferenceSettings,
  UserPreferenceView,
} from "./utils/userSettings.js";
export * from "./types/index.js";

// Export subagent types (used by CLI /agents overlay)
export type { SubagentConfiguration } from "./utils/subagentParser.js";
export type { SubagentInstance } from "./managers/subagentManager.js";
// Plugin reload prompts, shared with the hosts that only display them. The
// reload result types (PluginLoadFailure / PluginReloadResult) come with the
// ./types/index.js re-export above.
export {
  PLUGIN_CHANGE_PENDING_MESSAGE,
  PLUGIN_RELOADED_MESSAGE,
} from "./constants/messages.js";

// Export tool building utilities
export * from "./tools/buildTool.js";
export type { ToolPlugin, ToolResult, ToolContext } from "./tools/types.js";

// Telemetry: stdout protection for structured-output hosts (--stdio / --print);
// console exporters are stripped there so they cannot corrupt the channel.
export { setTelemetryStdoutProtected } from "./telemetry/instrumentation.js";

// 创作集（Artifacts 画廊）：桌面端整页的账号级读写面（列表 / 分享 / 撤销 /
// 成员检索）。宿主不直连网络，经 stdio RPC 调这几个函数。
export {
  fetchArtifactGalleryList,
  fetchArtifactShareView,
  saveArtifactShare,
  revokeArtifact,
  searchArtifactMembers,
  ARTIFACT_SHARE_MODES,
} from "./services/artifactGallery.js";
export type {
  ArtifactGalleryRow,
  ArtifactShareView,
  ArtifactMember,
  ArtifactShareMode,
  ArtifactGalleryResult,
} from "./services/artifactGallery.js";

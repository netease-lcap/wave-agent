// Export all services
export * from "./core/session.js";
export * from "./services/authService.js";
export * from "./services/worktreeHooks.js";

// Export constants
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
export * from "./utils/stringUtils.js";
export * from "./utils/customCommands.js";
export * from "./utils/hookMatcher.js";
export * from "./utils/tokenCalculation.js";
export * from "./utils/gitUtils.js";
export * from "./utils/nameGenerator.js";
export * from "./utils/pathEncoder.js";
export { ensureRuntimeDeps } from "./utils/runtimeDeps.js";
export type { RuntimeDepsResult } from "./utils/runtimeDeps.js";
export * from "./utils/worktreeSession.js";
export * from "./utils/worktreeUtils.js";
export {
  loadMergedWaveConfig,
  loadUserConfigEnv,
  loadWaveConfigFromFile,
} from "./services/configurationService.js";
export {
  getUserConfigPaths,
  getProjectConfigPaths,
} from "./utils/configPaths.js";
export {
  readManagedSettings,
  readUserPreferenceSettings,
  readUserPreferenceView,
  updateUserPreferenceSettings,
  userSettingsFilePath,
  contextLengthToMaxInputTokens,
  maxInputTokensToContextLength,
  MAX_INPUT_TOKENS_ENV_KEY,
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

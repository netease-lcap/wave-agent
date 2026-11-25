import { WorktreeSession } from "./utils/worktree.js";
import { PermissionMode, McpServerConfig, SkillSource } from "wave-agent-sdk";

export interface BaseAppProps {
  bypassPermissions?: boolean;
  permissionMode?: PermissionMode;
  pluginDirs?: string[];
  /** Additional directories to add to the session Safe Zone (from --add-dir). */
  additionalDirectories?: string[];
  /**
   * 本次会话要加载的技能来源（--skills-sources）。值域只有 user / project 两档：
   * builtin 恒加载，plugin 由 --plugin-dir 控制（与 Claude Code 的边界一致）。
   * undefined = 全部来源；`[]` = 两档都关。
   */
  skillsSources?: SkillSource[];
  tools?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  worktreeSession?: WorktreeSession;
  workdir?: string;
  /** The working directory before entering a worktree (CLI -w); injected into the agent's container. */
  originalCwd?: string;
  version?: string;
  model?: string;
  /** Optional MCP server configs to pass to Agent.create() */
  mcpServers?: Record<string, McpServerConfig>;
  /**
   * Erases what ink has drawn without touching the terminal scrollback (ink's
   * `instance.clear()`, injected by the CLI entry where the ink instance lives).
   * Actions that must leave the previous conversation scrollable above — `/clear`
   * — use it instead of a hard erase.
   */
  onClearOutput?: () => void;
}

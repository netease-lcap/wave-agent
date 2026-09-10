/**
 * Application constants definition
 */

import path from "path";
import os from "os";

/**
 * Application data storage directory
 * Used to store debug logs, command history and other data
 */
export const DATA_DIRECTORY = path.join(os.homedir(), ".wave");

/**
 * Prompt history file path
 */
export const PROMPT_HISTORY_FILE = path.join(DATA_DIRECTORY, "history.jsonl");

/**
 * Error log directory path
 */
export const ERROR_LOG_DIRECTORY = path.join(DATA_DIRECTORY, "error-logs");

/**
 * User-level memory file path
 */
export const USER_MEMORY_FILE = path.join(DATA_DIRECTORY, "AGENTS.md");

/**
 * AI related constants
 */
export const DEFAULT_WAVE_MAX_INPUT_TOKENS = 200000; // Default token limit
export const DEFAULT_WAVE_MAX_OUTPUT_TOKENS = 32000; // Default output token limit (aligned with Claude Code)

/**
 * AI 回复语言的默认值（未设置 `language` 时生效）。
 *
 * 取值必须与设置页「AI 回复语言」下拉的默认项是同一个串（webview
 * `SettingsPage.tsx` 的 `zh-CN` / `en-US`），否则未设置时会出现「设置页显示中文、
 * 实际生效却不是中文」的分叉（spec core/agent-config.md 边界说明「语言默认值」：
 * 未设置时 **显示 ≡ 生效**）。该值原样注入系统提示的
 * `# Language\nAlways respond in <值>` 指令。
 */
export const DEFAULT_LANGUAGE = "zh-CN";

/**
 * Default server URL for SSO authentication.
 * Overridden by WAVE_SERVER_URL env var or programmatic AgentOptions.serverUrl.
 */
export const DEFAULT_SERVER_URL = "https://codechat.codewave.163.com";

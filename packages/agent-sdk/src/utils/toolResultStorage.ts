/**
 * Shared tool result persistence and truncation logic.
 *
 * When a tool result exceeds a size threshold, the full content is saved to a
 * file in /tmp/wave-tool-results/ and the model receives a <persisted-output>
 * preview with the file path so it can use the Read tool to access the full output.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  PREVIEW_SIZE_BYTES,
} from "../constants/toolLimits.js";
import { logger } from "./globalLogger.js";

const TOOL_RESULTS_DIR = path.join(os.tmpdir(), "wave-tool-results");

/**
 * Get (and create if needed) the tool-results directory.
 * Uses /tmp/wave-tool-results/ for simplicity and automatic OS cleanup.
 */
export function getToolResultsDir(): string {
  fs.mkdirSync(TOOL_RESULTS_DIR, { recursive: true });
  return TOOL_RESULTS_DIR;
}

/**
 * Persist full tool output to a file in the tool-results directory.
 * Returns the file path on success, or undefined on failure.
 */
export function persistToolResult(
  content: string,
  prefix: string = "tool",
): string | undefined {
  try {
    const dir = getToolResultsDir();
    const id = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const filePath = path.join(dir, `${id}.txt`);
    fs.writeFileSync(filePath, content, "utf8");
    return filePath;
  } catch (error) {
    logger?.error("Failed to persist tool result:", error);
    return undefined;
  }
}

/**
 * Generate a preview from content: first `previewSize` characters with ellipsis.
 */
export function generatePreview(
  content: string,
  previewSize: number = PREVIEW_SIZE_BYTES,
): string {
  if (content.length <= previewSize) return content;
  return content.substring(0, previewSize) + "\n...";
}

/**
 * Build the <persisted-output> wrapper message that the model sees.
 *
 * Example output:
 * <persisted-output>
 * Output too large (150,000 characters). Full output saved to: /tmp/wave-tool-results/mcp_server_tool_12345.txt
 * Preview (first 2,048 characters):
 * {preview content}
 * ...
 * </persisted-output>
 */
export function buildPersistedOutputMessage(
  totalChars: number,
  filePath: string,
  preview: string,
): string {
  return [
    "<persisted-output>",
    `Output too large (${totalChars.toLocaleString()} characters). Full output saved to: ${filePath}`,
    `Preview (first ${PREVIEW_SIZE_BYTES.toLocaleString()} characters):`,
    preview,
    "</persisted-output>",
  ].join("\n");
}

/**
 * Process tool result: if content exceeds maxChars, persist to file and return
 * truncated content with <persisted-output> wrapper. Otherwise return unchanged.
 *
 * This is the main entry point for both MCP and bash tools.
 *
 * @param content - The tool result content
 * @param maxChars - Maximum characters before persistence kicks in (defaults to DEFAULT_MAX_RESULT_SIZE_CHARS)
 * @param prefix - File name prefix for the persisted file (e.g. "bash", "mcp")
 * @returns The content to send to the model (either original or persisted-output wrapper)
 */
export function processToolResult(
  content: string,
  maxChars: number = DEFAULT_MAX_RESULT_SIZE_CHARS,
  prefix: string = "tool",
): string {
  if (content.length <= maxChars) {
    return content;
  }

  const filePath = persistToolResult(content, prefix);

  if (filePath) {
    const preview = generatePreview(content);
    return buildPersistedOutputMessage(content.length, filePath, preview);
  }

  // Fallback: truncation only (persistence failed)
  return (
    content.substring(0, maxChars) +
    "\n\n... (output truncated, failed to persist full output)"
  );
}

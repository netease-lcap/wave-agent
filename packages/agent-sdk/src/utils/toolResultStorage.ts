/**
 * Shared tool result persistence and truncation logic.
 *
 * When a tool result exceeds a size threshold, the full content is saved to a
 * file in /tmp/wave-tool-results/ and the model receives a <persisted-output>
 * preview with the file path so it can use the Read tool to access the full output.
 */

import * as fs from "fs";
import * as path from "path";
import {
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  PREVIEW_SIZE_BYTES,
} from "../constants/toolLimits.js";
import { logger } from "./globalLogger.js";
import { resolveTempDir } from "./tempDir.js";

const TOOL_RESULTS_DIR_NAME = "wave-tool-results";

/**
 * Get (and create if needed) the tool-results directory.
 * Lives under the agent's temp dir for simplicity and automatic OS cleanup.
 */
export function getToolResultsDir(): string {
  const dir = path.join(resolveTempDir(), TOOL_RESULTS_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
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
 * Persist raw bytes to a file in the tool-results directory. Binary results
 * (an image or a font pulled back from an artifact) cannot travel through the
 * text channel, so they land on disk for the Read tool instead.
 * Returns the file path on success, or undefined on failure.
 */
export function persistToolResultBuffer(
  content: Buffer,
  prefix: string = "tool",
  extension: string = "bin",
): string | undefined {
  try {
    const dir = getToolResultsDir();
    const id = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const safeExt = /^[a-z0-9]{1,12}$/.test(extension) ? extension : "bin";
    const filePath = path.join(dir, `${id}.${safeExt}`);
    fs.writeFileSync(filePath, content);
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
 * The parts of a `<persisted-output>` wrapper, read back.
 *
 * `processToolResult` is the only producer of that wrapper, so the reader lives
 * next to it: a caller that wants to hand on *where* the rest of the output went
 * (the REPL's `` $`cmd` `` does, as `file` / `truncated`) must not re-derive the
 * format by string surgery of its own.
 */
export interface PersistedToolOutput {
  /** Characters in the output the wrapper stands in for. */
  totalChars: number;
  /** The file holding all of it. */
  filePath: string;
  /** The preview the wrapper carries. */
  preview: string;
}

const PERSISTED_HEAD = "<persisted-output>";
const PERSISTED_TAIL = "</persisted-output>";

/**
 * Read back what `processToolResult` wrapped, or `undefined` when the content is
 * not a wrapper (i.e. the output fitted and nothing was persisted).
 */
export function parsePersistedOutput(
  content: string,
): PersistedToolOutput | undefined {
  if (
    !content.startsWith(PERSISTED_HEAD) ||
    !content.endsWith(PERSISTED_TAIL)
  ) {
    return undefined;
  }
  const body = content.slice(PERSISTED_HEAD.length + 1, -PERSISTED_TAIL.length);
  const headEnd = body.indexOf("\n");
  if (headEnd === -1) return undefined;
  const head = body.slice(0, headEnd);
  // The wrapper runs through `toLocaleString()`, so the digit grouping is
  // whatever the host locale uses (`,` here, but not everywhere): keep the
  // digits and drop the separators rather than assume a locale.
  const headMatch =
    /^Output too large \((.+?) characters\)\. Full output saved to: (.+)$/.exec(
      head,
    );
  if (!headMatch) return undefined;
  const totalChars = Number(headMatch[1].replace(/\D/g, ""));
  if (!Number.isFinite(totalChars)) return undefined;
  const rest = body.slice(headEnd + 1);
  const previewLineEnd = rest.indexOf("\n");
  if (previewLineEnd === -1) return undefined;
  // The wrapper is a `join("\n")`, so one newline before the closing tag belongs
  // to the wrapper, not to the preview it carries.
  const previewText = rest.slice(previewLineEnd + 1);
  return {
    totalChars,
    filePath: headMatch[2],
    preview: previewText.endsWith("\n")
      ? previewText.slice(0, -1)
      : previewText,
  };
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

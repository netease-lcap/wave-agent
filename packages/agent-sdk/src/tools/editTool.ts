import { readFile, stat } from "fs/promises";
import { createHash } from "crypto";
import { logger } from "../utils/globalLogger.js";
import { atomicWriteFile } from "../utils/atomicWrite.js";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { resolvePath, getDisplayPath } from "../utils/path.js";
import { escapeRegExp, analyzeEditMismatch } from "../utils/editUtils.js";
import { EDIT_TOOL_NAME, READ_TOOL_NAME } from "../constants/tools.js";

/**
 * Prepended to the result of an edit that applied to a file which changed on
 * disk after this session read it (`staleRecovered`). The edit itself was
 * clean, but everything else in the file may now differ from what the model
 * holds in context — wording follows Claude Code's note.
 */
const STALE_RECOVERED_NOTE =
  "Note: the file had been modified on disk since you last read it — the edit applied cleanly, but the file contains other changes not in your context. Read it before edits that depend on surrounding content.";

/**
 * Format compact parameter display
 */
function formatCompactParams(
  args: Record<string, unknown>,
  context: ToolContext,
): string {
  const filePath = args.file_path as string;
  return getDisplayPath(filePath || "", context.workdir);
}

/**
 * Single file edit tool plugin
 */
export const editTool: ToolPlugin = {
  name: EDIT_TOOL_NAME,
  searchHint: "replace exact strings in an existing file",
  isConcurrencySafe: false,
  formatCompactParams,
  prompt: () =>
    `Performs exact string replacements in files.

Usage:
- You must use your \`${READ_TOOL_NAME}\` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. 
- When editing text from ${READ_TOOL_NAME} tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- Use the smallest \`old_string\` that's clearly unique — usually 2-4 adjacent lines is sufficient. Avoid including 10+ lines of context when less uniquely identifies the target. Shorter matches are less likely to contain reproduction errors.
- The edit will FAIL if \`old_string\` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use \`replace_all\` to change every instance of \`old_string\`. 
- Use \`replace_all\` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.`,
  leanPrompt: `Performs exact string replacement in a file.

- You must ${READ_TOOL_NAME} the file in this conversation before editing, or the call will fail.
- \`old_string\` must match the file exactly, including indentation, and be unique — the edit fails otherwise. Strip the Read line prefix (spaces + line number + tab) before matching.
- \`replace_all: true\` replaces every occurrence instead.`,
  config: {
    type: "function",
    function: {
      name: EDIT_TOOL_NAME,
      description: "A tool for editing files",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "The absolute path to the file to modify",
          },
          old_string: {
            type: "string",
            description: "The text to replace",
          },
          new_string: {
            type: "string",
            description:
              "The text to replace it with (must be different from old_string)",
          },
          replace_all: {
            type: "boolean",
            default: false,
            description: "Replace all occurences of old_string (default false)",
          },
        },
        required: ["file_path", "old_string", "new_string"],
        additionalProperties: false,
      },
    },
  },
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const filePath = args.file_path as string;
    const oldString = args.old_string as string;
    const newString = args.new_string as string;
    const replaceAll = (args.replace_all as boolean) || false;

    // Validate required parameters
    if (!filePath || typeof filePath !== "string") {
      return {
        success: false,
        content: "",
        error: "file_path parameter is required and must be a string",
      };
    }

    if (typeof oldString !== "string") {
      return {
        success: false,
        content: "",
        error: "old_string parameter is required and must be a string",
      };
    }

    if (typeof newString !== "string") {
      return {
        success: false,
        content: "",
        error: "new_string parameter is required and must be a string",
      };
    }

    if (oldString === newString) {
      return {
        success: false,
        content: "",
        error: "old_string and new_string must be different",
      };
    }

    // Trigger conditional rule loading for this file
    context.messageManager?.triggerFileRead(filePath);

    const resolvedPath = resolvePath(filePath, context.workdir);

    try {
      // Read file content
      let originalContent: string;
      try {
        originalContent = await readFile(resolvedPath, "utf-8");
      } catch (readError) {
        return {
          success: false,
          content: "",
          error: `Failed to read file: ${readError instanceof Error ? readError.message : String(readError)}`,
        };
      }

      // Staleness check, only for a file this session actually read (an unread
      // file has no state to compare against, so it edits straight through —
      // see docs/specs/core/fs-tools.md "不要求先读取"). Aligned with Claude
      // Code: a stale read is no longer an automatic failure. The edit applies
      // against the content on disk either way, so when it still matches
      // cleanly we apply it and tell the model the file holds changes it has
      // not seen; only an edit that no longer matches is rejected. Full reads
      // keep the content-hash fallback, which avoids false positives when mtime
      // moved but the content did not (git checkout, editor round-trip save,
      // cloud sync, antivirus). Skipped in plan mode: permissionManager
      // enforces a plan-file-only gate whose denial message must surface first.
      let staleRecovered = false;
      if (context.permissionMode !== "plan" && context.readFileState) {
        const state = context.readFileState.get(resolvedPath);
        if (state) {
          const currentStats = await stat(resolvedPath);
          if (currentStats.mtime.getTime() > state.mtime) {
            const isFullRead =
              state.offset === undefined && state.limit === undefined;
            const contentUnchanged =
              isFullRead &&
              createHash("sha256").update(originalContent).digest("hex") ===
                state.hash;
            if (!contentUnchanged) {
              const normalizedCurrent = originalContent.replace(/\r\n/g, "\n");
              const normalizedCandidate = oldString.replace(/\r\n/g, "\n");
              const appliesCleanly = replaceAll
                ? normalizedCurrent.includes(normalizedCandidate)
                : normalizedCurrent.split(normalizedCandidate).length - 1 === 1;
              if (!appliesCleanly) {
                return {
                  success: false,
                  content: "",
                  error:
                    "File has been unexpectedly modified since last read. Read it again before editing it.",
                };
              }
              staleRecovered = true;
            }
          }
        }
      }

      // Normalize line endings for matching
      const normalizedContent = originalContent.replace(/\r\n/g, "\n");
      const normalizedOldString = oldString.replace(/\r\n/g, "\n");

      // Check if old_string exists
      const index = normalizedContent.indexOf(normalizedOldString);
      const matchedOldString = index !== -1 ? normalizedOldString : null;
      const startLineNumber =
        index !== -1
          ? normalizedContent.substring(0, index).split("\n").length
          : undefined;

      if (!matchedOldString) {
        return {
          success: false,
          content: "",
          error: analyzeEditMismatch(normalizedOldString),
        };
      }

      let newContent: string;
      let replacementCount: number;

      if (replaceAll) {
        // Replace all matches
        const regex = new RegExp(escapeRegExp(matchedOldString), "g");
        // Function replacer (claude-code's applyEditToFile approach): newString
        // is inserted literally, never parsed as a $ replacement template. A
        // string replacer would expand $& to the matched text, $$ to a single
        // $, and `$` could even truncate and duplicate the file (issue #1752).
        newContent = normalizedContent.replace(regex, () => newString);
        replacementCount = (normalizedContent.match(regex) || []).length;
      } else {
        // Replace only the first match, but first check if it's unique
        const matches = normalizedContent.split(matchedOldString).length - 1;
        if (matches > 1) {
          return {
            success: false,
            content: "",
            error: `old_string appears ${matches} times in the file. Either provide a larger string with more surrounding context to make it unique or use replace_all=true to change every instance.`,
          };
        }

        // Function replacer: see note above — $ in newString stays literal
        newContent = normalizedContent.replace(
          matchedOldString,
          () => newString,
        );
        replacementCount = 1;
      }

      // Permission check after validation but before real operation
      if (context.permissionManager) {
        try {
          const permissionContext = context.permissionManager.createContext(
            EDIT_TOOL_NAME,
            context.permissionMode || "default",
            context.canUseToolCallback,
            {
              file_path: filePath,
              old_string: oldString,
              new_string: newString,
              replace_all: replaceAll,
              startLineNumber,
            },
            context.toolCallId,
          );
          const permissionResult =
            await context.permissionManager.checkPermission(permissionContext);

          if (permissionResult.behavior === "deny") {
            return {
              success: false,
              content: "",
              error: `${EDIT_TOOL_NAME} operation denied by user, reason: ${permissionResult.message || "No reason provided"}`,
            };
          }
        } catch {
          return {
            success: false,
            content: "",
            error: "Permission check failed",
          };
        }
      }

      // Record snapshot for reversion
      let snapshotId: string | undefined;
      if (context.reversionManager && context.messageId) {
        snapshotId = await context.reversionManager.recordSnapshot(
          context.messageId,
          resolvedPath,
          "modify",
        );
      }

      // Write file (atomic: temp file + rename, so concurrent readers never
      // observe a truncated file). Staleness/OCC was checked above.
      try {
        await atomicWriteFile(resolvedPath, newContent);
        // Commit snapshot on success
        if (context.reversionManager && snapshotId) {
          await context.reversionManager.commitSnapshot(snapshotId);
        }
      } catch (writeError) {
        return {
          success: false,
          content: "",
          error: `Failed to write file: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
        };
      }

      // Update readFileState so subsequent serialized edits see fresh state
      if (context.readFileState) {
        const newStats = await stat(resolvedPath);
        const hash = createHash("sha256").update(newContent).digest("hex");
        context.readFileState.set(resolvedPath, {
          mtime: newStats.mtime.getTime(),
          hash,
          source: "edit",
          content: newContent,
          offset: undefined,
          limit: undefined,
        });
      }

      const shortResult = replaceAll
        ? `Replaced ${replacementCount} instances`
        : "Text replaced successfully";

      logger.debug(`Edit tool: ${shortResult}`);

      return {
        success: true,
        content: staleRecovered
          ? `${STALE_RECOVERED_NOTE}\n\n${shortResult}`
          : shortResult,
        shortResult,
        filePath: resolvedPath,
        startLineNumber,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Edit tool error: ${errorMessage}`);
      return {
        success: false,
        content: "",
        error: errorMessage,
      };
    }
  },
};

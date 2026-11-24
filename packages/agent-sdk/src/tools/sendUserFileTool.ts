import { isAbsolute } from "path";
import { stat } from "fs/promises";
import { resolvePath } from "../utils/path.js";
import {
  classifyDeliverablePath,
  fileNameOfPath,
} from "../constants/deliverableFiles.js";
import { SEND_USER_FILE_TOOL_NAME } from "../constants/tools.js";
import {
  renderSendUserFileResultData,
  type SendUserFileAttachmentData,
  type SendUserFileResultData,
} from "./resultData/sendUserFile.js";
import type { ToolContext, ToolPlugin, ToolResult } from "./types.js";

/**
 * `SendUserFile` — the "here is the finished thing" move.
 *
 * It reads nothing, uploads nothing and opens nothing: it validates that the
 * paths exist and hands the list to the message layer, which renders one
 * clickable path per file. Clicking is the only way anything opens.
 */
export const sendUserFileTool: ToolPlugin = {
  name: SEND_USER_FILE_TOOL_NAME,
  // Declared flat, not deferred: "deliver the finished thing" is a per-task
  // move, and hiding it behind a search round-trip costs a turn every time.
  searchHint:
    "deliver finished files (reports, screenshots, artifacts) to the user",
  config: {
    type: "function",
    function: {
      name: SEND_USER_FILE_TOOL_NAME,
      description:
        "Deliver files you just finished (a report, an image, a build artifact) to the user as clickable paths",
      parameters: {
        type: "object",
        properties: {
          files: {
            type: "array",
            items: { type: "string" },
            description:
              "File paths (absolute, or relative to the current working directory) to hand to the user. Always pass an array, even for a single file.",
          },
          caption: {
            type: "string",
            description: "Optional short caption shown next to the paths.",
          },
        },
        required: ["files"],
      },
    },
  },
  isConcurrencySafe: true,
  prompt: () => `
Deliver files to the user through this tool — do not just mention a path in your reply.

- Use it when you have just finished something the user wants to look at: a report, a diagram, a screenshot, a generated page, a build artifact.
- Do not use it for scratch files, intermediate output, or every save you make. One call at the end beats several along the way.
- \`files\` takes one or more paths (absolute, or relative to the current working directory); pass an array even for a single file.
- \`caption\` is one short line of context ("cost breakdown by service", "before / after the fix"). Skip it when the file names say enough.
- The tool only makes the paths clickable. It does not read, upload or open anything, and nothing opens until the user clicks.
- Relative paths are resolved against the current working directory, so run it from the directory you wrote the files in.
`,
  leanPrompt: `Deliver finished files to the user as clickable paths. \`files\` (array) + optional \`caption\`; use it for the finished artifact, not for scratch files.`,
  formatCompactParams: (params) => {
    const files = normalizeFiles(params.files);
    if (files.length === 0) return "";
    const first = fileNameOfPath(files[0]);
    return files.length === 1 ? first : `${first} +${files.length - 1}`;
  },
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const requested = normalizeFiles(args.files);
    if (requested.length === 0) {
      return {
        success: false,
        content: "",
        error:
          "files parameter is required: pass an array with at least one file path",
      };
    }

    const caption =
      typeof args.caption === "string" && args.caption.trim()
        ? args.caption.trim()
        : undefined;

    const delivered: SendUserFileAttachmentData[] = [];
    const seen = new Set<string>();
    const problems: string[] = [];

    for (const raw of requested) {
      const absolute = isAbsolute(raw)
        ? raw
        : resolvePath(raw, context.workdir);
      if (seen.has(absolute)) continue;
      seen.add(absolute);

      let stats;
      try {
        stats = await stat(absolute);
      } catch {
        problems.push(`${raw} (does not exist)`);
        continue;
      }
      if (!stats.isFile()) {
        problems.push(`${raw} (not a file)`);
        continue;
      }

      const kind = classifyDeliverablePath(absolute);
      delivered.push({
        path: absolute,
        size: stats.size,
        isImage: kind === "image",
        name: fileNameOfPath(absolute),
        kind,
      });
    }

    // All-or-nothing: a partial delivery would leave the user with half the
    // story and the model believing it succeeded. The model fixes the paths and
    // calls again.
    if (problems.length > 0) {
      return {
        success: false,
        content: "",
        error: `Nothing was delivered. Fix these and call again: ${problems.join(", ")}`,
      };
    }

    const data: SendUserFileResultData = {
      ...(caption ? { caption } : {}),
      attachments: delivered,
    };

    return {
      success: true,
      content: renderSendUserFileResultData(data),
      shortResult:
        delivered.length === 1
          ? delivered[0].name
          : `${delivered.length} files`,
      data,
    };
  },
};

/**
 * `files` accepts a bare string too: models sometimes send one path without the
 * array even though the schema says array (Claude Code's tool normalises the
 * same way).
 */
function normalizeFiles(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

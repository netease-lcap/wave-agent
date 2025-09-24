import { writeFile, readFile } from "fs/promises";
import { diffLines } from "diff";
import type { ToolPlugin, ToolResult, ToolContext } from "./types";
import { logger } from "../utils/logger";
import { applyEdit } from "../services/aiService";
import { removeCodeBlockWrappers } from "../utils/stringUtils";
import { resolvePath } from "../utils/path";

/**
 * 编辑文件工具插件
 */
export const editFileTool: ToolPlugin = {
  name: "edit_file",
  description:
    "Use this tool to propose an edit to an existing file or create a new file.",
  config: {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Use this tool to propose an edit to an existing file or create a new file.\n\nThis will be read by a less intelligent model, which will quickly apply the edit. You should make it clear what the edit is, while also minimizing the unchanged code you write.\nWhen writing the edit, you should specify each edit in sequence, with the special comment `// ... existing code ...` to represent unchanged code in between edited lines.\n\nFor example:\n\n```\n// ... existing code ...\nFIRST_EDIT\n// ... existing code ...\nSECOND_EDIT\n// ... existing code ...\nTHIRD_EDIT\n// ... existing code ...\n```\n\nYou should still bias towards repeating as few lines of the original file as possible to convey the change.\nBut, each edit should contain sufficient context of unchanged lines around the code you're editing to resolve ambiguity.\nDO NOT omit spans of pre-existing code (or comments) without using the `// ... existing code ...` comment to indicate its absence. If you omit the existing code comment, the model may inadvertently delete these lines.\nMake sure it is clear what the edit should be, and where it should be applied.\nTo create a new file, simply specify the content of the file in the `code_edit` field.\n\nYou should specify the following arguments before the others: [target_file]\n\nALWAYS make all edits to a file in a single edit_file instead of multiple edit_file calls to the same file. The apply model can handle many distinct edits at once. When editing multiple files, ALWAYS make parallel edit_file calls.",
      parameters: {
        type: "object",
        properties: {
          target_file: {
            type: "string",
            description:
              "The target file to modify. Always specify the target file as the first argument. You can use either a relative path in the workspace or an absolute path. If an absolute path is provided, it will be preserved as is.",
          },
          code_edit: {
            type: "string",
            description:
              "Specify ONLY the precise lines of code that you wish to edit. **NEVER specify or write out unchanged code**. Instead, represent all unchanged code using the comment of the language you're editing in - example: `// ... existing code ...`\n\n🚨 MANDATORY for existing files: You MUST use `// ... existing code ...` (or appropriate comment syntax) between your edits to preserve existing code. The ONLY exceptions are:\n- Creating a NEW file (doesn't exist yet)\n- Completely REWRITING an existing file (replacing ALL content)\n\nFor partial edits, omitting this will cause permanent code deletion!",
          },
        },
        required: ["target_file", "code_edit"],
      },
    },
  },
  execute: async (
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<ToolResult> => {
    const targetFile = args.target_file as string;
    const codeEdit = args.code_edit as string;

    if (!targetFile || typeof targetFile !== "string") {
      return {
        success: false,
        content: "",
        error: "target_file parameter is required and must be a string",
      };
    }

    if (!codeEdit || typeof codeEdit !== "string") {
      return {
        success: false,
        content: "",
        error: "code_edit parameter is required and must be a string",
      };
    }

    try {
      const filePath = resolvePath(targetFile, context?.workdir);

      // 检查文件是否存在
      let existingContent = "";
      try {
        existingContent = await readFile(filePath, "utf-8");
      } catch {
        // 文件不存在，创建新文件
        logger.info(`Creating new file: ${filePath}`);
      }

      // 检查是否包含 existing code 标记，判断是增量编辑还是直接替换
      const hasExistingCodeMarker = codeEdit.includes("... existing code ...");
      const isNewFile = existingContent.trim() === "";
      let editedContent: string;

      if (hasExistingCodeMarker) {
        // 包含 existing code 标记，调用AI服务应用增量编辑
        logger.info(`Applying incremental edit to file: ${filePath}`);
        const rawEditedContent = await applyEdit({
          targetFile: existingContent, // 传递现有文件内容作为上下文
          codeEdit,
        });
        editedContent = removeCodeBlockWrappers(rawEditedContent);
      } else {
        // 不包含 existing code 标记，直接使用编辑内容（创建新文件或重写现有文件）
        logger.info(
          `${isNewFile ? "Creating new file" : "Rewriting file"}: ${filePath}`,
        );
        editedContent = removeCodeBlockWrappers(codeEdit);
      }

      // 将编辑后的内容写入文件
      await writeFile(filePath, editedContent, "utf-8");

      // 生成 diff 信息
      const diffResult = diffLines(existingContent, editedContent);
      const addedLines = diffResult.filter((d) => d.added).length;
      const removedLines = diffResult.filter((d) => d.removed).length;
      const isRewrite = !hasExistingCodeMarker && !isNewFile;

      return {
        success: true,
        content: isNewFile
          ? `Created new file (${editedContent.split("\n").length} lines)`
          : isRewrite
            ? `Rewrote file (${editedContent.split("\n").length} lines)`
            : `Modified file (+${addedLines} -${removedLines} lines)`,
        originalContent: existingContent,
        newContent: editedContent,
        diffResult: diffResult,
        filePath: targetFile,
        shortResult: isNewFile
          ? `Created new file (${editedContent.split("\n").length} lines)`
          : isRewrite
            ? `Rewrote file (${editedContent.split("\n").length} lines)`
            : `Modified file (+${addedLines} -${removedLines} lines)`,
      };
    } catch (error) {
      return {
        success: false,
        content: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
  formatCompactParams: (params: Record<string, unknown>) => {
    const targetFile = params.target_file as string;
    return targetFile || "";
  },
};

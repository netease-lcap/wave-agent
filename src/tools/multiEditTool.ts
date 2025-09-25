import { readFile, writeFile } from "fs/promises";
import type { ToolPlugin, ToolResult, ToolContext } from "./types";
import { logger } from "../utils/logger";
import { resolvePath } from "../utils/path";
import { diffLines } from "diff";

interface EditOperation {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

/**
 * 多重编辑工具插件
 */
export const multiEditTool: ToolPlugin = {
  name: "multi_edit",
  description:
    "This is a tool for making multiple edits to a single file in one operation",
  config: {
    type: "function",
    function: {
      name: "multi_edit",
      description:
        "This is a tool for making multiple edits to a single file in one operation. It is built on top of the Edit tool and allows you to perform multiple find-and-replace operations efficiently. Prefer this tool over the Edit tool when you need to make multiple edits to the same file.\n\nBefore using this tool:\n\n1. Use the read_file tool to understand the file's contents and context\n2. Verify the directory path is correct\n\nTo make multiple file edits, provide the following:\n1. file_path: The absolute path to the file to modify (must be absolute, not relative)\n2. edits: An array of edit operations to perform, where each edit contains:\n   - old_string: The text to replace (must match the file contents exactly, including all whitespace and indentation)\n   - new_string: The edited text to replace the old_string\n   - replace_all: Replace all occurences of old_string. This parameter is optional and defaults to false.\n\nIMPORTANT:\n- All edits are applied in sequence, in the order they are provided\n- Each edit operates on the result of the previous edit\n- All edits must be valid for the operation to succeed - if any edit fails, none will be applied\n- This tool is ideal when you need to make several changes to different parts of the same file\n- For Jupyter notebooks (.ipynb files), use the NotebookEdit instead\n\nCRITICAL REQUIREMENTS:\n1. All edits follow the same requirements as the single Edit tool\n2. The edits are atomic - either all succeed or none are applied\n3. Plan your edits carefully to avoid conflicts between sequential operations\n\nWARNING:\n- The tool will fail if edits.old_string doesn't match the file contents exactly (including whitespace)\n- The tool will fail if edits.old_string and edits.new_string are the same\n- Since edits are applied in sequence, ensure that earlier edits don't affect the text that later edits are trying to find\n\nWhen making edits:\n- Ensure all edits result in idiomatic, correct code\n- Do not leave the code in a broken state\n- Always use absolute file paths (starting with /)\n- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.\n- Use replace_all for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.\n\nIf you want to create a new file, use:\n- A new file path, including dir name if needed\n- First edit: empty old_string and the new file's contents as new_string\n- Subsequent edits: normal edit operations on the created content",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "The absolute path to the file to modify",
          },
          edits: {
            type: "array",
            items: {
              type: "object",
              properties: {
                old_string: {
                  type: "string",
                  description: "The text to replace",
                },
                new_string: {
                  type: "string",
                  description: "The text to replace it with",
                },
                replace_all: {
                  type: "boolean",
                  default: false,
                  description:
                    "Replace all occurences of old_string (default false).",
                },
              },
              required: ["old_string", "new_string"],
              additionalProperties: false,
            },
            minItems: 1,
            description:
              "Array of edit operations to perform sequentially on the file",
          },
        },
        required: ["file_path", "edits"],
        additionalProperties: false,
      },
    },
  },
  execute: async (
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<ToolResult> => {
    const filePath = args.file_path as string;
    const edits = args.edits as EditOperation[];

    // 验证必需参数
    if (!filePath || typeof filePath !== "string") {
      return {
        success: false,
        content: "",
        error: "file_path parameter is required and must be a string",
      };
    }

    if (!Array.isArray(edits) || edits.length === 0) {
      return {
        success: false,
        content: "",
        error: "edits parameter is required and must be a non-empty array",
      };
    }

    // 验证每个编辑操作
    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      if (!edit || typeof edit !== "object") {
        return {
          success: false,
          content: "",
          error: `Edit operation ${i + 1} must be an object`,
        };
      }

      if (typeof edit.old_string !== "string") {
        return {
          success: false,
          content: "",
          error: `Edit operation ${i + 1}: old_string is required and must be a string`,
        };
      }

      if (typeof edit.new_string !== "string") {
        return {
          success: false,
          content: "",
          error: `Edit operation ${i + 1}: new_string is required and must be a string`,
        };
      }

      if (edit.old_string === edit.new_string) {
        return {
          success: false,
          content: "",
          error: `Edit operation ${i + 1}: old_string and new_string must be different`,
        };
      }
    }

    try {
      const resolvedPath = resolvePath(filePath, context?.workdir);

      // 读取文件内容
      let originalContent: string;
      let isNewFile = false;

      try {
        originalContent = await readFile(resolvedPath, "utf-8");
      } catch (readError) {
        // 检查是否是新文件创建的情况（第一个编辑的 old_string 为空）
        if (edits[0] && edits[0].old_string === "") {
          originalContent = "";
          isNewFile = true;
          logger.info(`Creating new file: ${resolvedPath}`);
        } else {
          return {
            success: false,
            content: "",
            error: `Failed to read file: ${readError instanceof Error ? readError.message : String(readError)}`,
          };
        }
      }

      let currentContent = originalContent;
      const appliedEdits: string[] = [];

      // 依次应用每个编辑操作
      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i];
        const replaceAll = edit.replace_all || false;

        // 特殊处理新文件创建的第一个编辑
        if (isNewFile && i === 0 && edit.old_string === "") {
          currentContent = edit.new_string;
          appliedEdits.push(
            `Created file with content (${edit.new_string.length} characters)`,
          );
          continue;
        }

        // 检查 old_string 是否存在
        if (!currentContent.includes(edit.old_string)) {
          return {
            success: false,
            content: "",
            error: `Edit operation ${i + 1}: old_string not found in current content: "${edit.old_string}"`,
          };
        }

        let replacementCount: number;

        if (replaceAll) {
          // 替换所有匹配项
          const regex = new RegExp(escapeRegExp(edit.old_string), "g");
          currentContent = currentContent.replace(regex, edit.new_string);
          replacementCount = (currentContent.match(regex) || []).length;
          appliedEdits.push(
            `Replaced ${replacementCount} instances of "${edit.old_string.substring(0, 50)}${edit.old_string.length > 50 ? "..." : ""}"`,
          );
        } else {
          // 只替换第一个匹配项，但首先检查是否唯一
          const matches = currentContent.split(edit.old_string).length - 1;
          if (matches > 1) {
            return {
              success: false,
              content: "",
              error: `Edit operation ${i + 1}: old_string appears ${matches} times in the current content. Either provide a larger string with more surrounding context to make it unique or use replace_all=true.`,
            };
          }

          currentContent = currentContent.replace(
            edit.old_string,
            edit.new_string,
          );
          appliedEdits.push(
            `Replaced "${edit.old_string.substring(0, 50)}${edit.old_string.length > 50 ? "..." : ""}"`,
          );
        }
      }

      // 写入文件
      try {
        await writeFile(resolvedPath, currentContent, "utf-8");
      } catch (writeError) {
        return {
          success: false,
          content: "",
          error: `Failed to write file: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
        };
      }

      // 生成 diff 信息
      const diffResult = diffLines(originalContent, currentContent);

      const shortResult = isNewFile
        ? `Created ${filePath} with ${edits.length} operations`
        : `Applied ${edits.length} edits to ${filePath}`;

      const detailedContent = `${shortResult}\n\nOperations performed:\n${appliedEdits.map((edit, i) => `${i + 1}. ${edit}`).join("\n")}`;

      logger.info(`MultiEdit tool: ${shortResult}`);

      return {
        success: true,
        content: detailedContent,
        shortResult,
        filePath: resolvedPath,
        originalContent,
        newContent: currentContent,
        diffResult,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`MultiEdit tool error: ${errorMessage}`);
      return {
        success: false,
        content: "",
        error: errorMessage,
      };
    }
  },
};

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

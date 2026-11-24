/**
 * `data` 落盘前的减重（issue #3055 阶段 2 · 双写）：照 CC 的 `stripForStorage`
 * 逐工具剥掉大块载荷，只留骨架。
 *
 * 为什么要有这一层：转录里的工具块现在**同时**写两份 —— `result`（模型当时读到的
 * 全文）与 `data`（结构化骨架）。正文那份已经由 `result` 承担，`data` 里再留一份
 * 就是纯冗余（一次 2000 行的 `Read` 会让转录涨一倍）。CC 的做法与此一致：它的
 * `ToolUseResult` 落盘时调每个工具的 `stripForStorage`，返回**新对象**、把大字段清
 * 空但保留形状（宿主卡片要的行数、退出码、mime 都在形状里）。
 *
 * 取证（`~/.cache/cc-reference/2.1.325-linux-x64/js/`）：
 *
 * - `0633-5758040B-b0.js:149204`（Read）：`text` 档清 `file.content`，`image` /
 *   `pdf` 档清 `file.base64`；
 * - `0633-5758040B-b0.js:225708`（Bash）：清 `stdout` / `stderr`；
 * - `0633-5758040B-b0.js:72850`（Edit）：清 `content` + `originalFile`；
 * - `0633-5758040B-b0.js:215638`（MultiEdit）：清 `originalFile`；
 * - `2019-52458B-AppifactReplTool.js:1903`（REPL）：只删 `seen`，正文保留；
 * - `2033-72684B-ProjectsTool.js:984`（Projects）：删 `images` 字段。
 *
 * 我方只需要三类，因为阶段 1 已经把其它大字段挡在 `data` 之外了：
 *
 * - `Read` 的 `type: "text"` → `file.content = ""`（`file.numLines` / `startLine` /
 *   `totalLines` / `filePath` 留着，宿主卡片「第 N–M 行 / 共 K 行」读它们）；
 * - `Read` 的 `type: "image"` → `file.base64 = ""`（`type` 是 mime、`dimensions`、
 *   `originalSize` 留着）；`pdf` / `binary` / 超 token 这几档本来没有大字段，原样
 *   返回；
 * - `Bash` / `PowerShell` → `stdout` / `stderr` 清成空串（两个 shell 工具的
 *   `data` 同源，见 `resultData/powershell.ts`；`exitCode`、后台任务三态、
 *   `tempDir`、`diskPressure`、`persistedOutputPath` 这些都留着）；
 * - 表外工具（MCP 及其它插件工具）按形状判：`content` 数组里的
 *   `{ type: "image", data: "<base64>", mimeType }` 项删掉 `data` 键。
 *
 * **`Edit` / `Write` / `MultiEdit` / `REPL` 不需要剥**：我方 `EditResultData`
 * （`edit.ts` 文件头）本来就没有 CC 的 `oldString` / `newString` / `originalFile` /
 * `structuredPatch`，正文只剩改动行数与路径；CC 的 REPL 也只删 `seen`、正文保留。
 *
 * 两条不变式：
 *
 * 1. **绝不修改入参**。每处都返回新对象（CC 也是 `return { ...e, file: { ...e.file,
 *    content: "" } }`）；不需要剥的时候**返回同一个引用**，调用方据此判断「没变」。
 * 2. **剥掉的只是落盘副本**。`ToolResult.data` 原件在执行期间照旧是完整的 ——
 *    模型侧 tool_result 文本、mod 事件的 `tool_response`、REPL 的动态返回都在
 *    strip 之前从原件取（`aiManager.executeToolCall`）；压缩恢复走 `result`
 *    —— 转录里的 `ToolBlock.result` 是全文，`data` 只是剥过的骨架。
 */
import {
  BASH_TOOL_NAME,
  POWERSHELL_TOOL_NAME,
  READ_TOOL_NAME,
} from "../../constants/tools.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `Read` 的 `data.file`：`text` 档清 `content`、`image` 档清 `base64`。
 * 已经是空串或本来就没这个键时返回原对象（形状没变，不白造一个）。
 */
function stripReadFile(
  file: Record<string, unknown>,
  key: "content" | "base64",
): Record<string, unknown> {
  if (typeof file[key] !== "string" || file[key] === "") return file;
  return { ...file, [key]: "" };
}

function stripRead(data: unknown): unknown {
  if (!isRecord(data) || !isRecord(data.file)) return data;
  const file = data.file;
  if (data.type !== "text" && data.type !== "image") return data;
  const key = data.type === "text" ? "content" : "base64";
  const stripped = stripReadFile(file, key);
  return stripped === file ? data : { ...data, file: stripped };
}

function stripBash(data: unknown): unknown {
  if (!isRecord(data)) return data;
  let stripped: Record<string, unknown> | undefined;
  for (const key of ["stdout", "stderr"] as const) {
    const value = data[key];
    if (typeof value === "string" && value !== "") {
      stripped ??= { ...data };
      stripped[key] = "";
    }
  }
  return stripped ?? data;
}

/** MCP 及其它表外工具的 `content` 块：图片块自带一段 base64，留类型就够了。 */
function isImageBlock(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) && value.type === "image" && typeof value.data === "string"
  );
}

function stripImageBlocks(data: unknown): unknown {
  if (!Array.isArray(data) || !data.some(isImageBlock)) return data;
  return data.map((item) => {
    if (!isImageBlock(item)) return item;
    const copy = { ...item };
    delete copy.data;
    return copy;
  });
}

/**
 * 落盘前给 `data` 减重。返回 `undefined` 当且仅当入参是 `undefined`；不需要剥的
 * 工具与形状**返回同一个引用**（调用方靠引用相等判断「没变」）。
 */
export function stripToolResultDataForStorage(
  toolName: string,
  data: unknown,
): unknown {
  if (data === undefined) return undefined;
  switch (toolName) {
    case READ_TOOL_NAME:
      return stripRead(data);
    case BASH_TOOL_NAME:
    case POWERSHELL_TOOL_NAME:
      return stripBash(data);
    default:
      return stripImageBlocks(data);
  }
}

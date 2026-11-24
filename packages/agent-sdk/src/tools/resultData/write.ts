/**
 * `Write` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与文本照 CC：`FileWriteTool.ts:68-88` 的 outputSchema、`:418-433` 的
 * `mapToolResultToToolResultBlockParam`。
 *
 * CC 的 outputSchema 还有三个大字段，我方一律不落盘：
 * `content`（模型自己传进来的正文）、`originalFile`（覆盖前的全文）、
 * `structuredPatch`（两者的 diff）。前两个回传等于落盘翻倍，第三个是同一份正文
 * 的第三种写法；渲染一个都不用，宿主要 diff 时按 `filePath` 现读现算。
 */
export interface WriteResultData {
  /** "create" = 新文件，"update" = 覆盖了已有文件。 */
  type: "create" | "update";
  /** 解析后的绝对路径，脚本可直接使用。 */
  filePath: string;
  /**
   * 这次写入加/删的行数（新文件是「删 0 行」）。正文不读它；宿主渲染 `+N −M` 与
   * `wave.lines.changed` 计数用它（原来是 `ToolResult.metadata.linesAdded` /
   * `linesRemoved`）。
   */
  linesAdded: number;
  linesRemoved: number;
}

export function renderWriteResultData(data: WriteResultData): string {
  return data.type === "create"
    ? `File created successfully at: ${data.filePath}`
    : `The file ${data.filePath} has been updated successfully.`;
}

/**
 * `Write` 的 `data` 形状（JSON Schema）。
 *
 * 用途只有一个：REPL 把工具签名渲染成真实返回类型（spec core/repl-tool.md「公告
 * 分档呈现」），模型据此直接写 `const r = await Write(...); r.filePath`，不用先
 * 探一次。与 {@link WriteResultData} 逐字段对应，改一处必须改另一处。
 */
export const writeOutputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["create", "update"],
      description:
        '"create" for a new file, "update" when an existing one was overwritten.',
    },
    filePath: {
      type: "string",
      description: "Resolved absolute path; usable as-is from a script.",
    },
    linesAdded: {
      type: "number",
      description:
        "Line count of what was written, so 0 for a no-op rewrite of identical content.",
    },
    linesRemoved: {
      type: "number",
      description:
        "Line count of the content this write replaced; 0 when the file did not exist.",
    },
  },
  required: ["type", "filePath", "linesAdded", "linesRemoved"],
  additionalProperties: false,
};

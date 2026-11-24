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

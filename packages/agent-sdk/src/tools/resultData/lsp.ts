/**
 * `LSP` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与文本照 CC：`LSPTool.ts:89-121` 的 outputSchema（`operation` / `result` /
 * `filePath` / `resultCount?` / `fileCount?`，五个全在）、`:415-421` 的
 * `mapToolResultToToolResultBlockParam`。要点：
 *
 * - CC 的 `data.result` 放的就是**已经渲染好的文本**（`:104`），渲染器只有一行
 *   `content: output.result`；九个 operation 的排版逻辑在 `formatters.ts:127-592`，
 *   吃的是 LSP 原始返回值（`Location` / `SymbolInformation` / `CallHierarchyItem`…），
 *   那份原始数据不在 outputSchema 里。想「从结构化条目重排一遍」就得先往 `data`
 *   里塞 CC 没有的字段（`locations` / `fromRanges`… 还是几百行），所以这里跟
 *   `webFetch` 同一口径：`result` 承载这次的模型侧文本，渲染器是它的直通。
 * - `resultCount` / `fileCount` 是给 UI 摘要用的计数（CC `UI.tsx` 的
 *   "Found N references across M files"），模型看不见；工具排版时一并算出，口径照
 *   CC 的 `formatResult`（`:636-829`）。
 * - `filePath` 是**调用方给的原始路径**，不是解析后的绝对路径：CC 回填的是入参
 *   （`:247` / `:386`），不是 `expandPath` 的结果。
 */

/** CC `LSPTool.ts:63-73` 的 operation 枚举，九个值，命名逐个对齐。 */
export type LspOperation =
  | "goToDefinition"
  | "findReferences"
  | "hover"
  | "documentSymbol"
  | "workspaceSymbol"
  | "goToImplementation"
  | "prepareCallHierarchy"
  | "incomingCalls"
  | "outgoingCalls";

export const LSP_OPERATIONS: readonly LspOperation[] = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
];

/** `data.operation` 是九值枚举：模型传进来的字符串要先过这道闸才能组 `data`。 */
export function isLspOperation(value: string): value is LspOperation {
  return (LSP_OPERATIONS as readonly string[]).includes(value);
}

export interface LspResultData {
  /** 这次调用的 operation（CC `:91-103`）。 */
  operation: LspOperation;
  /** 模型侧看到的全部文本——渲染器原样交出它（CC 的 `content: output.result`）。 */
  result: string;
  /** 调用方给的原始路径，不是绝对路径（CC `:105-107`）。 */
  filePath: string;
  /** 命中条数：定义 / 引用 / 符号…（CC `:108-113`）。 */
  resultCount?: number;
  /** 命中的不同文件数（CC `:114-119`）。 */
  fileCount?: number;
}

/** CC 的渲染器没有别的拼装：`mapToolResultToToolResultBlockParam` 返回 `result`。 */
export function renderLspResultData(data: LspResultData): string {
  return data.result;
}

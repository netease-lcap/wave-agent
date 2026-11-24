/**
 * `Grep` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与三个分支的文本都照 CC：`GrepTool.ts:144-154` 的 outputSchema、
 * `:254-309` 的 `mapToolResultToToolResultBlockParam`、`:132-142` 的
 * `formatLimitInfo`。要点：
 *
 * - `mode` 三分支各读各的字段：`content` 读 `content` / `numLines`，`count` 读
 *   `content` / `numMatches` / `numFiles`，`files_with_matches` 读 `filenames` /
 *   `numFiles`。CC 里另外两个模式的字段是空壳（`content` 模式 `numFiles: 0` +
 *   `filenames: []`，见 `:466-472`；`count` 模式 `filenames: []`，见 `:514-521`），
 *   这里照抄，不为了「看着顺眼」把它们填上，也不回填用不到的字段。
 * - `appliedLimit` 只在**真的截断了**才出现，`appliedOffset` 只在**真的跳过了行**
 *   才出现（CC 的 `applyHeadLimit` `:105-124`）：报一个没生效的上限会让模型以为
 *   还有下一页可以翻。
 * - `filenames` 是 workdir 之下的相对路径（CC 的 `toRelativePath`，省 token）。
 * - 一个都没匹配上不是错误：正文是 CC 的三句原话，见 `renderGrepResultData`。
 *
 * `content` 是匹配行/计数行本身——它是这个工具的主载荷（`Read` 的 `data` 同样带
 * 正文），不是「模型传进来的参数」或「文件全文」那种落盘翻倍的东西；没有它，
 * 渲染器无从重建正文。
 */

/**
 * 会话 cwd 被回收过（原目录被删）的那条通知，就是 `AIManager.consumeCwdRecovery()`
 * 的返回值（没有待处理的通知时是 `null`）。
 */
export type CwdRecovery = { from: string; to: string };

/** CC 的 `output_mode` 三档（`GrepTool.ts:146`）。 */
export type GrepOutputMode = "content" | "files_with_matches" | "count";

export interface GrepResultData {
  /** 产出的分支。CC 里可缺省，缺省按 `files_with_matches`（mapper 的默认参数）。 */
  mode?: GrepOutputMode;
  /**
   * 结果里的文件数。`count` 模式是计数行数（当前页），`content` 模式按 CC 恒为 0。
   */
  numFiles: number;
  /** `files_with_matches` 模式的文件列表；另外两个模式是空数组。 */
  filenames: string[];
  /** `content` 模式的匹配行、`count` 模式的 `路径:计数` 行；空结果时是空串。 */
  content?: string;
  /** `content` 模式的行数。 */
  numLines?: number;
  /**
   * 匹配数。两档含义分模式：
   * - `count` 模式：各文件计数之和（当前页，正文的 `Found N total occurrences` 用它）；
   * - `content` / `files_with_matches` 模式：分页前的匹配行/文件总数（正文不读它，短
   *   结果与宿主卡片用，原来是 `ToolResult.metadata.numMatches`）。
   */
  numMatches?: number;
  /**
   * 这一页被 `head_limit` 截短了。正文不读它（`appliedLimit` 已经进了分页提示）；
   * 宿主渲染结果卡片用（原来是 `ToolResult.metadata.truncated`）。
   */
  truncated?: boolean;
  /** 真的截断时才出现：这次生效的 `head_limit`。 */
  appliedLimit?: number;
  /** 真的跳过了行才出现：这次生效的 `offset`。 */
  appliedOffset?: number;
  /**
   * 我方扩展：会话 cwd 被自动回收过（原目录被删），这条提示必须出现在正文最前面，
   * 而正文现在由渲染器现场生成，所以只能跟着 `data` 走。CC 没有这条恢复路径
   * （它直接报错），故它的 outputSchema 里也没有对应字段。
   */
  cwdRecovery?: CwdRecovery;
}

/**
 * 我方扩展：一条结果都没有时，紧跟在那句「没有」之后的一句出口提示。
 *
 * CC 只有 `No matches found` / `No files found`，没有这句（见 `GrepTool.ts:269`、
 * `:299`）。我方 ripgrep 仍然尊重 .gitignore，模型不给 `path` 就容易搜不到
 * `node_modules` 之类的目录，这句是当初专门加的，不能丢；它可以从「结果为空」
 * 这一状态本身重建，所以不另占 `data` 字段。
 */
export const NO_RESULTS_HINT =
  "Suggestion: specify the 'path' field to search in ignored or other directories (e.g., 'node_modules'), as the default search path is the current working directory and respects .gitignore.";

/**
 * CC 的 `formatLimitInfo`（`GrepTool.ts:132-142`）：只有真的生效的项才出现，
 * 所以不会渲染出 `limit: undefined`。
 */
function formatLimitInfo(
  appliedLimit: number | undefined,
  appliedOffset: number | undefined,
): string {
  const parts: string[] = [];
  if (appliedLimit !== undefined) parts.push(`limit: ${appliedLimit}`);
  if (appliedOffset) parts.push(`offset: ${appliedOffset}`);
  return parts.join(", ");
}

/**
 * cwd 回收提示。正文与错误分支共用这份措辞，所以导出；没有回收时是空串。
 */
export function cwdRecoveryNote(
  recovery: CwdRecovery | null | undefined,
): string {
  return recovery
    ? `Note: working directory ${recovery.from} no longer exists; session working directory recovered to ${recovery.to}.\n`
    : "";
}

/**
 * 一句「没有」+ 我方那句出口提示。CC 那两句本身不带句号（`No matches found` /
 * `No files found`），拼回去时补一个，保持原来那句「No matches found. Suggestion:
 * …」的断句。
 */
function emptyBody(sentence: string): string {
  return `${sentence}. ${NO_RESULTS_HINT}`;
}

export function renderGrepResultData(data: GrepResultData): string {
  const mode = data.mode ?? "files_with_matches";
  const limitInfo = formatLimitInfo(data.appliedLimit, data.appliedOffset);

  let body: string;
  if (mode === "content") {
    // GrepTool.ts:267-278
    const resultContent = data.content || emptyBody("No matches found");
    body = limitInfo
      ? `${resultContent}\n\n[Showing results with pagination = ${limitInfo}]`
      : resultContent;
  } else if (mode === "count") {
    // GrepTool.ts:280-291：合计与正文之间空一行，正是 CC 那个 `\n\n`。
    const rawContent = data.content || emptyBody("No matches found");
    const matches = data.numMatches ?? 0;
    const files = data.numFiles ?? 0;
    const summary = `\n\nFound ${matches} total ${matches === 1 ? "occurrence" : "occurrences"} across ${files} ${files === 1 ? "file" : "files"}.${limitInfo ? ` with pagination = ${limitInfo}` : ""}`;
    body = rawContent + summary;
  } else if (data.numFiles === 0) {
    // GrepTool.ts:293-301
    body = emptyBody("No files found");
  } else {
    // GrepTool.ts:302-308：先一行 `Found N files`（分页信息跟在同一行），再是文件列表。
    const limitSuffix = limitInfo ? ` ${limitInfo}` : "";
    body = `Found ${data.numFiles} ${data.numFiles === 1 ? "file" : "files"}${limitSuffix}\n${data.filenames.join("\n")}`;
  }

  return cwdRecoveryNote(data.cwdRecovery) + body;
}

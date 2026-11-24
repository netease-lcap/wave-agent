/**
 * `Glob` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与文本都照 CC：`GlobTool.ts:39-52` 的 outputSchema、`:177-197` 的
 * `mapToolResultToToolResultBlockParam`。要点：
 *
 * - 字段名是 `filenames`，不是 `files`；`numFiles` 是**截断之后**实际给出的那批
 *   （CC 就取 `filenames.length`），不另记截断前的总数。
 * - 路径是 workdir 之下的相对路径（CC 的 `toRelativePath`，省 token），脚本要
 *   绝对路径时自己拼 workdir。
 * - 一个都没匹配上不是错误，正文就是 `No files found`。
 */

/**
 * Appended when the walk found more files than `limit`. Removing the cap would
 * flood the context with the whole tree, so the model is told to narrow instead;
 * wording matches Claude Code's Glob.
 */
export const TRUNCATED_NOTICE =
  "(Results are truncated. Consider using a more specific path or pattern.)";

export interface GlobResultData {
  /** 这次搜索花了多久；CC 用它渲染 "Found 3 files in 12ms" 那行 chrome。 */
  durationMs: number;
  /** `filenames.length`，与 CC 一致（截断后的数量，不是匹配总数）。 */
  numFiles: number;
  /** workdir 之下的相对路径。 */
  filenames: string[];
  /** 匹配到的比上限多，`filenames` 只是前一批。 */
  truncated: boolean;
}

export function renderGlobResultData(data: GlobResultData): string {
  if (data.filenames.length === 0) {
    return "No files found";
  }
  return data.truncated
    ? `${data.filenames.join("\n")}\n${TRUNCATED_NOTICE}`
    : data.filenames.join("\n");
}

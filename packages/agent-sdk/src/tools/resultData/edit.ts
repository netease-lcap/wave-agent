/**
 * `Edit` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与文本照 CC：`FileEditTool/types.ts:63-80` 的 outputSchema、
 * `FileEditTool.ts:575-594` 的 `mapToolResultToToolResultBlockParam`。
 *
 * CC 的 outputSchema 还有四个大字段，我方一律不落盘：`oldString` / `newString`
 * （模型自己传的参数，回传等于落盘翻倍）、`originalFile`、`structuredPatch`。
 * 渲染一个都不用。
 */

/**
 * Prepended to the result of an edit that applied to a file which changed on
 * disk after this session read it (`staleRecovered`). The edit itself was
 * clean, but everything else in the file may now differ from what the model
 * holds in context — wording follows Claude Code's note.
 */
export const STALE_RECOVERED_NOTE =
  "Note: the file had been modified on disk since you last read it — the edit applied cleanly, but the file contains other changes not in your context. Read it before edits that depend on surrounding content.";

export interface EditResultData {
  /** 解析后的绝对路径，脚本可直接使用。 */
  filePath: string;
  /** 用户在宿主的提案卡上改写后再接受。与 CC 同名字段，我方恒为 false。 */
  userModified: boolean;
  /** 是否走了 replace_all。 */
  replaceAll: boolean;
  /**
   * 我方扩展：文件在会话读过之后被外部改过，但这次编辑仍然干净地套上了。CC 没有
   * 这条恢复路径（它直接抛 `FILE_UNEXPECTEDLY_MODIFIED_ERROR`），而这段提示是给
   * 模型看的正文，必须能从 `data` 重建出来，所以只能留在 `data` 里。
   */
  staleRecovered: boolean;
  /**
   * 这次编辑加/删的行数。正文不读它；宿主渲染 `+N −M` 与 `wave.lines.changed`
   * 计数用它（原来是 `ToolResult.metadata.linesAdded` / `linesRemoved`）。
   */
  linesAdded: number;
  linesRemoved: number;
}

export function renderEditResultData(data: EditResultData): string {
  const modifiedNote = data.userModified
    ? ".  The user modified your proposed changes before accepting them. "
    : "";
  const body = data.replaceAll
    ? `The file ${data.filePath} has been updated${modifiedNote}. All occurrences were successfully replaced.`
    : `The file ${data.filePath} has been updated successfully${modifiedNote}.`;

  return data.staleRecovered ? `${STALE_RECOVERED_NOTE}\n\n${body}` : body;
}

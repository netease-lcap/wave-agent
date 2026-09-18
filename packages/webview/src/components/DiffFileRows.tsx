import React, { useMemo } from "react";
import { renderWordLevelDiff } from "../utils/diffHighlight";
import { parseHunks, type DiffRow, type DiffRowSide } from "../utils/diffHunks";
import type { WorkspaceDiffFile } from "./DiffPane";

export type DiffViewMode = "unified" | "split";

export interface DiffLineCommentTarget {
  /** Raw hunk line index (also the id of the row's comment button). */
  index: number;
  prefix: string;
  text: string;
}

export interface DiffFileRowsProps {
  file: WorkspaceDiffFile;
  viewMode: DiffViewMode;
  /** False above the per-file threshold: line-level colors only, no pair pairing. */
  wordHighlight: boolean;
  /** Raw line index whose inline comment box is open, or null. */
  commentIndex: number | null;
  onComment: (target: DiffLineCommentTarget) => void;
  /** The inline comment box, rendered under the row it belongs to. */
  renderCommentBox: (index: number) => React.ReactNode;
}

/**
 * One file's hunks. Both views read the same parsed rows, so switching views
 * moves lines around without ever re-pairing them (the word-level highlights
 * would drift apart otherwise) and without a new request to the host.
 */
export const DiffFileRows: React.FC<DiffFileRowsProps> = ({
  file,
  viewMode,
  wordHighlight,
  commentIndex,
  onComment,
  renderCommentBox,
}) => {
  const rows = useMemo(() => parseHunks(file.hunks), [file.hunks]);

  const commentButton = (
    side: DiffRowSide,
    prefix: string,
    sideName: string,
  ) => (
    <button
      className="diff-line-comment-btn"
      title="评论这行"
      aria-label={
        side.line === null
          ? `评论 ${file.path}`
          : `评论 ${file.path} 第 ${side.line} 行${sideName}`
      }
      data-testid={`diff-comment-add-${side.index}`}
      onClick={() =>
        onComment({ index: side.index, prefix, text: side.text.slice(0, 30) })
      }
    >
      <i className="codicon codicon-add" />
    </button>
  );

  /**
   * Content for both sides of a row. A pair is split ONCE here and the two
   * halves are distributed to the sides — that is what keeps the unified and
   * the side-by-side views showing identical highlights.
   */
  const contents = (
    row: DiffRow,
  ): { old?: React.ReactNode; next?: React.ReactNode } => {
    if (!wordHighlight || row.kind === "context")
      return { old: row.old?.text, next: row.new?.text };
    if (row.kind === "pair") {
      const { removedParts, addedParts } = renderWordLevelDiff(
        row.old!.text,
        row.new!.text,
        `pair-${row.old!.index}`,
      );
      return { old: removedParts, next: addedParts };
    }
    if (row.kind === "removed")
      return {
        old: renderWordLevelDiff(row.old!.text, "", `removed-${row.old!.index}`)
          .removedParts,
      };
    return {
      next: renderWordLevelDiff("", row.new!.text, `added-${row.new!.index}`)
        .addedParts,
    };
  };

  const renderUnifiedRow = (row: DiffRow): React.ReactNode => {
    if (row.kind === "hunk")
      return (
        <div className="diff-line-hunk" key={row.key}>
          {row.header}
        </div>
      );
    if (row.kind === "no-newline")
      return (
        <div className="diff-line-ellipsis" key={row.key}>
          {row.marker}
        </div>
      );

    const parts = contents(row);
    const line = (
      side: DiffRowSide,
      prefix: string,
      cls: string,
      content: React.ReactNode,
      sideName: string,
    ) => (
      <>
        <div className={cls}>
          <span className="diff-line-number">{side.line ?? ""}</span>
          <span className="diff-prefix">{prefix}</span>
          <span className="diff-content">{content}</span>
          {commentButton(side, prefix, sideName)}
        </div>
        {commentIndex === side.index && renderCommentBox(side.index)}
      </>
    );

    if (row.kind === "context")
      return (
        <React.Fragment key={row.key}>
          {line(row.new!, " ", "diff-line diff-line-context", parts.next, "")}
        </React.Fragment>
      );
    if (row.kind === "removed")
      return (
        <React.Fragment key={row.key}>
          {line(
            row.old!,
            "-",
            "diff-line diff-line-removed",
            parts.old,
            "（旧）",
          )}
        </React.Fragment>
      );
    if (row.kind === "added")
      return (
        <React.Fragment key={row.key}>
          {line(
            row.new!,
            "+",
            "diff-line diff-line-added",
            parts.next,
            "（新）",
          )}
        </React.Fragment>
      );
    return (
      <React.Fragment key={row.key}>
        {line(
          row.old!,
          "-",
          "diff-line diff-line-removed",
          parts.old,
          "（旧）",
        )}
        {line(row.new!, "+", "diff-line diff-line-added", parts.next, "（新）")}
      </React.Fragment>
    );
  };

  const renderSplitRow = (row: DiffRow): React.ReactNode => {
    if (row.kind === "hunk")
      return (
        <div className="diff-line-hunk" key={row.key}>
          {row.header}
        </div>
      );
    if (row.kind === "no-newline")
      return (
        <div className="diff-line-ellipsis" key={row.key}>
          {row.marker}
        </div>
      );

    const parts = contents(row);
    const cell = (
      side: DiffRowSide | undefined,
      prefix: string,
      cls: string,
      content: React.ReactNode,
      sideName: string,
    ) =>
      side ? (
        <div className={cls}>
          <span className="diff-line-number">{side.line ?? ""}</span>
          <span className="diff-prefix">{prefix}</span>
          <span className="diff-content">{content}</span>
          {commentButton(side, prefix, sideName)}
        </div>
      ) : (
        // The missing half of an unpaired line: no content and no add/remove
        // tint, so an empty cell is never read as a change of its own.
        <div className="diff-split-empty" />
      );

    const open =
      commentIndex === row.old?.index
        ? row.old!.index
        : commentIndex === row.new?.index
          ? row.new!.index
          : null;

    return (
      <div className="diff-split-row" key={row.key}>
        {cell(row.old, "-", "diff-line diff-line-removed", parts.old, "（旧）")}
        {cell(row.new, "+", "diff-line diff-line-added", parts.next, "（新）")}
        {open !== null && renderCommentBox(open)}
      </div>
    );
  };

  const renderRow = viewMode === "split" ? renderSplitRow : renderUnifiedRow;
  return <>{rows.map(renderRow)}</>;
};

export default DiffFileRows;

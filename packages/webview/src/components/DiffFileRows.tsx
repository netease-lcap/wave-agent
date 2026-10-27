import React, { useMemo } from "react";
import { commentLocationLabel } from "../utils/codeComment";
import { renderWordLevelDiff } from "../utils/diffHighlight";
import { parseHunks, type DiffRow, type DiffRowSide } from "../utils/diffHunks";
import {
  useCodeCommentEntry,
  type CodeCommentEntryState,
} from "../utils/useCodeCommentEntry";
import type { CommentUnitRange } from "../utils/commentUnits";
import { CodeCommentEntry } from "./CodeCommentEntry";
import type { WorkspaceDiffFile } from "./DiffPane";

export type DiffViewMode = "unified" | "split";

export interface DiffLineCommentTarget {
  /** Raw hunk line index range the comment is anchored to (from ≤ to). */
  from: number;
  to: number;
  prefix: string;
  text: string;
}

export interface DiffFileRowsProps {
  file: WorkspaceDiffFile;
  viewMode: DiffViewMode;
  /** False above the per-file threshold: line-level colors only, no pair pairing. */
  wordHighlight: boolean;
  /** Raw line range whose inline comment box is open, or null. */
  commentRange: CommentUnitRange | null;
  onComment: (target: DiffLineCommentTarget) => void;
  /** The inline comment box, rendered under the row it belongs to. */
  renderCommentBox: (index: number) => React.ReactNode;
}

/**
 * One file's hunks. Both views read the same parsed rows, so switching views
 * moves lines around without ever re-pairing them (the word-level highlights
 * would drift apart otherwise) and without a new request to the host.
 *
 * Comments are entered the way the file pane does it — right click on a line, or
 * select several and use the button that follows the selection (spec「差异面板
 * 行评论」场景 1/2). Every line carries `data-comment-unit` (its raw hunk index),
 * which is all the shared entry hook needs to resolve a target; the row itself
 * contributes the text and the `+`/`-` prefix the appended markdown quotes.
 */
export const DiffFileRows: React.FC<DiffFileRowsProps> = ({
  file,
  viewMode,
  wordHighlight,
  commentRange,
  onComment,
  renderCommentBox,
}) => {
  const rows = useMemo(() => parseHunks(file.hunks), [file.hunks]);

  /** Prefix + text + line number behind every commentable raw line. */
  const units = useMemo(() => {
    const map = new Map<
      number,
      { prefix: string; text: string; line: number | null }
    >();
    for (const row of rows) {
      // A context row has one raw line shared by both sides (`old.index` and
      // `new.index` are the same number); pairs have two distinct ones.
      if (row.old)
        map.set(row.old.index, {
          prefix: row.kind === "context" ? " " : "-",
          text: row.old.text,
          line: row.old.line,
        });
      if (row.new)
        map.set(row.new.index, {
          prefix: row.kind === "context" ? " " : "+",
          text: row.new.text,
          line: row.new.line,
        });
    }
    return map;
  }, [rows]);

  const entry: CodeCommentEntryState = useCodeCommentEntry({ enabled: true });

  const openComment = (range: CommentUnitRange) => {
    const texts: string[] = [];
    for (let index = range.from; index <= range.to; index++) {
      const unit = units.get(index);
      // Hunk headers and "no newline" markers are not units, so a range that
      // spans them simply skips them in the quote.
      if (unit) texts.push(unit.text);
    }
    onComment({
      from: range.from,
      to: range.to,
      prefix: units.get(range.from)?.prefix ?? " ",
      // No trim: the line's own indentation is part of what it says.
      text: texts.join(" "),
    });
  };

  const labelOf = (range: CommentUnitRange) => {
    const from = units.get(range.from)?.line;
    const to = units.get(range.to)?.line;
    if (from === undefined || from === null) return "评论这行改动";
    return `评论${commentLocationLabel(from, to ?? from)}`;
  };

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
    ) => (
      <>
        <div
          className={cls}
          data-comment-unit={side.index}
          data-testid={`diff-line-${side.index}`}
        >
          <span className="diff-line-number">{side.line ?? ""}</span>
          <span className="diff-prefix">{prefix}</span>
          <span className="diff-content">{content}</span>
        </div>
        {commentRange?.to === side.index && renderCommentBox(side.index)}
      </>
    );

    if (row.kind === "context")
      return (
        <React.Fragment key={row.key}>
          {line(row.new!, " ", "diff-line diff-line-context", parts.next)}
        </React.Fragment>
      );
    if (row.kind === "removed")
      return (
        <React.Fragment key={row.key}>
          {line(row.old!, "-", "diff-line diff-line-removed", parts.old)}
        </React.Fragment>
      );
    if (row.kind === "added")
      return (
        <React.Fragment key={row.key}>
          {line(row.new!, "+", "diff-line diff-line-added", parts.next)}
        </React.Fragment>
      );
    return (
      <React.Fragment key={row.key}>
        {line(row.old!, "-", "diff-line diff-line-removed", parts.old)}
        {line(row.new!, "+", "diff-line diff-line-added", parts.next)}
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
    ) =>
      side ? (
        <div
          className={cls}
          data-comment-unit={side.index}
          data-testid={`diff-line-${side.index}`}
        >
          <span className="diff-line-number">{side.line ?? ""}</span>
          <span className="diff-prefix">{prefix}</span>
          <span className="diff-content">{content}</span>
        </div>
      ) : (
        // The missing half of an unpaired line: no content and no add/remove
        // tint, so an empty cell is never read as a change of its own.
        <div className="diff-split-empty" />
      );

    const open =
      commentRange === null
        ? null
        : commentRange.to === row.old?.index
          ? row.old!.index
          : commentRange.to === row.new?.index
            ? row.new!.index
            : null;

    return (
      <div className="diff-split-row" key={row.key}>
        {cell(row.old, "-", "diff-line diff-line-removed", parts.old)}
        {cell(row.new, "+", "diff-line diff-line-added", parts.next)}
        {open !== null && renderCommentBox(open)}
      </div>
    );
  };

  const renderRow = viewMode === "split" ? renderSplitRow : renderUnifiedRow;
  return (
    <div
      className="diff-rows"
      ref={entry.containerRef}
      {...entry.containerProps}
    >
      {rows.map(renderRow)}
      <CodeCommentEntry
        chip={entry.chip}
        menu={entry.menu}
        menuRef={entry.menuRef}
        labelOf={labelOf}
        onOpen={openComment}
        onCloseMenu={entry.closeMenu}
      />
    </div>
  );
};

export default DiffFileRows;

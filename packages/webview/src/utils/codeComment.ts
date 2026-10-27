/**
 * A line comment written from one of the code views (the diff pane or the file
 * pane), plus the markdown it turns into when appended to the chat input.
 *
 * Both panes share this format on purpose: whoever reads the input box — the
 * user before sending, and the agent after — must not have to care which panel
 * a comment came from. Only the location part differs: the diff pane knows the
 * hunk line's `+`/`-` prefix, the file pane knows the commented line range (a
 * plain file has no second side to compare against).
 */
export interface CodeComment {
  /** File the commented line belongs to. */
  path?: string;
  /** Diff pane: the hunk line's prefix (`+` / `-` / a space for context). */
  prefix?: string;
  /** First commented line (1-based). Absent for markdown block comments. */
  from?: number;
  /** Last commented line; equal to `from` for a single-line comment. */
  to?: number;
  /** The commented text (a range contributes several lines); clipped below. */
  text?: string;
  /** What the user wrote. */
  comment?: string;
}

/** Longest source-line quote kept in the appended markdown. */
export const COMMENT_TEXT_LIMIT = 30;

/**
 * Location part of a comment: `第 12 行`, `第 12–15 行` (an en dash, matching
 * the spec's wording) or nothing when the comment has no line (markdown block).
 */
export function commentLocationLabel(from?: number, to?: number): string {
  if (from === undefined) return "";
  return to !== undefined && to !== from
    ? `第 ${from}\u2013${to} 行`
    : `第 ${from} 行`;
}

/** User-visible markdown for a line comment — appended to the chat input. */
export function formatCodeComment(msg: CodeComment): string {
  const prefixLabel =
    msg.prefix && msg.prefix !== " " ? `\`${msg.prefix}\`` : "";
  const lineLabel = commentLocationLabel(msg.from, msg.to);
  const quote = msg.text ? `「${msg.text.slice(0, COMMENT_TEXT_LIMIT)}」` : "";
  const location = [prefixLabel, lineLabel, quote].filter(Boolean).join("");
  return [
    `**代码评论** · ${msg.path ?? ""}`,
    location,
    "",
    msg.comment ?? "",
  ].join("\n");
}

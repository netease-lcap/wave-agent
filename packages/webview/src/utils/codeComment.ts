/**
 * A line comment written from one of the code views (the diff pane or the file
 * pane), plus the markdown it turns into when appended to the chat input.
 *
 * Both panes share this format on purpose: whoever reads the input box — the
 * user before sending, and the agent after — must not have to care which panel
 * a comment came from. Only the location part differs: the diff pane knows the
 * hunk line's `+`/`-` prefix, the file pane knows the line number (a plain file
 * has no second side to compare against).
 */
export interface CodeComment {
  /** File the commented line belongs to. */
  path?: string;
  /** Diff pane: the hunk line's prefix (`+` / `-` / a space for context). */
  prefix?: string;
  /** File pane: 1-based line number of the commented line. */
  line?: number;
  /** The commented line's text; clipped here so the quote stays readable. */
  text?: string;
  /** What the user wrote. */
  comment?: string;
}

/** Longest source-line quote kept in the appended markdown. */
export const COMMENT_TEXT_LIMIT = 30;

/** User-visible markdown for a line comment — appended to the chat input. */
export function formatCodeComment(msg: CodeComment): string {
  const prefixLabel =
    msg.prefix && msg.prefix !== " " ? `\`${msg.prefix}\`` : "";
  const lineLabel = msg.line !== undefined ? `第 ${msg.line} 行` : "";
  const quote = msg.text ? `「${msg.text.slice(0, COMMENT_TEXT_LIMIT)}」` : "";
  const location = [prefixLabel, lineLabel, quote].filter(Boolean).join("");
  return [
    `**代码评论** · ${msg.path ?? ""}`,
    location,
    "",
    msg.comment ?? "",
  ].join("\n");
}

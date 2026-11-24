/**
 * Error text for a script that did not run to the end, in the two shapes a
 * model can act on:
 *
 * - `describeSyntaxError` — a parse failure: where it is, the line it sits on,
 *   the guarantee that nothing ran, and a note about the traps that make a
 *   script fail to parse for a reason the parser's own message cannot name.
 * - `runtimeErrorHint` — one note hung under a runtime failure, for when the
 *   same trap reached the other end.
 *
 * Both note tables are keyed on the *source text* rather than on the error,
 * because one mistake surfaces as many different messages ("Unexpected token",
 * "Unterminated string constant", `TypeError: "…" is not a function`, …).
 * Claude Code ships exactly these in its REPL error path (2.1.325: the
 * `e.includes("`")` / `e.includes("'''")` pair in its parse aggregate, and
 * `vPi`'s `/^TypeError: ".*" is not a function/s` + `r.includes("``")`),
 * and each costs one `includes`.
 *
 * Nothing here repairs the script: a failure stays a failure, and no statement's
 * intent is guessed.
 */

/**
 * The line Claude Code states before the details (2.1.331: the first line of its
 * `ReplParseError` message). A model that only sees a position can act as if the
 * statements above it ran; this says the whole script was rejected instead.
 */
const NOT_RUN_NOTE =
  "The script did not run: it failed to parse, so nothing in it was executed.";

const TEMPLATE_LITERAL_NOTE =
  "Hint: a template literal ends at the next backtick and `${` starts an interpolation, so text that contains either (a shell ${VAR}, RST ``code``, a Python f-string) is safer in a '…' or \"…\" string, or read from a file.";

const TRIPLE_QUOTE_NOTE =
  'Hint: JavaScript has no triple-quoted strings: use a template literal, or join lines with "\\n".';

const TAGGED_STRING_NOTE =
  "Hint: two backticks in a row end one template literal and tag the next, so a string gets called. Text that contains backticks or `${` is safer in a '…' or \"…\" string, or read from a file.";

/** Claude Code's pattern for an empty template literal calling the next one as a tag. */
const TAGGED_STRING_CALL = /^TypeError: ".*" is not a function/s;

export function describeSyntaxError(error: unknown, code: string): string {
  const record = error as {
    message?: unknown;
    loc?: { line: number; column: number } | null;
  } | null;
  const message =
    record && typeof record.message === "string"
      ? record.message
      : String(error);
  // acorn appends " (line:column)" to messages whose own text already ends in
  // parentheses, and the position is rendered below anyway.
  const cleaned = message.replace(/\s*\(\d+:\d+\)$/, "");
  const loc = record?.loc;
  if (!loc) return `Script syntax error: ${cleaned}\n${NOT_RUN_NOTE}`;
  const parts = [
    `Script syntax error: ${cleaned} at line ${loc.line}, column ${loc.column + 1}`,
  ];
  const lineText = code.split("\n")[loc.line - 1];
  if (typeof lineText === "string" && lineText.trim() !== "") {
    parts.push(`    ${lineText.slice(0, 200)}`);
  }
  parts.push(NOT_RUN_NOTE);
  if (code.includes("`")) parts.push(TEMPLATE_LITERAL_NOTE);
  if (code.includes("'''") || code.includes('"""')) {
    parts.push(TRIPLE_QUOTE_NOTE);
  }
  return parts.join("\n");
}

/**
 * A note to hang under a runtime failure, or "" when the source holds none of
 * the shapes the note table knows. The caller owns the placement.
 */
export function runtimeErrorHint(message: string, code: string): string {
  if (TAGGED_STRING_CALL.test(message) && code.includes("``")) {
    return `\n${TAGGED_STRING_NOTE}`;
  }
  return "";
}

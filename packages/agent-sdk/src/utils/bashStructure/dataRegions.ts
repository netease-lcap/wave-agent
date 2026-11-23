/**
 * Data regions in a bash command line: heredoc bodies, here-string words and
 * comments.
 *
 * A command line can carry text whose whole job is to be data — the commit
 * message of `git commit -F - <<'MSG' … MSG`, a `cat <<'EOF' … EOF` document,
 * a remark after `#`. None of it is a command, so a removal word inside it
 * ("rm -rf /" in a commit message) says nothing about what the line does.
 * Cutting these regions out before the command stream is parsed is what lets a
 * judgement be built from command nodes only, instead of scanning raw text.
 *
 * Data is only data when it cannot execute:
 *
 *   <<'EOF'  <<\\EOF   the delimiter is quoted, so the body is literal text
 *   <<EOF             the body is expanded — `$(rm -rf …)` inside it really runs
 *   <<-EOF            the same, with leading tabs stripped from body lines
 *   <<<word           a here-string: the word is expanded and fed on stdin
 *
 * So a body or word is dropped only when nothing in it can run; otherwise the
 * region is left in place and an error is recorded, which keeps a removal word
 * inside it visible to the caller's own text check. `dataRegions` counts what
 * was dropped; the caller decides what an error means.
 *
 * Region shapes follow bash, not a regular expression: a heredoc body starts on
 * the line after the operator and ends at the *first* line that is exactly the
 * delimiter (leading tabs stripped for `<<-`). Matching the first such line is
 * what stops a body from swallowing the commands that follow it.
 */

/** A region of the source that is data rather than a command. */
interface Cut {
  start: number;
  end: number;
}

export interface DataRegionScan {
  /** The command line with every data region cut out. Newlines are kept, so
   *  line structure (and the command lines around a heredoc) survives. */
  text: string;
  /** How many regions were data and were cut out. */
  regions: number;
  /** How many of those were heredoc bodies or here-string words. */
  heredocs: number;
  /** The bodies of the heredocs that were established as data, in source
   *  order, closing delimiter lines excluded. Who reads them decides what they
   *  mean: a shell makes them its script, a file consumer makes them data. */
  bodies: string[];
  /** Data-shaped input that could not be established as data. */
  errors: string[];
}

/** Word terminators: shell metacharacters and whitespace. */
const WORD_STOP = /[ \t\n;&|<>()]/;
/** Comment starts at the beginning of a word — after whitespace or an operator. */
const WORD_BREAK_BEFORE = /[ \t\n;&|()<>]/;
/** A body or word that can execute: a command substitution or a backtick. */
const EXECUTES = /[\s\S]*(?:\$\(|`)/;

interface Word {
  start: number;
  end: number;
  /** The word with its quotes and escapes resolved. */
  value: string;
  /** true when any part of the word was quoted or escaped. */
  quoted: boolean;
}

interface PendingHeredoc {
  delimiter: string;
  /** `<<-`: leading tabs are stripped before a line is compared. */
  stripTabs: boolean;
  /** Where `<<` + delimiter sits, so it can be cut once the body is known to be data. */
  operatorStart: number;
  operatorEnd: number;
  /** A quoted delimiter makes the body literal text whatever it contains. */
  quoted: boolean;
}

/**
 * Split a command line into its data regions and the command text left over.
 *
 * Never throws and never decides: every uncertainty is reported in `errors`
 * and the corresponding text stays in `text`.
 */
export function extractDataRegions(command: string): DataRegionScan {
  const length = command.length;
  const cuts: Cut[] = [];
  const errors: string[] = [];
  const bodies: string[] = [];
  let heredocs = 0;
  let pending: PendingHeredoc[] = [];
  let at = 0;

  const cut = (start: number, end: number): void => {
    if (end > start) cuts.push({ start, end });
  };

  const done = (): DataRegionScan => ({
    text: applyCuts(command, cuts),
    regions: cuts.length,
    heredocs,
    bodies,
    errors,
  });

  /**
   * Read the bodies of the heredocs opened on the previous line, in the order
   * their operators appeared. Returns where scanning resumes.
   */
  const readBodies = (from: number): number => {
    let cursor = from;
    const opened = pending;
    pending = [];
    for (const heredoc of opened) {
      const body = findBody(
        command,
        cursor,
        heredoc.delimiter,
        heredoc.stripTabs,
      );
      if (body === null) {
        errors.push(`heredoc \`${heredoc.delimiter}\` is never closed`);
        return length;
      }
      if (
        !heredoc.quoted &&
        EXECUTES.test(command.slice(body.start, body.end))
      ) {
        // The body is expanded: what looks like a remark here can run a command.
        errors.push(`heredoc \`${heredoc.delimiter}\` is expanded`);
      } else {
        cut(heredoc.operatorStart, heredoc.operatorEnd);
        cut(body.start, body.end);
        bodies.push(bodyText(command, body.start, body.contentEnd));
        heredocs++;
      }
      cursor = body.next;
    }
    return cursor;
  };

  while (at < length) {
    const char = command[at]!;

    if (char === "\n") {
      at++;
      if (pending.length > 0) at = readBodies(at);
      continue;
    }

    if (char === "'" || char === '"') {
      const end = skipQuoted(command, at);
      // An unterminated quote is a syntax error the lexer reports; there is no
      // confident way to place data after it, so scanning stops here.
      if (end === -1) return done();
      at = end;
      continue;
    }

    if (char === "\\") {
      at += 2;
      continue;
    }

    if (
      char === "#" &&
      (at === 0 || WORD_BREAK_BEFORE.test(command[at - 1]!))
    ) {
      const newline = command.indexOf("\n", at);
      const stop = newline === -1 ? length : newline;
      cut(at, stop);
      at = stop;
      continue;
    }

    if (char === "<" && command[at + 1] === "<") {
      if (command[at + 2] === "<") {
        const word = readWord(command, at + 3);
        if (word === null) {
          errors.push("here-string without a word");
          return done();
        }
        if (wordExpands(command, word)) {
          errors.push("here-string is expanded");
        } else {
          cut(at, word.end);
          bodies.push(word.value);
          heredocs++;
        }
        at = word.end;
        continue;
      }
      const stripTabs = command[at + 2] === "-";
      const word = readWord(command, at + (stripTabs ? 3 : 2));
      if (word === null) {
        errors.push("heredoc without a delimiter");
        return done();
      }
      pending.push({
        delimiter: word.value,
        stripTabs,
        operatorStart: at,
        operatorEnd: word.end,
        quoted: word.quoted,
      });
      at = word.end;
      continue;
    }

    at++;
  }

  if (pending.length > 0) {
    errors.push(`heredoc \`${pending[0]!.delimiter}\` is never closed`);
  }
  return done();
}

/**
 * Where a heredoc body starts (after the operator line) and ends.
 *
 * `start`/`end` delimit the text to cut: the body lines and the closing
 * delimiter, with the newline after the delimiter left alone so the lines that
 * follow stay on their own line. `next` is where scanning resumes.
 */
function findBody(
  command: string,
  from: number,
  delimiter: string,
  stripTabs: boolean,
): { start: number; end: number; next: number; contentEnd: number } | null {
  const length = command.length;
  let lineStart = from;
  while (lineStart <= length) {
    const newline = command.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? length : newline;
    const raw = command.slice(lineStart, lineEnd);
    const line = stripTabs ? raw.replace(/^\t+/, "") : raw;
    const indent = raw.length - line.length;

    if (line === delimiter) {
      return {
        start: from,
        end: lineEnd,
        next: lineEnd + 1,
        contentEnd: lineStart,
      };
    }
    // `DELIM)` — bash closes a heredoc and a `$(…)` on the same token, so the
    // closing paren stays in the command text where the substitution needs it.
    if (
      line.startsWith(delimiter) &&
      /^[ \t]*\)/.test(line.slice(delimiter.length))
    ) {
      return {
        start: from,
        end: lineStart + indent + delimiter.length,
        next: lineEnd + 1,
        contentEnd: lineStart,
      };
    }
    if (newline === -1) return null;
    lineStart = newline + 1;
  }
  return null;
}

/**
 * The body text between [from] and [contentEnd]: no closing delimiter line,
 * and for a quoted heredoc exactly the bytes bash hands its reader.
 */
function bodyText(command: string, from: number, contentEnd: number): string {
  return command.slice(from, contentEnd).replace(/\n$/, "");
}

/** Read one word (a heredoc delimiter or a here-string operand). */
function readWord(command: string, from: number): Word | null {
  const length = command.length;
  let at = from;
  while (at < length && (command[at] === " " || command[at] === "\t")) at++;
  if (at >= length || WORD_STOP.test(command[at]!)) return null;

  const start = at;
  let value = "";
  let quoted = false;
  while (at < length) {
    const char = command[at]!;
    if (WORD_STOP.test(char)) break;
    if (char === "'" || char === '"') {
      const end = command.indexOf(char, at + 1);
      if (end === -1) return null;
      value += command.slice(at + 1, end);
      quoted = true;
      at = end + 1;
      continue;
    }
    if (char === "\\") {
      value += command[at + 1] ?? "";
      quoted = true;
      at += 2;
      continue;
    }
    value += char;
    at++;
  }
  if (at === start || value === "") return null;
  return { start, end: at, value, quoted };
}

/** Whether a here-string word can run something (single quotes make it literal). */
function wordExpands(command: string, word: Word): boolean {
  const raw = command.slice(word.start, word.end);
  let at = 0;
  while (at < raw.length) {
    const char = raw[at]!;
    if (char === "'") {
      const end = raw.indexOf("'", at + 1);
      at = end === -1 ? raw.length : end + 1;
      continue;
    }
    if (char === "\\") {
      at += 2;
      continue;
    }
    if (char === "`" || (char === "$" && raw[at + 1] === "(")) return true;
    at++;
  }
  return false;
}

/** Index just past the closing quote of the quote opened at `at`, or -1. */
function skipQuoted(command: string, at: number): number {
  const quote = command[at]!;
  let cursor = at + 1;
  while (cursor < command.length) {
    const char = command[cursor]!;
    if (char === "\\" && quote === '"') {
      cursor += 2;
      continue;
    }
    if (char === quote) return cursor + 1;
    cursor++;
  }
  return -1;
}

/** The command text with every cut removed, in one pass. */
function applyCuts(command: string, cuts: Cut[]): string {
  if (cuts.length === 0) return command;
  const ordered = [...cuts].sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  for (const cut of ordered) {
    if (cut.start < at) continue;
    out += command.slice(at, cut.start);
    at = cut.end;
  }
  return out + command.slice(at);
}

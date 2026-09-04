/**
 * Tokenizer for the structure-aware bash parser.
 *
 * Unlike `bashParser.ts`'s text-based heuristics, this tokenizer understands
 * bash quoting so that structural tokens (;, &&, ||, |, &, ( ), do/done/fi…)
 * are only recognized OUTSIDE quotes/substitutions, and words keep enough
 * internal structure for the semantic layer to tell quoted `"$f"` from bare
 * `$f`.
 *
 * Words are tokenized into parts:
 *   - lit        literal text (single-quoted or plain)
 *   - var        `$name` / `${name}` expansion (name kept raw, unexpanded)
 *   - special    `$@` `$*` `$?` `$$` `$!` `$#` `$-` `$0`..`$9`
 *   - cmdsub     `$(...)` or backtick command substitution (text = inner)
 *   - arith      `$((...))` — unsupported (dynamic), fail closed
 *   - brace      `{a,b}` brace expansion — unsupported (dynamic)
 *   - process    `<(cmd)` / `>(cmd)` process substitution — unsupported
 * Each part records whether it appeared inside double quotes (`q: 'double'`)
 * or bare (`q: 'none'`); single-quoted text is fully literal.
 *
 * The tokenizer FAILS (returns null) on any construct it cannot safely delimit
 * (unterminated quotes / $( / backticks / heredocs). Failures are surfaced by
 * the caller as a fail-closed `unsupported` parse result.
 */

export type QuoteCtx = "none" | "single" | "double";

export type WordPart =
  | { t: "lit"; v: string; q: QuoteCtx }
  | { t: "var"; name: string; q: "none" | "double" }
  | { t: "special"; name: string; q: "none" | "double" }
  | { t: "cmdsub"; text: string; q: "none" | "double" }
  | { t: "arith"; q: "none" | "double" }
  | { t: "brace"; v: string; q: "none" | "double" }
  | { t: "process"; text: string; q: "none" | "double" };

export interface WordToken {
  t: "word";
  /** Raw word text as written (quotes and $ references preserved). */
  raw: string;
  /** Inner structure for the semantic layer. */
  parts: WordPart[];
}

export type OpToken =
  | "&&"
  | "||"
  | "|"
  | "|&"
  | ";"
  | ";;"
  | ";&"
  | ";;&"
  | "&"
  | "("
  | ")"
  | "newline"
  | "{"
  | "}";

export interface OpTok {
  t: "op";
  op: OpToken;
}

export interface NlTok {
  t: "nl";
}

export type Token = WordToken | OpTok | NlTok | { t: "eof" };

/** Raw tokenizer failure: a construct we cannot model → ask (fail closed). */
export type LexFailureReason =
  | "heredoc"
  | "unterminated"
  | "unexpected-char"
  | "length-limit";

const LENGTH_LIMIT = 10_000;

/** Control operator punctuation (2-char forms first). */
const OP_2CHAR = ["&&", "||", "|&", ";;", ";&", ";;&"] as const;
const OP_1CHAR = new Set(["&", "|", ";", "(", ")", "\n"]);

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;

export function isVariableNameStart(ch: string): boolean {
  return NAME_START.test(ch);
}

/**
 * Classify a redirection operator word emitted by the tokenizer.
 * Returns "plain" when the operator still needs a separate following target
 * word (`>`, `2>`, `>>`, `&>`, `>&` …), "folded" when the target is already
 * part of the operator token (`2>&1`, `>&-`), or null when the word is not a
 * redirection operator.
 *
 * The raw word may carry an optional file-descriptor digit prefix (`2>`) and
 * the dup operators `<&`/`>&` may fold their fd/- target when it directly
 * touches the operator (`2>&1` must stay one token so the reconstructed text
 * remains faithful — legacy `2>& 1` text checks would mis-read the target).
 */
export function redirectOpKind(raw: string): "plain" | "folded" | null {
  const m = raw.match(/^(\d*)(&>>|&>|<<<|<<-|<<|<>|>>|<&|>&|>|<)(\d*|-)?$/);
  if (!m) return null;
  const op = m[2];
  const tail = m[3] ?? "";
  if (op === "<&" || op === ">&") {
    // Folded dup has its fd/- target inside the token; a bare `>&`/`<&` (the
    // target was spaced apart) still needs a following word.
    return tail === "" ? "plain" : "folded";
  }
  // digits/- tail is only legal on dup operators
  if (tail !== "") return null;
  return "plain";
}

/** True when the raw text is a redirection operator (fd prefix allowed). */
export function isRedirectRaw(raw: string): boolean {
  return redirectOpKind(raw) !== null;
}

/** Whether a word token is a redirection operator (raw literal, no quoting). */
export function isRedirectWord(w: WordToken): boolean {
  const p = w.parts[0];
  // Quoted `">"` / `'2>&1'` are ordinary arguments, not operators.
  if (w.parts.length !== 1 || p?.t !== "lit" || p.q !== "none") return false;
  return isRedirectRaw(w.raw);
}

/**
 * Tokenize a bash command string. Returns tokens or null on a lexical
 * construct we deliberately do not support (fail closed).
 */
export function tokenize(input: string): Token[] | null {
  if (input.length > LENGTH_LIMIT) return null;
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;

  const peek = (off = 0): string => input[i + off] ?? "";
  const eof = (): boolean => i >= n;

  /** Skip whitespace (not newlines — those are structural separators). */
  const skipWs = (): void => {
    while (!eof() && /[ \t\r]/.test(peek())) i++;
  };

  /** Skip a `#` comment to end of line (only when # starts a word). */
  const skipComment = (): void => {
    while (!eof() && peek() !== "\n") i++;
  };

  /**
   * Read the body of a `$(...)` substitution whose opening '(' is at
   * `openParenAt`. Balances nested $(), parens inside quotes are ignored.
   * Returns inner text (exclusive of outer parens) or null if unterminated.
   */
  const readDollarParen = (openParenAt: number): string | null => {
    let depth = 1;
    let start = openParenAt + 1;
    let j = openParenAt + 1;
    while (j < n) {
      const c = input[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "'") {
        // single quotes: everything literal until next '
        const close = input.indexOf("'", j + 1);
        if (close === -1) return null;
        j = close + 1;
        continue;
      }
      if (c === '"') {
        // double quotes may nest $( ) but a ) inside quotes doesn't close us
        const inner = readQuotedDouble(j);
        if (inner === null) return null;
        j = inner + 1;
        continue;
      }
      if (c === "`") {
        const end = readBacktick(j);
        if (end === -1) return null;
        j = end + 1;
        continue;
      }
      if (c === "$" && input[j + 1] === "(" && input[j + 2] !== "(") {
        depth++;
        j += 2;
        continue;
      }
      if (c === "(") {
        // subshell parens inside $() — count them too so a lone ) inside a
        // subshell doesn't terminate us: $( (echo a); echo b )
        depth++;
        j++;
        continue;
      }
      if (c === ")") {
        depth--;
        if (depth === 0) return input.slice(start, j);
        j++;
        continue;
      }
      j++;
    }
    return null;
  };

  /** Read content of a double-quoted string starting at the opening ".
   *  Returns index just past the closing ", or null if unterminated. */
  const readQuotedDouble = (at: number): number | null => {
    let j = at + 1;
    while (j < n) {
      const c = input[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === '"') return j;
      if (c === "$" && input[j + 1] === "(" && input[j + 2] !== "(") {
        const inner = readDollarParenFrom(j + 1);
        if (inner === null) return null;
        j = inner;
        continue;
      }
      if (c === "`") {
        const end = readBacktick(j);
        if (end === -1) return null;
        j = end + 1;
        continue;
      }
      j++;
    }
    return null;
  };

  /** Variant of readDollarParen used when scanning inside a double-quote:
   *  returns index just past the matching ')' of the $() starting at `at`. */
  const readDollarParenFrom = (openParenAt: number): number | null => {
    let depth = 1;
    let j = openParenAt + 1;
    while (j < n) {
      const c = input[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "'") {
        const close = input.indexOf("'", j + 1);
        if (close === -1) return null;
        j = close + 1;
        continue;
      }
      if (c === '"') {
        const inner = readQuotedDouble(j);
        if (inner === null) return null;
        j = inner + 1;
        continue;
      }
      if (c === "`") {
        const end = readBacktick(j);
        if (end === -1) return null;
        j = end + 1;
        continue;
      }
      if (c === "(") {
        depth++;
        j++;
        continue;
      }
      if (c === ")") {
        depth--;
        if (depth === 0) return j + 1;
        j++;
        continue;
      }
      j++;
    }
    return null;
  };

  /** Read a backtick substitution body. Returns index of closing backtick or -1. */
  const readBacktick = (at: number): number => {
    let j = at + 1;
    while (j < n) {
      const c = input[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "`") return j;
      j++;
    }
    return -1;
  };

  /** Read a $((...)) arithmetic expansion. Returns end index or -1. */
  const readArith = (at: number): number => {
    // at is at the second '('
    let depth = 1;
    let j = at + 1;
    while (j < n) {
      const c = input[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "'") {
        const close = input.indexOf("'", j + 1);
        if (close === -1) return -1;
        j = close + 1;
        continue;
      }
      if (c === '"') {
        const inner = readQuotedDouble(j);
        if (inner === null) return -1;
        j = inner + 1;
        continue;
      }
      if (c === "$" && input[j + 1] === "(" && input[j + 2] === "(") {
        depth++;
        j += 3;
        continue;
      }
      if (c === "(") {
        depth++;
        j++;
        continue;
      }
      if (c === ")") {
        depth--;
        if (depth === 0) {
          // closing for $(( )) is '))' — the second ) consumed next iteration;
          // simplest: require one more ')'
          return j + 1 <= n ? j + 1 : -1;
        }
        j++;
        continue;
      }
      j++;
    }
    return -1;
  };

  /** Try reading a `${...}` parameter expansion. Returns name | null. */
  const readBraceParam = (): string | null => {
    // i at '$', input[i+1] === '{'
    let j = i + 2;
    const start = j;
    while (j < n) {
      const c = input[j];
      if (c === "}") {
        return input.slice(start, j);
      }
      if (c === "{" || c === "(" || c === "$") {
        // nested expansion inside ${...} — too dynamic
        return null;
      }
      j++;
    }
    return null;
  };

  /** Scan a full word starting at i. Appends a word token; returns new i or -1. */
  const scanWord = (): number | null => {
    const rawStart = i;
    const parts: WordPart[] = [];
    let litStart = -1; // start index of pending literal text
    const flushLit = (end: number, q: QuoteCtx): void => {
      if (litStart !== -1) {
        const v = input.slice(litStart, end);
        if (v.length > 0) parts.push({ t: "lit", v, q });
        litStart = -1;
      }
    };

    let q: QuoteCtx = "none";

    while (!eof()) {
      const c = peek();

      // unquoted terminators
      if (q === "none" && (c === " " || c === "\t" || c === "\r")) break;
      if (q === "none" && c === "\n") break;
      if (
        q === "none" &&
        (c === "&" ||
          c === "|" ||
          c === ";" ||
          c === "(" ||
          c === ")" ||
          c === "<" ||
          c === ">")
      ) {
        // `<` / `>` outside quotes are redirection operators, never part of a
        // word (bash: `foo>bar` redirects bar into foo).
        break;
      }
      // `#` is only a comment when it starts a word (handled in the main loop
      // after whitespace); inside a word it is a literal character.

      if (q === "single") {
        if (c === "'") {
          flushLit(i, "single");
          q = "none";
          i++;
          continue;
        }
        i++;
        continue;
      }

      if (c === "'" && q === "none") {
        flushLit(i, "none");
        q = "single";
        if (litStart === -1) litStart = i + 1;
        i++;
        continue;
      }

      if (c === '"') {
        flushLit(i, q === "double" ? "double" : "none");
        if (q === "none") {
          q = "double";
          litStart = i + 1;
        } else {
          // closing quote
          q = "none";
        }
        i++;
        continue;
      }

      if (q === "double" && c === "\\") {
        // escaped char inside double quotes: keep both chars literal
        i += 2;
        continue;
      }
      if (q === "none" && c === "\\") {
        // escape next char
        if (i + 1 >= n) return null;
        i += 2;
        continue;
      }

      if (c === "$") {
        const n1 = peek(1);
        if (n1 === "(") {
          const n2 = peek(2);
          if (n2 === "(") {
            // $(( arithmetic
            flushLit(i, q);
            const end = readArith(i + 1);
            if (end === -1) return null;
            parts.push({ t: "arith", q: q === "double" ? "double" : "none" });
            i = end;
            continue;
          }
          // $( command substitution — readDollarParen expects the '(' index.
          flushLit(i, q);
          const openParen = i + 1;
          const inner = readDollarParen(openParen);
          if (inner === null) return null;
          parts.push({
            t: "cmdsub",
            text: inner,
            q: q === "double" ? "double" : "none",
          });
          // Skip '$', '(', inner text and the closing ')'.
          i = openParen + inner.length + 2;
          continue;
        }
        if (n1 === "{") {
          flushLit(i, q);
          const name = readBraceParam();
          if (name === null) return null;
          if (name === "") return null;
          if (/^[0-9]+$/.test(name) || name === "@" || name === "*") {
            parts.push({
              t: "special",
              name,
              q: q === "double" ? "double" : "none",
            });
          } else if (isVariableNameStart(name[0])) {
            parts.push({
              t: "var",
              name,
              q: q === "double" ? "double" : "none",
            });
          } else {
            // ${!x} / ${x:-y} / ${x#...} — dynamic, unsupported
            parts.push({ t: "brace", v: `\${${name}}`, q: "none" });
          }
          i = i + 2 + name.length + 1;
          continue;
        }
        // bare $name / $@ / $? etc
        const n1Char = n1;
        if (n1Char === "@" || n1Char === "*") {
          flushLit(i, q);
          parts.push({
            t: "special",
            name: n1Char,
            q: q === "double" ? "double" : "none",
          });
          i += 2;
          continue;
        }
        if (
          n1Char === "?" ||
          n1Char === "$" ||
          n1Char === "!" ||
          n1Char === "#" ||
          n1Char === "-" ||
          /[0-9]/.test(n1Char)
        ) {
          flushLit(i, q);
          parts.push({
            t: "special",
            name: n1Char,
            q: q === "double" ? "double" : "none",
          });
          i += 2;
          continue;
        }
        if (isVariableNameStart(n1Char)) {
          flushLit(i, q);
          let j = i + 1;
          while (j < n && NAME_CHAR.test(input[j])) j++;
          parts.push({
            t: "var",
            name: input.slice(i + 1, j),
            q: q === "double" ? "double" : "none",
          });
          i = j;
          continue;
        }
        // lone '$' — treat as literal
        i++;
        continue;
      }

      if (c === "`") {
        flushLit(i, q);
        const end = readBacktick(i);
        if (end === -1) return null;
        parts.push({
          t: "cmdsub",
          text: input.slice(i + 1, end),
          q: q === "double" ? "double" : "none",
        });
        i = end + 1;
        continue;
      }

      // process substitution <( / >( is handled at operator level (see below)
      if (litStart === -1) litStart = i;
      i++;
    }

    flushLit(i, q === "double" ? "double" : "none");
    if (i <= rawStart) return -1;
    const raw = input.slice(rawStart, i);
    tokens.push({ t: "word", raw, parts });
    return i;
  };

  /**
   * If input[i] begins a redirection operator, return the operator text to
   * emit as a word token (fd prefix + operator, plus a folded dup target like
   * `2>&1`). Digits only form an fd prefix when they directly touch the
   * operator — `2>/dev/null` is one operator, `2 > /dev/null` is the argument
   * `2` followed by a stdout redirect. Returns null when i is not a redirect,
   * or the "<heredoc>" sentinel for `<<`/`<<-`/`<<<` (unmodelled → fail
   * closed).
   */
  const readRedirectOp = (): string | null => {
    const start = i;
    let k = i;
    // optional fd-prefix digits touching the operator
    if (/[0-9]/.test(input[k] ?? "")) {
      while (k < n && /[0-9]/.test(input[k])) k++;
      if (input[k] !== "<" && input[k] !== ">") return null;
    }
    const op = input[k] ?? "";
    if (op === "&") {
      // &> / &>> — redirect both streams to a following target word
      if (input[k + 1] !== ">") return null; // plain `&` background operator
      k++;
      if (input[k + 1] === ">") k++;
      return input.slice(start, k + 1);
    }
    if (op !== "<" && op !== ">") return null;
    const next = input[k + 1] ?? "";
    if (op === "<") {
      if (next === "<") return "<heredoc>"; // << <<- <<<
      if (next === "&") {
        // <&fd dup — fold an attached fd / `-` into the token
        k++;
        if (input[k + 1] === "-") return input.slice(start, k + 2);
        let j = k + 1;
        while (j < n && /[0-9]/.test(input[j])) j++;
        if (j > k + 1) return input.slice(start, j);
        return input.slice(start, k + 1);
      }
      if (next === ">") return input.slice(start, k + 2); // <>
      return input.slice(start, k + 1); // <
    }
    // '>'
    if (next === ">") return input.slice(start, k + 2); // >>
    if (next === "&") {
      // >&fd dup — fold an attached fd / `-` into the token
      k++;
      if (input[k + 1] === "-") return input.slice(start, k + 2);
      let j = k + 1;
      while (j < n && /[0-9]/.test(input[j])) j++;
      if (j > k + 1) return input.slice(start, j);
      return input.slice(start, k + 1);
    }
    return input.slice(start, k + 1); // >
  };

  while (!eof()) {
    skipWs();
    if (eof()) break;
    const c = peek();

    if (c === "\n") {
      tokens.push({ t: "nl" });
      i++;
      continue;
    }
    if (c === "#") {
      skipComment();
      continue;
    }
    // process substitution <( ... ) / >( ... )
    if ((c === "<" || c === ">") && peek(1) === "(") {
      // Read the inner command up to matching ')' (a full command list).
      const inner = readDollarParenFrom(i + 1);
      if (inner === null) return null;
      const raw = input.slice(i, inner);
      tokens.push({
        t: "word",
        raw,
        parts: [{ t: "process", text: raw, q: "none" }],
      });
      i = inner;
      continue;
    }
    // redirection operators (optional fd prefix / folded dup targets). The
    // operator is emitted as a plain word; the (unfolded) target is scanned
    // as the next word. Heredoc bodies are unmodelled → fail closed.
    const rdr = readRedirectOp();
    if (rdr !== null) {
      if (rdr === "<heredoc>") return null;
      tokens.push({
        t: "word",
        raw: rdr,
        parts: [{ t: "lit", v: rdr, q: "none" }],
      });
      i += rdr.length;
      continue;
    }

    const two = input.slice(i, i + 2);
    if ((OP_2CHAR as readonly string[]).includes(two)) {
      tokens.push({ t: "op", op: two as OpToken });
      i += 2;
      continue;
    }
    if (OP_1CHAR.has(c)) {
      if (c === "\n") {
        tokens.push({ t: "nl" });
      } else {
        tokens.push({ t: "op", op: c as OpToken });
      }
      i++;
      continue;
    }
    // `{` / `}` are reserved words (brace group) only when delimited by
    // whitespace or a control operator; `{a,b}` stays a single word.
    if (c === "{" || c === "}") {
      const after = peek(1);
      const delimited = after === "" || /[ \t\r\n;|&()<>]/.test(after);
      if (delimited) {
        tokens.push({
          t: "word",
          raw: c,
          parts: [{ t: "lit", v: c, q: "none" }],
        });
        i++;
        continue;
      }
      const next = scanWord();
      if (next === null) return null;
      i = next;
      continue;
    }

    const next = scanWord();
    if (next === null) return null;
    i = next;
  }

  tokens.push({ t: "eof" });
  return tokens;
}

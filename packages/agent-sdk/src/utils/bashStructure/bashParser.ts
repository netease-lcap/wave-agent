/**
 * Recursive-descent parser for the structure-aware bash parser.
 *
 * Consumes the token stream from `bashLexer.ts` and produces a light AST that
 * preserves shell structure: command lists/and-or chains, pipelines,
 * subshells/brace groups, for/while/until/if/case loops and function
 * definitions. Each structural token (do/done/then/fi/esac…) is consumed by
 * the parser and never reaches the semantic layer as a "command".
 *
 * The grammar handled here is deliberately the subset bash uses in agent
 * tool commands:
 *   program   := list (sep list)*            sep ∈ {newline, ';', eof}
 *   list      := andor (op andor)*           op ∈ {&& || | |& &}
 *   andor     := command
 *   command   := simple | subshell | brace-group | for | while | until
 *              | if | case | function | select
 *
 * Anything not modelled (heredocs, arithmetic expansion, brace expansion,
 * process substitution, `${x:-y}`-style parameter expansion, unterminated
 * constructs) is a FAILURE: `parseProgram` returns null and the caller treats
 * it as a fail-closed "unsupported" result (ask instead of auto-allowing).
 */

import {
  isRedirectWord,
  redirectOpKind,
  type Token,
  type WordToken,
  type OpToken,
} from "./bashLexer.js";

/** A simple command: a word list (may start with VAR=value assignments). */
export interface CmdNode {
  kind: "cmd";
  words: WordToken[];
}

export interface ForNode {
  kind: "for";
  /** Select-style loops (select name [in words]) parsed as `for`. */
  varName: string;
  /** Iteration words — null when no `in` clause (implicit "$@"). */
  iter: WordToken[];
  body: StmtNode[];
}

export interface WhileNode {
  kind: "while";
  until: boolean;
  cond: StmtNode[];
  body: StmtNode[];
}

export interface IfClause {
  cond: StmtNode[];
  body: StmtNode[];
}

export interface IfNode {
  kind: "if";
  clauses: IfClause[];
  elseBody: StmtNode[] | null;
}

export interface CaseArm {
  /** Pattern words (may contain `|` alternatives joined already). */
  patterns: WordToken[];
  body: StmtNode[];
}

export interface CaseNode {
  kind: "case";
  word: WordToken;
  arms: CaseArm[];
}

export interface FuncNode {
  kind: "function";
  name: string;
  body: StmtNode[];
}

export interface SubshellNode {
  kind: "subshell";
  body: StmtNode[];
}

export interface GroupNode {
  kind: "group";
  body: StmtNode[];
}

/** A chain step: body plus whether varScope should fork after it. */
export interface ChainStep {
  nodes: StmtNode[];
  /** true → following steps run in a forked scope (|| | & |& …). */
  forkAfter: boolean;
}

/** An and-or chain inside a statement position. */
export interface ListNode {
  kind: "list";
  steps: ChainStep[];
}

/**
 * A compound command with trailing redirections (`while …; done < input`).
 * The redirect words bind to the whole compound, not the last inner command.
 */
export interface RedirectsNode {
  kind: "redirects";
  target: StmtNode;
  /** Redirect operator + target word tokens (`<`, `input`, …). */
  redirects: WordToken[];
}

export type StmtNode =
  | CmdNode
  | ForNode
  | WhileNode
  | IfNode
  | CaseNode
  | FuncNode
  | SubshellNode
  | GroupNode
  | ListNode
  | RedirectsNode;

export type Program = StmtNode[];

/** Reserved words — structural only when they open a command position. */
const STRUCTURAL_KEYWORDS = new Set([
  "if",
  "then",
  "elif",
  "else",
  "fi",
  "for",
  "select",
  "while",
  "until",
  "do",
  "done",
  "case",
  "esac",
  "function",
  "in",
  "{",
  "}",
  "!",
  "time",
]);

const MAX_DEPTH = 40;

export class BashParser {
  private tokens: Token[];
  private pos = 0;
  private depth = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  /** Parse the full token stream. */
  parseProgram(): Program | null {
    const program = this.parseSequence(new Set());
    if (program === null) return null;
    // Anything left over that isn't trailing newline / eof → malformed.
    const t = this.peek();
    if (t.t === "eof" || t.t === "nl") return program;
    return null;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { t: "eof" };
  }

  private next(): Token {
    const t = this.peek();
    if (this.pos < this.tokens.length) this.pos++;
    return t;
  }

  private isOp(op: OpToken): boolean {
    const t = this.peek();
    return t.t === "op" && t.op === op;
  }

  /** True when the current word is a bare (unquoted) keyword. */
  private isBareWord(raw: string): boolean {
    const t = this.peek();
    return (
      t.t === "word" &&
      t.raw === raw &&
      t.parts.length === 1 &&
      t.parts[0]?.t === "lit" &&
      t.parts[0]?.q === "none"
    );
  }

  /** Skip newline tokens. */
  private skipNl(): void {
    while (this.peek().t === "nl") this.next();
  }

  /**
   * Parse statements until a terminator in `stop` (as bare keyword) or a
   * closing op. Used for compound bodies (do…done, then…fi, case arms).
   */
  private parseSequence(stop: ReadonlySet<string>): StmtNode[] | null {
    if (this.depth > MAX_DEPTH) return null;
    this.depth++;
    try {
      const stmts: StmtNode[] = [];
      for (;;) {
        this.skipNl();
        const t = this.peek();
        if (t.t === "eof") break;
        if (t.t === "op") {
          if (
            t.op === ")" ||
            t.op === ";;" ||
            t.op === ";&" ||
            t.op === ";;&"
          ) {
            break;
          }
          if (t.op === ";") {
            this.next();
            continue;
          }
          if (t.op === "&") {
            // stray background op — treat as separator
            this.next();
            continue;
          }
          return null; // '(' or others not valid here
        }
        if (t.t === "word") {
          if (STRUCTURAL_KEYWORDS.has(t.raw) && this.isBareWord(t.raw)) {
            // Closing keywords (then/do/else/fi/done/esac/}) only appear at
            // clause boundaries: a matching one ends this sequence, a stray
            // one is a syntax error (fail closed).
            if (stop.has(t.raw)) break;
            if (t.raw === "}") break;
            if (
              t.raw === "then" ||
              t.raw === "do" ||
              t.raw === "else" ||
              t.raw === "elif" ||
              t.raw === "fi" ||
              t.raw === "done" ||
              t.raw === "esac"
            ) {
              return null;
            }
            // Opening keywords (if/for/while/until/case/select/function/{)
            // start a nested compound — let parseChain dispatch them.
          }
        }
        const stmt = this.parseChain();
        if (stmt === null) return null;
        stmts.push(stmt);
      }
      return stmts;
    } finally {
      this.depth--;
    }
  }

  /** Parse an and-or chain: cmd (&&|… cmd)* */
  private parseChain(): StmtNode | null {
    const steps: ChainStep[] = [];
    let first = this.parseCommand();
    if (first === null) return null;
    steps.push({ nodes: first, forkAfter: false });

    for (;;) {
      const t = this.peek();
      if (t.t !== "op") break;
      if (t.op === "&&") {
        this.next();
        // && is sequential — same scope continues; only ';' etc reset lists.
        const cmds = this.parseCommand();
        if (cmds === null) return null;
        steps.push({ nodes: cmds, forkAfter: false });
        continue;
      }
      if (t.op === "||" || t.op === "|" || t.op === "|&" || t.op === "&") {
        this.next();
        const cmds = this.parseCommand();
        if (cmds === null) return null;
        steps.push({ nodes: cmds, forkAfter: true });
        continue;
      }
      break;
    }

    if (steps.length === 1)
      return steps[0]?.nodes[0] ?? { kind: "list", steps };
    return { kind: "list", steps };
  }

  /** Parse a single command (simple or compound). Returns nodes array. */
  private parseCommand(): StmtNode[] | null {
    if (this.depth > MAX_DEPTH) return null;
    this.depth++;
    try {
      this.skipNl();

      // `! cmd` / `time cmd` prefixes
      for (;;) {
        if (this.isBareWord("!") || this.isBareWord("time")) {
          this.next();
          continue;
        }
        break;
      }

      const t = this.peek();

      // subshell `( ... )`
      if (t.t === "op" && t.op === "(") {
        this.next();
        const body = this.parseSequence(new Set());
        if (body === null) return null;
        if (!this.isOp(")")) return null;
        this.next();
        const n: SubshellNode = { kind: "subshell", body };
        return [this.absorbTrailingRedirects(n)];
      }

      if (t.t === "word") {
        const isBare = this.isBareWord(t.raw);
        if (isBare) {
          switch (t.raw) {
            case "if": {
              this.next();
              const n = this.parseIf();
              return n ? [this.absorbTrailingRedirects(n)] : null;
            }
            case "while":
            case "until": {
              this.next();
              const until = t.raw === "until";
              const n = this.parseWhile(until);
              return n ? [this.absorbTrailingRedirects(n)] : null;
            }
            case "for":
            case "select": {
              this.next();
              const n = this.parseFor();
              return n ? [this.absorbTrailingRedirects(n)] : null;
            }
            case "case": {
              this.next();
              const n = this.parseCase();
              return n ? [this.absorbTrailingRedirects(n)] : null;
            }
            case "function": {
              this.next();
              const n = this.parseFunctionKw();
              return n ? [this.absorbTrailingRedirects(n)] : null;
            }
            case "{": {
              // brace group { list; }
              this.next();
              const body = this.parseSequence(new Set(["}"]));
              if (body === null) return null;
              if (!this.isBareWord("}")) return null;
              this.next();
              const n: GroupNode = { kind: "group", body };
              return [this.absorbTrailingRedirects(n)];
            }
            default:
              break;
          }
        }
        // function definition `name() { …; }`
        const func = this.tryParseFunctionDecl();
        if (func) return [this.absorbTrailingRedirects(func)];
        // simple command
        const words = this.parseSimpleCommandWords();
        if (words === null) return null;
        return [{ kind: "cmd", words }];
      }

      if (t.t === "nl") return [];
      return null;
    } finally {
      this.depth--;
    }
  }

  /**
   * Absorb redirections that trail a compound command (e.g. the `< input.txt`
   * in `while read x; do …; done < input.txt`). Shell grammar binds them to
   * the whole compound; we wrap it in a RedirectsNode so the semantic layer can
   * attach the redirect text to the compound's last leaf command.
   */
  private absorbTrailingRedirects(node: StmtNode): StmtNode {
    this.skipNl();
    const redirects: WordToken[] = [];
    for (;;) {
      this.skipNl();
      const t = this.peek();
      if (t.t !== "word" || !isRedirectWord(t)) break;
      this.next();
      redirects.push(t);
      // Unfolded operators (`>`, `2>`, `>>`, `&>`) take the next word as their
      // target; folded dups (`2>&1`) already contain everything.
      if (redirectOpKind(t.raw) === "plain") {
        const target = this.peek();
        if (target.t !== "word" || isRedirectWord(target)) break;
        redirects.push(target);
        this.next();
      }
    }
    if (redirects.length === 0) return node;
    return { kind: "redirects", target: node, redirects };
  }

  private parseIf(): IfNode | null {
    // after `if`
    const clauses: IfClause[] = [];
    let elseBody: StmtNode[] | null = null;

    const cond = this.parseSequence(new Set(["then", "elif", "else", "fi"]));
    if (cond === null) return null;
    if (!this.isBareWord("then")) return null;
    this.next();
    const body = this.parseSequence(new Set(["elif", "else", "fi"]));
    if (body === null) return null;
    clauses.push({ cond, body });

    for (;;) {
      if (this.isBareWord("elif")) {
        this.next();
        const c2 = this.parseSequence(new Set(["then"]));
        if (c2 === null) return null;
        if (!this.isBareWord("then")) return null;
        this.next();
        const b2 = this.parseSequence(new Set(["elif", "else", "fi"]));
        if (b2 === null) return null;
        clauses.push({ cond: c2, body: b2 });
        continue;
      }
      if (this.isBareWord("else")) {
        this.next();
        const eb = this.parseSequence(new Set(["fi"]));
        if (eb === null) return null;
        elseBody = eb;
        continue;
      }
      if (this.isBareWord("fi")) {
        this.next();
        return { kind: "if", clauses, elseBody };
      }
      return null;
    }
  }

  private parseWhile(until: boolean): WhileNode | null {
    // after while/until
    const cond = this.parseSequence(new Set(["do", "done"]));
    if (cond === null) return null;
    if (!this.isBareWord("do")) return null;
    this.next();
    const body = this.parseSequence(new Set(["done"]));
    if (body === null) return null;
    if (!this.isBareWord("done")) return null;
    this.next();
    return { kind: "while", until, cond, body };
  }

  private parseFor(): ForNode | null {
    // after for/select
    const nameTok = this.peek();
    if (nameTok.t !== "word") return null;
    if (!(nameTok.parts.length === 1 && nameTok.parts[0]?.t === "lit")) {
      return null;
    }
    const varName = nameTok.raw;
    this.next();

    let iter: WordToken[] = [];

    // C-style for ((…)) unsupported
    if (this.isOp("(")) return null;

    if (this.isBareWord("in")) {
      this.next();
      // read words until ';' / newline / do
      for (;;) {
        this.skipNl();
        const t = this.peek();
        if (t.t === "eof") return null;
        if (t.t === "op") {
          if (t.op === ";" || t.op === "(" || t.op === ")") {
            if (t.op === ";" || t.op === ")") {
              if (t.op === ";") this.next();
              break;
            }
          }
          return null;
        }
        if (t.t === "word") {
          if (this.isBareWord("do")) break;
          iter.push(t);
          this.next();
          continue;
        }
        return null;
      }
    } else {
      // for name; do … done  → implicit "$@"
      if (this.isOp(";")) this.next();
    }

    this.skipNl();
    if (!this.isBareWord("do")) return null;
    this.next();
    const body = this.parseSequence(new Set(["done"]));
    if (body === null) return null;
    if (!this.isBareWord("done")) return null;
    this.next();
    return { kind: "for", varName, iter, body };
  }

  private parseCase(): CaseNode | null {
    // after `case`
    const wordTok = this.peek();
    if (wordTok.t !== "word") return null;
    this.next();
    if (!this.isBareWord("in")) return null;
    this.next();

    const arms: CaseArm[] = [];
    for (;;) {
      this.skipNl();
      if (this.isBareWord("esac")) {
        this.next();
        return { kind: "case", word: wordTok, arms };
      }
      // pattern list terminated by `)` — patterns may be `a|b)`.
      const patterns: WordToken[] = [];
      for (;;) {
        this.skipNl();
        const t = this.peek();
        if (t.t !== "word") return null;
        patterns.push(t);
        this.next();
        this.skipNl();
        const n = this.peek();
        if (n.t === "op" && n.op === "|") {
          this.next();
          continue;
        }
        if (n.t === "op" && n.op === ")") {
          this.next();
          break;
        }
        return null;
      }
      const body = this.parseSequence(new Set(["esac"]));
      // body ends at ;; / ;& / ;;& / esac (parseSequence stops on op ;; etc.)
      const after = this.peek();
      if (after.t === "op") {
        if (after.op === ";;" || after.op === ";&" || after.op === ";;&") {
          this.next();
          arms.push({ patterns, body: body ?? [] });
          continue;
        }
      }
      if (this.isBareWord("esac")) {
        this.next();
        arms.push({ patterns, body: body ?? [] });
        return { kind: "case", word: wordTok, arms };
      }
      if (body === null) return null;
      arms.push({ patterns, body });
    }
  }

  private parseFunctionKw(): FuncNode | null {
    // after `function`
    const nameTok = this.peek();
    if (nameTok.t !== "word") return null;
    const name = nameTok.raw;
    this.next();
    // optional `()` after name in `function f ()`
    if (this.isOp("(")) {
      this.next();
      if (!this.isOp(")")) return null;
      this.next();
    }
    const body = this.parseBraceBody();
    if (body === null) return null;
    return { kind: "function", name, body };
  }

  /** Detect `name() { …; }` form. Must be called at a simple-command word. */
  private tryParseFunctionDecl(): FuncNode | null {
    const t = this.peek();
    if (t.t !== "word") return null;
    // A function name cannot look like an assignment (VAR=…)
    if (/^[A-Za-z_][A-Za-z0-9_]*=[^=]/.test(t.raw)) return null;
    // Lookahead: word '(' ')'
    const afterName = this.tokens[this.pos + 1];
    if (afterName?.t !== "op" || afterName.op !== "(") return null;
    // Confirm matching ')' after optional whitespace (no whitespace tokens in
    // our stream — spaces are skipped), so next op must be ')' or word '(').
    let j = this.pos + 2;
    while (this.tokens[j]?.t === "nl") j++;
    const afterParen = this.tokens[j];
    if (afterParen?.t === "op" && afterParen.op === ")") {
      this.next(); // name
      this.next(); // (
      this.next(); // )
      const body = this.parseBraceBody();
      if (body === null) return null;
      return { kind: "function", name: t.raw, body };
    }
    return null;
  }

  /** Parse `{ …; }` compound body for function definitions. */
  private parseBraceBody(): StmtNode[] | null {
    this.skipNl();
    if (!this.isBareWord("{")) {
      // function body may be a single command without braces (rare) — allow
      const single = this.parseChain();
      return single ? [single] : null;
    }
    this.next();
    const body = this.parseSequence(new Set(["}"]));
    if (body === null) return null;
    if (!this.isBareWord("}")) return null;
    this.next();
    return body;
  }

  /** Collect words of a simple command until a chain separator. */
  private parseSimpleCommandWords(): WordToken[] | null {
    const words: WordToken[] = [];
    for (;;) {
      const t = this.peek();
      if (t.t === "eof") break;
      if (t.t === "nl") break;
      if (t.t === "op") {
        if (
          t.op === ";" ||
          t.op === "&&" ||
          t.op === "||" ||
          t.op === "|" ||
          t.op === "|&" ||
          t.op === "&" ||
          t.op === ")"
        ) {
          break;
        }
        // ( or { appearing mid-command → malformed simple command
        if (t.op === "(") return null;
        break;
      }
      if (t.t === "word") {
        if (
          STRUCTURAL_KEYWORDS.has(t.raw) &&
          this.isBareWord(t.raw) &&
          words.length === 0
        ) {
          // structural keyword at command start is handled in parseCommand;
          // reaching here means parseCommand already dispatched. Guard anyway.
          return null;
        }
        words.push(t);
        this.next();
        continue;
      }
      return null;
    }
    return words.length > 0 ? words : null;
  }
}

/**
 * Parse a token stream into a program. Returns null on any construct that
 * cannot be statically modelled (fail-closed → caller asks).
 */
export function parseTokens(tokens: Token[]): Program | null {
  if (tokens === null) return null;
  const parser = new BashParser(tokens);
  return parser.parseProgram();
}

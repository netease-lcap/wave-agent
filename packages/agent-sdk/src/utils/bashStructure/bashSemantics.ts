/**
 * Semantic layer for the structure-aware bash parser.
 *
 * Walks the parse tree from `bashParser.ts` and expands every executable unit
 * into a flat list of "leaf" simple commands (BashLeaf). The permission layer
 * (P2) classifies each leaf with the exact rules already used for plain
 * commands (read-only sets, path Safe Zone checks, allow rules).
 *
 * Semantics mirrors Claude Code's collectCommands / resolveSimpleExpansion:
 *
 *  - Compound commands contribute the leaves of *every* branch/iteration body:
 *    statically we cannot know which branch runs, so each is checked; an
 *    unsafe leaf anywhere forces the whole command to ask.
 *  - `$(...)` / backticks are expanded recursively into their own leaves. A
 *    substitution that appears inside one of a leaf's own argument words marks
 *    that leaf `unsafe` (`command-substitution`) — its expansion is dynamic.
 *  - Assignments are tracked in a scope so later leaves in the same sequential
 *    chain can resolve bare references (spec: `x=abc; echo $x` — the value is a
 *    statically known literal). Anything not literally known stays UNKNOWN.
 *  - A bare (unquoted) reference to an UNKNOWN variable marks the leaf unsafe
 *    (`bare-variable`): word-splitting/globbing could inject extra arguments.
 *    Quoted `"$f"` references are always safe (a single word). `$@`/`$*` are
 *    never safe bare *or* quoted — they expand to any number of words.
 *  - Arithmetic/brace/process substitutions, heredocs, eval/trap and any parse
 *    failure fail closed: the whole parse reports `unsupported` (ask).
 *
 * Scope rules mirror bash execution conservatively:
 *  - Sequential `;` / `&&` steps share a scope (assignments propagate).
 *  - Fork steps (`||`, `|`, `|&`, `&`) and compound bodies run from a copy, so
 *    an assignment on one side is never assumed on the other.
 *  - Assignment-prefixed commands (`VAR=x cmd`) keep the *incoming* scope for
 *    their own argument expansion (bash expands args before applying prefix).
 */

import {
  tokenize,
  isRedirectWord,
  redirectOpKind,
  type WordToken,
  type WordPart,
} from "./bashLexer.js";
import {
  parseTokens,
  type StmtNode,
  type CmdNode,
  type ForNode,
  type WhileNode,
  type IfNode,
  type CaseNode,
  type Program,
} from "./bashParser.js";
import {
  SAFE_ENV_VARS,
  type BashLeaf,
  type BashLeafReason,
  type BashStructureResult,
  type BashUnsupportedReason,
} from "./types.js";

/** Sentinel: variable value cannot be statically known. */
const UNKNOWN = "\u0000unknown";
/** Sentinel: value comes from $@/$* (any number of words). */
const MULTIWORD = "\u0000multiword";
/** Sentinel: $?/$$/… special var (dynamic but a single word). */
const SPECIAL_SINGLE = "\u0000special";

type VarValue = string; // literal text or one of the sentinels
type Scope = Map<string, VarValue>;

/** Aborts the walk with a fail-closed reason. */
class Unsupported extends Error {
  constructor(
    public reason: BashUnsupportedReason,
    message?: string,
  ) {
    super(message ?? reason);
  }
}

/** Bare-variable values containing these can word-split / glob. */
const BARE_UNSAFE_RE = /[ \t\n*?[]/;

export class BashSemantics {
  private leaves: BashLeaf[] = [];

  /** Parse and expand a full command string. */
  static analyze(command: string): BashStructureResult {
    const s = new BashSemantics();
    return s.run(command);
  }

  private run(command: string): BashStructureResult {
    if (command.trim() === "") return { status: "ok", leaves: [] };
    const tokens = tokenize(command);
    if (tokens === null) return this.unsupportedFor(command);
    const program = parseTokens(tokens);
    if (program === null) return { status: "unsupported", reason: "syntax" };
    try {
      this.walkProgram(program, new Map());
    } catch (err) {
      if (err instanceof Unsupported) {
        return {
          status: "unsupported",
          reason: err.reason,
          message: err.message,
        };
      }
      throw err;
    }
    return { status: "ok", leaves: this.leaves };
  }

  /** Best-effort reason classification when the lexer rejects the input. */
  private unsupportedFor(command: string): BashStructureResult {
    if (/<<-?[A-Za-z0-9_]/.test(command)) {
      return { status: "unsupported", reason: "heredoc" };
    }
    if (command.includes("$((`")) {
      return { status: "unsupported", reason: "syntax" };
    }
    if (command.includes("$((")) {
      return { status: "unsupported", reason: "arithmetic-expansion" };
    }
    if (/\{[^}]*[,.][^}]*\}/.test(command)) {
      return { status: "unsupported", reason: "brace-expansion" };
    }
    return { status: "unsupported", reason: "syntax" };
  }

  // ── Program / statement walking ───────────────────────────────────────────

  private walkProgram(stmts: Program, scope: Scope): void {
    let current = scope;
    for (const stmt of stmts) {
      // Top-level statements separated by ; / newline run sequentially in the
      // same shell, so assignments propagate.
      current = this.walkStmt(stmt, current, current);
    }
  }

  private walkStmt(stmt: StmtNode, scope: Scope, entry: Scope): Scope {
    switch (stmt.kind) {
      case "cmd":
        return this.walkCmd(stmt, scope);
      case "for":
        return this.walkFor(stmt, scope);
      case "while":
        return this.walkWhile(stmt, scope);
      case "if":
        return this.walkIf(stmt, scope);
      case "case":
        return this.walkCase(stmt, scope);
      case "function":
        throw new Unsupported(
          "unknown-command",
          "function definitions cannot be statically expanded",
        );
      case "subshell": {
        // `( a; b )` — runs in a subshell; assignments never escape.
        this.walkProgram(stmt.body, new Map());
        return scope;
      }
      case "group": {
        // `{ a; b; }` — runs in the current shell sequentially.
        this.walkProgram(stmt.body, scope);
        return scope;
      }
      case "list": {
        let working = copyScope(scope);
        const entryCopy = copyScope(entry);
        for (const step of stmt.steps) {
          if (step.forkAfter) working = copyScope(entryCopy);
          for (const node of step.nodes) {
            working = this.walkStmt(node, working, entryCopy);
          }
        }
        return working;
      }
      case "redirects": {
        const innerScope = this.walkStmt(stmt.target, scope, entry);
        this.mergeRedirectsIntoLastLeaf(stmt.redirects);
        return innerScope;
      }
      default: {
        const _never: never = stmt;
        void _never;
        return scope;
      }
    }
  }

  /** Bind compound-level redirects to the last leaf produced by the target. */
  private mergeRedirectsIntoLastLeaf(redirects: WordToken[]): void {
    const redirText = redirects.map((w) => w.raw).join(" ");
    if (this.leaves.length === 0) {
      // No leaf (empty body): still surface the redirect so text-level write
      // detection can reject `> out`.
      this.leaves.push({
        argv: [],
        command: "",
        text: redirText,
        unsafe: false,
        reasons: [],
      });
      return;
    }
    const last = this.leaves[this.leaves.length - 1];
    last.text = `${last.text} ${redirText}`;
  }

  // ── Statement implementations ─────────────────────────────────────────────

  private walkCmd(node: CmdNode, scope: Scope): Scope {
    const words = node.words;

    // Split leading assignment prefix (`VAR=x cmd …`) from the command words.
    let i = 0;
    while (i < words.length && parseAssignment(words[i]) !== null) i++;
    const assignments = words.slice(0, i);
    const commandWords = words.slice(i);

    if (commandWords.length === 0) {
      // Assignment-only statement: `x=$(cmd)`. Command substitutions execute;
      // the value (unknown) propagates to the sequential scope.
      for (const w of assignments) {
        const a = parseAssignment(w);
        if (a) this.applyAssignment(a, scope);
      }
      return scope;
    }

    // Prefix assignments apply only to the command's own environment, and bash
    // expands the command's words *before* applying them — expand with the
    // incoming scope. They do NOT leak to the sequential scope (`FOO=x echo hi`
    // leaves FOO unset afterwards).
    const leaf = this.buildLeaf(commandWords, scope);
    if (leaf) this.leaves.push(leaf);
    return scope;
  }

  private walkFor(node: ForNode, scope: Scope): Scope {
    // Iteration words: command substitutions in them execute (their output is
    // the data iterated over) — collect those leaves. The loop variable value
    // is unknown for every iteration.
    for (const w of node.iter) this.collectWordCmdSubs(w);
    const bodyScope = copyScope(scope);
    bodyScope.set(node.varName, UNKNOWN);
    this.walkProgram(node.body, bodyScope);
    // Assignments inside the body may not run (zero iterations): don't leak.
    return scope;
  }

  private walkWhile(node: WhileNode, scope: Scope): Scope {
    const condScope = copyScope(scope);
    this.walkProgram(node.cond, condScope);
    // `while read var` captures stdin into var → unknown in the body.
    for (const stmt of node.cond) this.collectReadCaptures(stmt, condScope);
    const bodyScope = copyScope(condScope);
    this.walkProgram(node.body, bodyScope);
    return scope;
  }

  private walkIf(node: IfNode, scope: Scope): Scope {
    for (const clause of node.clauses) {
      this.walkProgram(clause.cond, copyScope(scope));
      this.walkProgram(clause.body, copyScope(scope));
    }
    if (node.elseBody) this.walkProgram(node.elseBody, copyScope(scope));
    return scope;
  }

  private walkCase(node: CaseNode, scope: Scope): Scope {
    this.collectWordCmdSubs(node.word);
    for (const arm of node.arms) {
      for (const pat of arm.patterns) this.collectWordCmdSubs(pat);
      this.walkProgram(arm.body, copyScope(scope));
    }
    return scope;
  }

  // ── Leaf construction ─────────────────────────────────────────────────────

  /**
   * Build a BashLeaf from a command's words. Emits leaves for command
   * substitutions embedded in argument words. Throws Unsupported on
   * fail-closed constructs.
   */
  private buildLeaf(words: WordToken[], scope: Scope): BashLeaf | null {
    const argv: string[] = [];
    const reasons: BashLeafReason[] = [];
    const redirects: string[] = [];

    for (let idx = 0; idx < words.length; idx++) {
      const w = words[idx];
      // Redirection operator (lexer emits them as words, optionally with an fd
      // prefix like `2>` or a folded dup target like `2>&1`): keep the operator
      // and (for unfolded forms) its following target word in `text` rather
      // than argv so legacy text checkers (hasWriteRedirections / path zone)
      // still see them.
      if (isRedirectWord(w)) {
        redirects.push(w.raw);
        if (redirectOpKind(w.raw) === "plain") {
          const target = words[idx + 1];
          if (target && !isRedirectWord(target)) {
            redirects.push(target.raw);
            idx++;
          }
        }
        continue;
      }
      this.classifyWordParts(w, scope, reasons);
      argv.push(w.raw);
    }

    if (argv.length === 0) {
      if (redirects.length === 0) return null;
      return {
        argv: [],
        command: "",
        text: redirects.join(" "),
        unsafe: false,
        reasons: [],
      };
    }

    const command = commandNameOf(argv[0]);
    if (command === "eval" || command === "trap") {
      throw new Unsupported("eval", `\`${command}\` is dynamic execution`);
    }
    const text = redirects.length
      ? `${argv.join(" ")} ${redirects.join(" ")}`
      : argv.join(" ");
    return {
      argv,
      command,
      text,
      unsafe: reasons.length > 0,
      reasons,
    };
  }

  /**
   * Classify one word's parts for structural safety. Pushes reasons onto
   * `reasons` for unsafe leaf conditions. Throws Unsupported for fail-closed
   * construct kinds.
   */
  private classifyWordParts(
    w: WordToken,
    scope: Scope,
    reasons: BashLeafReason[],
  ): void {
    for (const part of w.parts) {
      switch (part.t) {
        case "lit":
          if (
            part.q === "none" &&
            part.v.includes("{") &&
            part.v.includes("}") &&
            (part.v.includes(",") || part.v.includes(".."))
          ) {
            throw new Unsupported(
              "brace-expansion",
              `brace expansion in \`${w.raw}\``,
            );
          }
          break;
        case "var": {
          const value = resolveVar(part.name, scope);
          if (part.q === "double") break; // quoted → one word, always safe
          if (SAFE_ENV_VARS.has(part.name)) break;
          if (value === UNKNOWN || value === MULTIWORD) {
            reasons.push("bare-variable");
          } else if (typeof value === "string" && BARE_UNSAFE_RE.test(value)) {
            reasons.push("bare-variable");
          }
          break;
        }
        case "special":
          if (part.name === "@" || part.name === "*") {
            reasons.push("bare-variable");
          }
          break;
        case "cmdsub":
          // Executes inside an argument word → dynamic, ask.
          this.emitSubstitutionLeaves(part.text);
          reasons.push("command-substitution");
          break;
        case "arith":
          throw new Unsupported(
            "arithmetic-expansion",
            `$((…)) in \`${w.raw}\``,
          );
        case "brace":
          throw new Unsupported(
            "brace-expansion",
            `parameter/brace expansion in \`${w.raw}\``,
          );
        case "process":
          throw new Unsupported(
            "process-substitution",
            `process substitution in \`${w.raw}\``,
          );
      }
    }
  }

  // ── Assignments / scope ───────────────────────────────────────────────────

  private applyAssignment(
    a: { name: string; valueParts: WordPart[] },
    scope: Scope,
  ): void {
    let value = "";
    for (const part of a.valueParts) {
      switch (part.t) {
        case "lit":
          value += part.v;
          break;
        case "var": {
          const v = resolveVar(part.name, scope);
          if (v === MULTIWORD) value += MULTIWORD;
          else value += v;
          break;
        }
        case "special":
          value += SPECIAL_SINGLE;
          break;
        case "cmdsub":
          this.emitSubstitutionLeaves(part.text);
          value += UNKNOWN;
          break;
        case "arith":
          throw new Unsupported("arithmetic-expansion", "$((…)) in assignment");
        case "brace":
          throw new Unsupported(
            "brace-expansion",
            "brace expansion in assignment",
          );
        case "process":
          throw new Unsupported(
            "process-substitution",
            "process substitution in assignment",
          );
      }
    }
    if (
      value === "" ||
      value.includes(UNKNOWN) ||
      value.includes(SPECIAL_SINGLE)
    ) {
      scope.set(a.name, UNKNOWN);
    } else {
      scope.set(a.name, value);
    }
  }

  // ── Command substitution expansion ───────────────────────────────────────

  /** Collect leaves of command substitutions in a word (iter/case positions). */
  private collectWordCmdSubs(w: WordToken): void {
    for (const part of w.parts) {
      if (part.t === "cmdsub") this.emitSubstitutionLeaves(part.text);
    }
  }

  /** Recursively parse a $() body and append its leaves. */
  private emitSubstitutionLeaves(text: string): void {
    const sub = new BashSemantics();
    const result = sub.run(text);
    if (result.status !== "ok") {
      throw new Unsupported(
        result.status === "unsupported" ? result.reason : "syntax",
        `command substitution body \`${text}\``,
      );
    }
    this.leaves.push(...result.leaves);
  }

  /** Mark variables captured by `read` in a condition list as unknown. */
  private collectReadCaptures(stmt: StmtNode, scope: Scope): void {
    switch (stmt.kind) {
      case "cmd": {
        const words = stmt.words;
        if (words.length === 0 || words[0]?.raw !== "read") return;
        for (let i = 1; i < words.length; i++) {
          const raw = words[i]?.raw ?? "";
          if (raw.startsWith("-")) continue;
          const name = raw.replace(/^["']|["']$/g, "");
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) scope.set(name, UNKNOWN);
        }
        return;
      }
      case "list":
        for (const step of stmt.steps) {
          for (const n of step.nodes) this.collectReadCaptures(n, scope);
        }
        return;
      case "redirects":
        this.collectReadCaptures(stmt.target, scope);
        return;
      default:
        return;
    }
  }
}

// ── Free helpers ────────────────────────────────────────────────────────────

function resolveVar(name: string, scope: Scope): VarValue {
  return scope.get(name) ?? UNKNOWN;
}

function copyScope(scope: Scope): Scope {
  return new Map(scope);
}

/**
 * A bare command name (first argv word, quotes stripped). If it is still not a
 * plain name (e.g. a variable), the caller treats it as unresolvable.
 */
function commandNameOf(raw: string): string {
  return raw.replace(/^["']|["']$/g, "");
}

/**
 * Detect a leading assignment in a word (`NAME=value`). The name part must be
 * unquoted literal text. Returns the name and the value parts, or null.
 */
function parseAssignment(
  w: WordToken,
): { name: string; valueParts: WordPart[] } | null {
  const parts = w.parts;
  const first = parts[0];
  if (!first || first.t !== "lit" || first.q !== "none") return null;
  const v = first.v;
  const eq = v.indexOf("=");
  if (eq <= 0) return null;
  const name = v.slice(0, eq);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;

  const valueParts: WordPart[] = [];
  const remainder = v.slice(eq + 1);
  if (remainder.length > 0)
    valueParts.push({ t: "lit", v: remainder, q: "none" });
  for (let i = 1; i < parts.length; i++) valueParts.push(parts[i]);
  if (valueParts.length === 0) valueParts.push({ t: "lit", v: "", q: "none" });
  return { name, valueParts };
}

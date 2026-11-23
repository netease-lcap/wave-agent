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
import { extractDataRegions } from "./dataRegions.js";
import {
  MAX_COMMAND_LENGTH,
  SAFE_ENV_VARS,
  type BashAssignment,
  type BashLeaf,
  type BashLeafReason,
  type BashParseStats,
  type BashStructureDetail,
  type BashStructureResult,
  type BashSubshellRange,
  type BashUnsupportedReason,
} from "./types.js";

/**
 * Backstop on substitution nesting, so the walk cannot recurse without bound on
 * a line like `$( $( $( … ) ) )`. Callers that judge nesting compare against
 * their own (smaller) limit via {@link BashStructureDetail.maxNesting}; this one
 * only exists to keep the recursion finite.
 */
const MAX_SUBSTITUTION_DEPTH = 16;

/** Backstop on leaf count; the length limit is what actually binds today. */
const MAX_LEAVES = 2000;

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

  /** Leaf ranges running in a subshell, filled as the walk meets them. */
  readonly subshells: BashSubshellRange[] = [];

  /** Non-zero while walking a function body: a definition runs nothing, so the
   *  writes inside it must not look like writes this line has already made. */
  private suppressed = 0;

  /** Ids of the subshells this walk is inside, innermost last. */
  private readonly subshellStack: number[] = [];

  /**
   * Variable writes met so far, in program order. Kept for callers that have to
   * place a variable target before the line runs (`rm -rf "$D"`): they need to
   * know which value `D` held at that point, which the fail-closed parse never
   * has to answer.
   */
  private readonly assignments: BashAssignment[] = [];

  /**
   * Constructs the *detailed* walk keeps walking past, because it can still say
   * something useful about them: `eval` keeps its command words so the caller
   * can read its literal argument as a command line a second time, and a process
   * substitution keeps the leaves of its body. `null` in the fail-closed walk,
   * where both abort the parse — `parseBashStructure` then answers
   * `unsupported` exactly as before.
   */
  private readonly softErrors: BashUnsupportedReason[] | null;

  /**
   * @param stats filled in as the walk goes (nesting depth, budget aborts).
   *   Shared with the nested walks a command substitution spawns, so depth is
   *   measured against the whole line rather than per level.
   * @param depth substitution nesting this walk runs at.
   * @param softErrors where to record a construct this walk chose to keep
   *   walking past; `null` (the fail-closed walk) aborts on them instead.
   */
  constructor(
    private readonly stats: BashParseStats = { maxNesting: 0, aborted: false },
    private readonly depth = 0,
    softErrors: BashUnsupportedReason[] | null = null,
  ) {
    this.softErrors = softErrors;
  }

  /** Parse and expand a full command string. */
  static analyze(command: string): BashStructureResult {
    const s = new BashSemantics();
    return s.run(command);
  }

  /**
   * The same walk, keeping the split the fail-closed projection collapses:
   * which regions were data, and which input could not be read as commands.
   *
   * Heredoc bodies, here-strings and comments are removed before the command
   * stream is parsed (see `dataRegions.ts`), so prose in a commit message is
   * never mistaken for a command. Everything that is *not* data is reported in
   * `errors` instead of silently ending the walk.
   */
  static analyzeDetailed(command: string): BashStructureDetail {
    if (command.length > MAX_COMMAND_LENGTH) {
      return {
        commandText: command,
        leaves: [],
        dataRegions: 0,
        heredocRegions: 0,
        errors: [],
        aborted: true,
        maxNesting: 0,
        assignments: [],
        subshells: [],
        heredocBodies: [],
      };
    }
    const data = extractDataRegions(command);
    const stats: BashParseStats = { maxNesting: 0, aborted: false };
    const softErrors: BashUnsupportedReason[] = [];
    const semantics = new BashSemantics(stats, 0, softErrors);
    const result = semantics.run(data.text);
    const errors: BashUnsupportedReason[] = [...softErrors];
    // A heredoc that could not be established as data is unreadable input, not
    // data: the text is still in `commandText` and the caller must judge (or
    // ask about) it.
    if (data.errors.length > 0) errors.push("heredoc");
    if (result.status === "unsupported" && !errors.includes(result.reason)) {
      errors.push(result.reason);
    }
    const leaves = result.status === "ok" ? result.leaves : [];
    if (leaves.length > MAX_LEAVES) stats.aborted = true;
    return {
      commandText: data.text,
      leaves: stats.aborted ? [] : leaves,
      dataRegions: data.regions,
      heredocRegions: data.heredocs,
      errors,
      aborted: stats.aborted,
      maxNesting: stats.maxNesting,
      assignments: semantics.assignments,
      subshells: [...semantics.subshells].sort(
        (a, b) => a.start - b.start || b.end - a.end,
      ),
      heredocBodies: data.bodies,
    };
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
      case "function": {
        // Defining a function runs nothing, but a later call runs its body, and
        // statically that call is as likely as any branch of an `if` — so the
        // body is judged by the rules its commands would get in full. Two
        // things are cut: the call site's variables are unknowable here, and a
        // write inside the body does not happen until it is called, so it must
        // not read as a write this line has already made.
        this.walkFunctionBody(stmt.body);
        return scope;
      }
      case "subshell": {
        // `( a; b )` — runs in a subshell; assignments never escape. The leaf
        // range is kept so a caller tracking the shell's directory knows the
        // `cd` in here is undone when the subshell ends, and the leaves and
        // writes carry its id so a caller tracking variable values keeps them
        // apart from the shell around them.
        const start = this.leaves.length;
        this.subshellStack.push(this.nextSubshellId());
        try {
          this.walkProgram(stmt.body, new Map());
        } finally {
          this.subshellStack.pop();
        }
        this.subshells.push({ start, end: this.leaves.length });
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
        if (!a) continue;
        // The value is read with the scope as it was *before* this write, so
        // `V=$W` never sees its own result; the write itself is recorded after
        // `applyAssignment` so a command substitution on the right-hand side
        // counts as a command this line runs before the next one.
        const value = knownValue(a.valueParts, scope);
        this.applyAssignment(a, scope);
        this.recordAssignment(
          a,
          w.raw.slice(a.name.length + 1),
          undefined,
          value,
        );
      }
      return scope;
    }

    // Prefix assignments apply only to the command's own environment, and bash
    // expands the command's words *before* applying them — expand with the
    // incoming scope. They do NOT leak to the sequential scope (`FOO=x echo hi`
    // leaves FOO unset afterwards).
    const leaf = this.buildLeaf(commandWords, scope);
    if (leaf) {
      const subshell = this.subshellId();
      if (subshell !== 0) leaf.subshell = subshell;
      this.leaves.push(leaf);
    }
    return scope;
  }

  private walkFor(node: ForNode, scope: Scope): Scope {
    // Iteration words: command substitutions in them execute (their output is
    // the data iterated over) — collect those leaves. The loop variable value
    // is unknown for every iteration.
    for (const w of node.iter) this.collectWordCmdSubs(w);
    const bodyScope = copyScope(scope);
    bodyScope.set(node.varName, UNKNOWN);
    this.recordAssignment(
      { name: node.varName, valueParts: [] },
      node.iter.map((w) => w.raw).join(" "),
      "for",
    );
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
      // `eval` keeps its command words in the detailed walk: its argument is a
      // command line the caller can read a second time, and without the leaf
      // "this line is unreadable" would be the only verdict available. `trap`
      // has no such caller, and the fail-closed walk aborts on both.
      if (command === "eval" && this.softErrors !== null) {
        this.softErrors.push("eval");
      } else {
        throw new Unsupported("eval", `\`${command}\` is dynamic execution`);
      }
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
          // `<(…)` / `>(…)` runs a full command list before the leaf does. The
          // detailed walk collects the leaves of that body so the caller can
          // judge a deletion inside it by the same rules, and records the
          // construct itself: process substitution is still never reducible to
          // a plain command, so the fail-closed walk keeps aborting on it.
          if (this.softErrors !== null) {
            this.softErrors.push("process-substitution");
            this.emitSubstitutionLeaves(
              part.text.slice(2, part.text.endsWith(")") ? -1 : undefined),
            );
            reasons.push("command-substitution");
            break;
          }
          throw new Unsupported(
            "process-substitution",
            `process substitution in \`${w.raw}\``,
          );
      }
    }
  }

  // ── Assignments / scope ───────────────────────────────────────────────────

  /** Note a write to a shell variable for the callers that place its value. */
  private recordAssignment(
    a: { name: string; valueParts: WordPart[] },
    rhs: string,
    source?: "read" | "for",
    value: string | null = null,
  ): void {
    // A write inside a function body has not happened yet: recording it would
    // let a later command on the same line read a value the shell does not set
    // until the function is called.
    if (this.suppressed > 0) return;
    this.assignments.push({
      visibleFrom: this.leaves.length,
      name: a.name,
      value: source === undefined ? value : null,
      rhs,
      ...(source === undefined ? {} : { source }),
      ...(this.subshellId() === 0 ? {} : { subshell: this.subshellId() }),
    });
  }

  /** Id of the innermost subshell this walk is inside, or 0 at top level. */
  private subshellId(): number {
    return this.subshellStack[this.subshellStack.length - 1] ?? 0;
  }

  /** Hand out the next subshell id, shared across nested walks. */
  private nextSubshellId(): number {
    const id = this.stats.nextSubshellId ?? 1;
    this.stats.nextSubshellId = id + 1;
    return id;
  }

  /**
   * Walk a function body: its commands are judged like any others, its writes
   * are not. `f(){ rm -rf ../..; }` deletes exactly what `rm -rf ../..` deletes,
   * but `f(){ D=/tmp; }; rm -rf $D` deletes whatever `$D` was before the call.
   */
  private walkFunctionBody(body: StmtNode[]): void {
    this.suppressed++;
    try {
      // Fresh scope: which variables the call site holds is not knowable from
      // a definition, so everything the body reads stays unknown.
      this.walkProgram(body, new Map());
    } finally {
      this.suppressed--;
    }
  }

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
    const depth = this.depth + 1;
    this.stats.maxNesting = Math.max(this.stats.maxNesting, depth);
    if (depth > MAX_SUBSTITUTION_DEPTH) {
      this.stats.aborted = true;
      throw new Unsupported(
        "too-complex",
        `command substitution nests deeper than ${MAX_SUBSTITUTION_DEPTH}`,
      );
    }
    const sub = new BashSemantics(this.stats, depth, this.softErrors);
    const result = sub.run(text);
    if (result.status !== "ok") {
      throw new Unsupported(
        result.status === "unsupported" ? result.reason : "syntax",
        `command substitution body \`${text}\``,
      );
    }
    const base = this.leaves.length;
    // A substitution inside a subshell runs there too: its leaves inherit the
    // id, or a caller tracking values would let them read the outer shell.
    const subshell = this.subshellId();
    if (subshell !== 0) {
      for (const leaf of result.leaves) {
        if (leaf.subshell === undefined) leaf.subshell = subshell;
      }
    }
    this.leaves.push(...result.leaves);
    // Subshell ranges inside the substitution are leaf indices of its own walk:
    // shift them by where its leaves landed here.
    for (const range of sub.subshells) {
      this.subshells.push({ start: range.start + base, end: range.end + base });
    }
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
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
          scope.set(name, UNKNOWN);
          this.recordAssignment({ name, valueParts: [] }, "", "read");
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

/**
 * The value of an assignment right-hand side when it can be known statically:
 * literal text, and references to variables that already hold one. `null` when
 * anything in it still has to be expanded first (`$(…)`, a backtick, a
 * variable whose value is not known). Quotes are literal text, so `D='..'`
 * has the value `..`.
 *
 * Taking references into account is what makes `V=abc; D=/tmp/$V` place `D`:
 * the shell sets it to `/tmp/abc` before the next command runs, so a check
 * that stopped at `$V` would be claiming not to know a path it does know.
 */
function knownValue(parts: WordPart[], scope: Scope): string | null {
  let out = "";
  for (const part of parts) {
    if (part.t === "lit") {
      out += part.v;
      continue;
    }
    if (part.t !== "var") return null;
    const value = resolveVar(part.name, scope);
    if (value === UNKNOWN || value === MULTIWORD || value === SPECIAL_SINGLE) {
      return null;
    }
    out += value;
  }
  return out;
}

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

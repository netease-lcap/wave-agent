/**
 * The one removal a session must not be able to make on its own: deleting the
 * directory it works in, or a parent of it.
 *
 * Why this exists: a delegated agent once ran `rm -rf ../..` from a worktree and
 * deleted the main checkout. Claude Code stops that in the Bash tool's
 * permission check with a decision no allow rule, `--allowedTools` entry,
 * `PreToolUse "allow"` or bypass mode can override; the spec is
 * `docs/specs/core/tool-permission-system.md`「删除自身工作目录的内建硬闸」.
 * Wave already has the layer that means "this card must show at all"
 * (`PermissionManager`'s ask band), so what was missing is only the judgment.
 *
 * The judgment is pure path arithmetic on the resolved target: does it name a
 * protected root, or one of their ancestors? Deliberately **not** "which
 * directory is the repository root" — that needs `.git` probing and breaks in a
 * worktree, whereas "a parent of my working directory" covers both shapes: with
 * a worktree the main checkout is a parent of the worktree cwd, without one the
 * repository root *is* the cwd.
 *
 * Judged from the parser's leaves, never by scanning the raw text: `a && rm -rf
 * ..`, `sudo rm -rf ..`, `cd /x && rm -rf /x` and `bash -c 'rm -rf ..'` all have
 * to be seen, and quoted text like `echo "rm -rf .."` must not.
 */

import os from "node:os";
import path from "node:path";
import { analyzeShellCommand } from "./shellCommandAnalysis.js";
import { toWindowsPath } from "../path.js";
import {
  isCriticalSystemDirectory,
  isFilesystemRoot,
  isHomeDirectoryPath,
  isPathAtOrAbove,
} from "../pathSafety.js";

/** Which rule a target broke — the message and the telemetry key hang off it. */
export type DangerousRemovalRule =
  /** A protected root (the session's workdir, an additional directory) or an ancestor of one. */
  | "working_directory"
  /** The user's home directory itself. */
  | "home"
  /** A filesystem root. */
  | "root"
  /** A first-level system directory (`/etc`, `C:\Windows`). */
  | "system"
  /** The target cannot be resolved before the command runs (variable, command substitution). */
  | "unresolvable";

export interface DangerousRemoval {
  rule: DangerousRemovalRule;
  /** The target exactly as the model wrote it. */
  target: string;
  /** Where it resolves to; empty when the target cannot be resolved in advance. */
  resolved: string;
}

export interface DangerousRemovalInput {
  command: string;
  /** The directory relative targets resolve against (the shell's current directory). */
  workdir: string;
  /** Directories whose removal, or whose ancestor's removal, ends the session. */
  protectedRoots: string[];
}

/** Commands whose job is to delete. Aligned with Claude Code, which checks `rm` and `rmdir`. */
const REMOVAL_COMMANDS: ReadonlySet<string> = new Set(["rm", "rmdir"]);

/**
 * Wrappers that run the command after them. A `sudo rm -rf ..` is the same act
 * as `rm -rf ..`, so the wrapper is peeled off before the command is judged.
 *
 * The value is the set of the wrapper's own flags that consume the next word
 * (`sudo -u root`, `nice -n 5`), so the value is not mistaken for the command.
 */
const WRAPPERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    "sudo",
    new Set([
      "-u",
      "-g",
      "-p",
      "-c",
      "-C",
      "-h",
      "-r",
      "-t",
      "-T",
      "-U",
      "-R",
      "-D",
    ]),
  ],
  ["doas", new Set(["-u", "-C"])],
  ["env", new Set(["-u", "-C", "-S", "--unset", "--chdir", "--split-string"])],
  ["command", new Set()],
  ["builtin", new Set()],
  ["exec", new Set(["-a"])],
  ["nohup", new Set()],
  ["time", new Set(["-f", "-o", "--format", "--output"])],
  ["nice", new Set(["-n", "--adjustment"])],
  ["ionice", new Set(["-c", "-n", "-p"])],
  ["stdbuf", new Set(["-i", "-o", "-e"])],
  ["chronic", new Set()],
]);

/** Shells whose `-c <script>` argument is itself a command line to judge. */
const INLINE_SHELLS: ReadonlySet<string> = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "mksh",
  "ash",
  "busybox",
]);

/** `sh -c` inside `sh -c` inside …; past this the shape is not worth chasing. */
const MAX_NESTING = 4;

/** A leading `NAME=value` word — an environment assignment, not a command. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Does [input.command] delete something the session must not lose?
 *
 * Returns the first offending target, or `null`. A command the parser cannot
 * statically reduce (`eval`, heredocs, arithmetic, process substitution) is not
 * judged here: the permission layer already refuses to auto-allow those, and
 * guessing from the raw text is how a guard starts refusing `echo "rm -rf .."`.
 */
export function findDangerousRemoval(
  input: DangerousRemovalInput,
): DangerousRemoval | null {
  const roots = normalizeRoots([input.workdir, ...input.protectedRoots]);
  const cwd = path.resolve(toWindowsPath(input.workdir));
  return scanCommand(input.command, cwd, roots, 0);
}

function normalizeRoots(roots: string[]): string[] {
  const resolved = roots
    .filter((root) => typeof root === "string" && root.trim().length > 0)
    .map((root) => path.resolve(toWindowsPath(root)));
  return [...new Set(resolved)];
}

function scanCommand(
  command: string,
  startCwd: string,
  roots: string[],
  depth: number,
): DangerousRemoval | null {
  if (depth > MAX_NESTING) return null;
  const analysis = analyzeShellCommand("bash", command);
  if (analysis.status !== "ok") {
    // The parser fails closed on a bare `&` (a background job), which is the
    // one construct whose reading is unambiguous for this question: `rm -rf ..`
    // in the background deletes exactly what `rm -rf ..` deletes. Without this
    // a trailing `&` would make the whole guard blink.
    const desugared = desugarBackgroundJobs(command);
    return desugared === command
      ? null
      : scanCommand(desugared, startCwd, roots, depth);
  }

  let cwd = startCwd;
  for (const leaf of analysis.leaves) {
    const { name, args } = unwrapLeaf(leaf.argv);
    if (!name) continue;

    if (name === "cd") {
      const next = directoryAfterCd(args, cwd);
      if (next) cwd = next;
      continue;
    }

    const script = inlineShellScript(name, args);
    if (script !== undefined) {
      const hit = scanCommand(script, cwd, roots, depth + 1);
      if (hit) return hit;
      continue;
    }

    if (!REMOVAL_COMMANDS.has(name)) continue;
    const { targets, exitsWithoutRemoving, removesParents } = removalTargets(
      name,
      args,
    );
    if (exitsWithoutRemoving) continue;
    for (const target of targets) {
      // The shell's current directory is protected along with the session's
      // roots: `cd /x && rm -rf /x` has to be caught, and so does `rm -rf .`
      // after a `cd` that moved the shell out of the safe zone.
      const hit = judgeTarget(target, cwd, [cwd, ...roots], removesParents);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Rewrite a bare `&` (a background job) as `;` so the parser can read the
 * command. Left alone: `&&` (`a && b`), and `&` that belongs to a redirection
 * (`2>&1`, `&> log`).
 */
function desugarBackgroundJobs(command: string): string {
  let out = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;

    if (quote) {
      out += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      out += char;
      continue;
    }
    if (char === "\\") {
      out += char + (command[i + 1] ?? "");
      i++;
      continue;
    }
    const partOfOperator = command[i - 1] === ">" || command[i + 1] === ">";
    if (char === "&" && command[i + 1] !== "&" && !partOfOperator) {
      out += ";";
      continue;
    }
    out += char;
  }

  return out;
}

/** `rm` / `/bin/rm` / `RM.EXE` → `rm`. */
function commandName(word: string): string {
  return path
    .basename(toWindowsPath(word))
    .replace(/\.exe$/i, "")
    .toLowerCase();
}

/**
 * Peel environment assignments and wrappers off a leaf: `sudo -u root rm -rf ..`
 * → `{ name: "rm", args: ["-rf", ".."] }`.
 */
function unwrapLeaf(argv: string[]): { name: string; args: string[] } {
  let index = 0;
  while (index < argv.length && ENV_ASSIGNMENT.test(argv[index]!)) index++;

  while (index < argv.length) {
    const name = commandName(argv[index]!);
    const valueFlags = WRAPPERS.get(name);
    if (!valueFlags) break;
    index++;
    while (index < argv.length && argv[index]!.startsWith("-")) {
      const flag = argv[index]!;
      index++;
      if (valueFlags.has(flag)) index++;
    }
    while (index < argv.length && ENV_ASSIGNMENT.test(argv[index]!)) index++;
  }

  if (index >= argv.length) return { name: "", args: [] };
  return { name: commandName(argv[index]!), args: argv.slice(index + 1) };
}

/**
 * Where a `cd` leaf leaves the shell. `null` means "cannot tell" (`cd -`,
 * `cd $DIR`), in which case the previous directory stays the reference — the
 * wrong direction to be clever about, since a stale cwd only makes the check
 * name a different directory, never skip a real one.
 */
function directoryAfterCd(args: string[], cwd: string): string | null {
  const rest = args.filter((arg) => !arg.startsWith("-"));
  if (args.includes("-")) return null;
  if (rest.length === 0) return os.homedir(); // bare `cd` goes home

  const scanned = scanWord(rest[0]!);
  if (scanned.dynamic) return null;
  const expanded = expandHome(scanned.text);
  if (expanded === null) return null;
  return path.resolve(cwd, toWindowsPath(expanded));
}

/**
 * The script a `sh -c <script>` leaf would run, or `undefined` when the leaf is
 * not an inline shell.
 */
function inlineShellScript(name: string, args: string[]): string | undefined {
  if (!INLINE_SHELLS.has(name)) return undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") break;
    // `-c`, `-lc`, `-ec`: a short-flag cluster that ends in `c`.
    if (!arg.startsWith("-") || !/^-[A-Za-z]*c$/.test(arg)) continue;
    const script = args[i + 1];
    return script === undefined ? undefined : scanWord(script).text;
  }
  return undefined;
}

/**
 * The targets of an `rm` / `rmdir` call: everything that is not a flag.
 *
 * `--` ends the flags, and `--help` / `--version` mean nothing is deleted at
 * all, so a command carrying one has no target worth judging. `rmdir -p` walks
 * up from each target, removing every directory on the way — `removesParents`.
 */
function removalTargets(
  name: string,
  args: string[],
): {
  targets: string[];
  exitsWithoutRemoving: boolean;
  removesParents: boolean;
} {
  const targets: string[] = [];
  const flags: string[] = [];
  let exitsWithoutRemoving = false;
  let endOfFlags = false;

  for (const arg of args) {
    if (!endOfFlags && arg === "--") {
      endOfFlags = true;
      continue;
    }
    if (!endOfFlags && arg.startsWith("-") && arg.length > 1) {
      flags.push(arg);
      if (arg === "--help" || arg === "--version") exitsWithoutRemoving = true;
      continue;
    }
    targets.push(arg);
  }

  const removesParents =
    name === "rmdir" &&
    flags.some(
      (flag) => flag === "--parents" || /^-[A-Za-z]*p[A-Za-z]*$/.test(flag),
    );

  return { targets, exitsWithoutRemoving, removesParents };
}

/**
 * Split one word as the shell would see it: quotes removed, and whether its
 * value can only be known after expansion (`$X`, `$(…)`, backticks).
 *
 * Single quotes make `$` literal, so `rm -rf '$DIR'` is an ordinary (if oddly
 * named) path and must not be reported as unresolvable.
 */
function scanWord(raw: string): { text: string; dynamic: boolean } {
  let text = "";
  let dynamic = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]!;

    if (quote === "'") {
      if (char === "'") quote = null;
      else text += char;
      continue;
    }

    if (char === "\\") {
      const next = raw[i + 1];
      if (next !== undefined) {
        text += next;
        i++;
      }
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = null;
        continue;
      }
      if (char === "$" || char === "`") dynamic = true;
      text += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "$" || char === "`") dynamic = true;
    text += char;
  }

  return { text, dynamic };
}

/** `~` / `~/x` → the home directory, `~user/x` → `null` (unknown user). */
function expandHome(text: string): string | null {
  if (!text.startsWith("~")) return text;
  if (text === "~") return os.homedir();
  if (text.startsWith("~/")) return path.join(os.homedir(), text.slice(2));
  return null;
}

/** A glob character: whatever it matches is unknown before the command runs. */
const GLOB_CHAR = /[*?[]/;

/**
 * Judge one removal target.
 *
 * A glob is judged by its static prefix rather than the whole word: `rm -rf
 * build/*` clears a directory inside the project (an ordinary, still-confirmed
 * operation), while `rm -rf /*` and `rm -rf ../*` name the root or a parent. A
 * bare `*` is the contents of the current directory — not the directory — so it
 * is not this rule's business either. A target holding a variable cannot be
 * checked in advance at all, which is Claude Code's "unresolvable" family; it is
 * reported rather than skipped, because skipping it is a documented way around
 * every static check.
 */
function judgeTarget(
  rawTarget: string,
  cwd: string,
  protectedRoots: string[],
  removesParents = false,
): DangerousRemoval | null {
  const scanned = scanWord(rawTarget);
  if (scanned.dynamic) {
    return { rule: "unresolvable", target: rawTarget, resolved: "" };
  }

  let candidate = scanned.text;
  const globIndex = candidate.search(GLOB_CHAR);
  if (globIndex >= 0) {
    const prefix = candidate.slice(0, globIndex);
    const trimmed = prefix.replace(/[\\/]+$/, "");
    if (trimmed === "") {
      // `*` is the contents of the current directory, not the directory: this
      // rule is about the directory itself. `/*` keeps its separator and names
      // the root, which is exactly the case worth stopping.
      if (prefix === "") return null;
      candidate = prefix;
    } else {
      candidate = trimmed;
    }
    // `./*` / `.//*`: the contents of the current directory again.
    if (candidate === ".") return null;
  }
  if (candidate === "") return null;

  const expanded = expandHome(candidate);
  if (expanded === null) {
    return { rule: "unresolvable", target: rawTarget, resolved: "" };
  }

  const resolved = path.resolve(cwd, toWindowsPath(expanded));

  // `rmdir -p a/b` removes `a/b`, then `a`, then `a`'s parent, and so on: every
  // directory on the way to the root is a target, so every one of them is
  // judged.
  if (removesParents) {
    for (
      let current = resolved;
      current !== path.dirname(current);
      current = path.dirname(current)
    ) {
      const hit = judgeResolvedPath(current, rawTarget, protectedRoots);
      if (hit) return hit;
    }
  }

  return judgeResolvedPath(resolved, rawTarget, protectedRoots);
}

/** The four ways a resolved path can be one we must not delete. */
function judgeResolvedPath(
  resolved: string,
  rawTarget: string,
  protectedRoots: string[],
): DangerousRemoval | null {
  const hit = (rule: DangerousRemovalRule): DangerousRemoval => ({
    rule,
    target: rawTarget,
    resolved,
  });

  if (isFilesystemRoot(resolved)) return hit("root");
  if (isHomeDirectoryPath(resolved)) return hit("home");
  if (protectedRoots.some((root) => isPathAtOrAbove(resolved, root))) {
    return hit("working_directory");
  }
  if (isCriticalSystemDirectory(resolved)) return hit("system");
  return null;
}

/**
 * The one-line reason the confirmation card shows (and the model reads when the
 * mode refuses instead of asking). Written for a person deciding, so it names
 * the path rather than the rule.
 */
export function describeDangerousRemoval(hit: DangerousRemoval): string {
  switch (hit.rule) {
    case "unresolvable":
      return `This command deletes "${hit.target}", whose value cannot be checked before it runs. It is refused unless approved explicitly and cannot be covered by an allow rule or a bypass mode.`;
    case "working_directory":
      return `This command deletes ${hit.resolved}, which contains the session's working directory. It needs explicit approval and cannot be covered by an allow rule or a bypass mode.`;
    case "home":
      return `This command deletes the user's home directory (${hit.resolved}). It needs explicit approval and cannot be covered by an allow rule or a bypass mode.`;
    case "root":
      return `This command deletes a filesystem root (${hit.resolved}). It needs explicit approval and cannot be covered by an allow rule or a bypass mode.`;
    case "system":
      return `This command deletes a system directory (${hit.resolved}). It needs explicit approval and cannot be covered by an allow rule or a bypass mode.`;
  }
}

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
 *
 * The polarity is the important part, and it is Claude Code's: a command whose
 * deletion this check can *prove* is ordinary is ordinary; a deletion it cannot
 * place — the line will not parse, the target is spelled in a way Git Bash may
 * read differently, the command deletes through a channel that is not `rm` —
 * lands on "must be confirmed by a person", never on "allowed". Silence is the
 * one answer this check is not allowed to give about something it did not
 * understand, because "make it unreadable" would otherwise be the way around it.
 */

import os from "node:os";
import path from "node:path";
import { analyzeShellCommand } from "./shellCommandAnalysis.js";
import { restoreWindowsPath } from "../path.js";
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
  | "unresolvable"
  /** A backslash-only target (`rm -rf \`): the drive root in Git Bash on Windows. */
  | "backslash_only"
  /** A Windows path Git Bash may read differently, so where it lands is unknown. */
  | "unplaceable"
  /** A command that deletes through a channel this check cannot read. */
  | "unverifiable"
  /** The command line cannot be read, and it names a removal. */
  | "unparsable";

export interface DangerousRemoval {
  rule: DangerousRemovalRule;
  /** The target exactly as the model wrote it (the command line, for `unparsable`). */
  target: string;
  /** Where it resolves to; empty when the target cannot be resolved in advance. */
  resolved: string;
  /** For the "cannot be checked" rules: which failure this is, in the card's words. */
  detail?: string;
}

export interface DangerousRemovalInput {
  command: string;
  /** The directory relative targets resolve against (the shell's current directory). */
  workdir: string;
  /** Directories whose removal, or whose ancestor's removal, ends the session. */
  protectedRoots: string[];
  /**
   * The platform the command will run on. Defaults to this process's, and exists
   * so the Windows-only judgments below can be exercised on any host: they are
   * statements about Git Bash and drive letters, not about the machine running
   * the test.
   */
  platform?: NodeJS.Platform;
}

/** Commands whose job is to delete. Aligned with Claude Code, which checks `rm` and `rmdir`. */
const REMOVAL_COMMANDS: ReadonlySet<string> = new Set(["rm", "rmdir"]);

/**
 * Commands that delete through a channel this check cannot read: their command
 * line belongs to another shell, or their targets arrive on stdin.
 *
 * Claude Code keeps the same family (`o9`: the shells that take their command
 * line elsewhere — `cmd`, `powershell`, `pwsh`, `wsl`, `su`, `fish`, `csh`, …),
 * because "the deletion is not an `rm`" is not the same statement as "there is
 * no deletion". Windows is where this matters: `powershell -Command
 * "Remove-Item -Recurse -Force D:\"` is the ordinary way to delete a tree there,
 * and a guard that only understands `rm` waves it straight through.
 */
const FOREIGN_SHELLS: ReadonlySet<string> = new Set([
  "cmd",
  "powershell",
  "pwsh",
  "wsl",
  "su",
  "runuser",
  "toybox",
  "fish",
  "csh",
  "tcsh",
  "rsh",
  "hush",
  "rbash",
]);

/**
 * Shells whose script this check *can* read when it is on the command line
 * (`bash -c '…'`) and cannot read when it is a file (`bash deploy.sh`). Declared
 * next to {@link INLINE_SHELLS}, which it extends.
 */

/** `xargs` / `parallel`: the arguments are a command, its targets come from stdin. */
const STDIN_ARG_COMMANDS: ReadonlySet<string> = new Set(["xargs", "parallel"]);

/** `xargs` flags that consume the next word, so it is not mistaken for the command. */
const STDIN_ARG_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "-I",
  "-n",
  "-L",
  "-P",
  "-s",
  "-d",
  "-E",
  "-a",
  "--arg-file",
  "--delimiter",
  "--max-args",
  "--max-lines",
  "--max-procs",
  "--max-chars",
  "--eof",
  "--replace",
]);

/**
 * `robocopy <src> <dst> [files…] <options>`. It copies, except when it is told
 * to mirror or move — then one side is emptied to match the other. Claude Code
 * only interprets its exit codes; this is the same family as the deleters above,
 * filled in on our side.
 */
const ROBOCOPY = "robocopy";
const ROBOCOPY_PURGE_SWITCH = /^\/(?:MIR|PURGE|MOV|MOVE)$/i;

/** Wrappers that run the command after them. A `sudo rm -rf ..` is the same act
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

/**
 * Shells whose script this check can read when it is on the command line
 * (`bash -c '…'`) and cannot read when it is a file (`bash deploy.sh`). The
 * second half is the unverifiable family: the deletion is in a file, and this
 * check does not open files.
 */
const SCRIPT_SHELLS: ReadonlySet<string> = new Set([
  ...INLINE_SHELLS,
  ...FOREIGN_SHELLS,
]);

/** `sh -c` inside `sh -c` inside …; past this the shape is not worth chasing. */
const MAX_NESTING = 4;

/** A leading `NAME=value` word — an environment assignment, not a command. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * A word in a line this check cannot read that names a deletion. Only consulted
 * when the parser gives up on the line: the guard must not blink on
 * `rm -rf ../..` because of a heredoc elsewhere on the same line, and must not
 * start asking about every heredoc either.
 */
const REMOVAL_HINT =
  /(?:^|[\s;&|()'"`\\/])(?:rm|rmdir|rd|del|erase|rimraf|sdelete|shred|robocopy|remove-item|xargs|parallel|cmd|powershell|pwsh|wsl)(?=$|[\s;&|()'"`])/i;

/** Everything the walk carries along: the protected roots and the target platform. */
interface Judgement {
  roots: string[];
  platform: NodeJS.Platform;
}

/**
 * Does [input.command] delete something the session must not lose?
 *
 * Returns the first offending target, or `null`. Silence means "this check read
 * the command and found nothing to stop" — so anything it could not read has to
 * come back as a hit instead: {@link DangerousRemovalRule} carries one member
 * per way of not knowing (`unparsable`, `unplaceable`, `unverifiable`).
 */
export function findDangerousRemoval(
  input: DangerousRemovalInput,
): DangerousRemoval | null {
  const judgement: Judgement = {
    roots: normalizeRoots([input.workdir, ...input.protectedRoots]),
    platform: input.platform ?? process.platform,
  };
  const cwd = path.resolve(restoreWindowsPath(input.workdir));
  return scanCommand(input.command, cwd, judgement, 0);
}

function normalizeRoots(roots: string[]): string[] {
  const resolved = roots
    .filter((root) => typeof root === "string" && root.trim().length > 0)
    .map((root) => path.resolve(restoreWindowsPath(root)));
  return [...new Set(resolved)];
}

function scanCommand(
  command: string,
  startCwd: string,
  judgement: Judgement,
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
    if (desugared !== command) {
      return scanCommand(desugared, startCwd, judgement, depth);
    }
    // A lone `\` at the end of the line escapes the character after it — nothing,
    // in practice — so the parser rejects the whole line as unbalanced. On
    // Windows that is also how a drive root (`rm -rf \`) and a directory written
    // with a trailing separator (`rm -rf D:/proj/x-tb\`) are spelled, which are
    // exactly the two shapes Claude Code reports specifically. Naming them here
    // keeps the card's reason honest instead of "cannot be parsed".
    if (analysis.reason === "syntax" && judgement.platform === "win32") {
      const tail = trailingBackslashWord(command);
      if (tail !== null) {
        return BACKSLASH_ONLY.test(tail)
          ? backslashOnly(tail, startCwd)
          : { rule: "unplaceable", target: tail, resolved: "" };
      }
    }
    // Nothing in this line can be judged — and, for the same reason, nothing in
    // it can be cleared. Returning `null` here (the old behaviour) made "write
    // something the parser does not understand" a way past the guard: `rm -rf
    // ../..` next to a heredoc, an unbalanced quote or an arithmetic expansion
    // was simply not looked at. It is reported only when the line names a
    // removal at all, so an ordinary heredoc write stays ordinary.
    return REMOVAL_HINT.test(command)
      ? {
          rule: "unparsable",
          target: command.trim(),
          resolved: "",
          detail: unreadableReason(analysis.reason),
        }
      : null;
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
      const hit = scanCommand(script, cwd, judgement, depth + 1);
      if (hit) return hit;
      continue;
    }

    // An inline shell invoked with no script of its own — `bash`, `bash -l`,
    // `command -v bash` — has no command line to delete with, so there is
    // nothing here to read. Claude Code stops in the same place: its script
    // reader returns nothing unless it finds `-c <script>`, and the removal
    // scan then stays silent. Without this, a probe as harmless as `command -v
    // bash` opened the card by itself — the wrapper is peeled, the shell is
    // left bare, and it fell through to the unreadable branch below.
    if (INLINE_SHELLS.has(name) && !namesAScript(args)) continue;

    // A leaf whose script is a file, or whose command line belongs to another
    // shell, or that feeds its targets in on stdin: the deletion — if there is
    // one — is real and this check cannot see it. Reported rather than skipped,
    // which is what "a `powershell -Command` is not an `rm`" used to mean.
    if (SCRIPT_SHELLS.has(name)) return unverifiable(leaf.text, name);
    const piped = pipedRemoval(name, args);
    if (piped) return unverifiable(leaf.text, name);

    const deletes =
      name === ROBOCOPY
        ? robocopyTargets(args)
        : REMOVAL_COMMANDS.has(name)
          ? removalTargetsFor(name, args)
          : null;
    if (deletes === null) continue;
    const { targets, exitsWithoutRemoving, removesParents } = deletes;
    if (exitsWithoutRemoving) continue;
    for (const target of targets) {
      // The shell's current directory is protected along with the session's
      // roots: `cd /x && rm -rf /x` has to be caught, and so does `rm -rf .`
      // after a `cd` that moved the shell out of the safe zone.
      const hit = judgeTarget(target, cwd, judgement, removesParents);
      if (hit) return hit;
    }
  }
  return null;
}

/** A hit for a deletion this check cannot read, naming the command that hides it. */
function unverifiable(text: string, name: string): DangerousRemoval {
  return { rule: "unverifiable", target: text, resolved: "", detail: name };
}

/** `rm -rf \` — read by Git Bash as the drive root of [cwd]. */
function backslashOnly(target: string, cwd: string): DangerousRemoval {
  const root = path.resolve(cwd).slice(0, 2);
  return {
    rule: "backslash_only",
    target,
    resolved: /^[A-Za-z]:$/.test(root) ? root + "\\" : "",
  };
}

/**
 * The last word of a line that ends in an unescaped backslash, or `null`.
 *
 * Only consulted for a line the parser rejected as unbalanced: a trailing
 * backslash is the one spelling where the reason it cannot be read *is* the
 * target, so the word it ends with is worth naming in the card.
 */
function trailingBackslashWord(command: string): string | null {
  const match = /(?:^|[\s"'`(])([^\s"'`()]*\\+)$/.exec(command.trim());
  return match ? match[1]! : null;
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

/**
 * `rm` / `/bin/rm` / `RM.EXE` / `RMDIR.BAT` → `rm`. Every suffix a Windows shell
 * accepts is stripped, in Claude Code's set: `.exe`, `.bat`, `.cmd`, `.com`.
 */
function commandName(word: string): string {
  return path
    .basename(restoreWindowsPath(word))
    .replace(/\.(?:exe|bat|cmd|com)$/i, "")
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
  return path.resolve(cwd, restoreWindowsPath(expanded));
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
 * Does an inline shell leaf name a script of its own — a file (`bash deploy.sh`),
 * as opposed to nothing but its own flags (`bash -l`, `bash --version`)?
 *
 * Only the file shape can hide a deletion, and only a script is worth opening
 * the question for; a shell started with nothing but flags runs no command line
 * of its own. `-o pipefail` / `+o pipefail` take their value from the next word,
 * so that word is a setting, not a script.
 */
function namesAScript(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") return i + 1 < args.length;
    if (!arg.startsWith("-") && !arg.startsWith("+")) return true;
    if (/^[-+]o$/.test(arg)) i++;
  }
  return false;
}

/**
 * The targets of an `rm` / `rmdir` call: everything that is not a flag.
 *
 * `--` ends the flags, and `--help` / `--version` mean nothing is deleted at
 * all, so a command carrying one has no target worth judging. `rmdir -p` walks
 * up from each target, removing every directory on the way — `removesParents`.
 */
function removalTargetsFor(name: string, args: string[]): RemovalTargets {
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

interface RemovalTargets {
  targets: string[];
  exitsWithoutRemoving: boolean;
  removesParents: boolean;
}

/**
 * The directories a `robocopy` call can empty, or `null` when it only copies.
 *
 * `robocopy <src> <dst> [files…] <options>`; a mirror or move switch empties one
 * side to match the other, so both positionals are targets. Claude Code has no
 * such branch — it reads robocopy's exit codes and nothing else — so this is the
 * same family filled in rather than copied.
 */
function robocopyTargets(args: string[]): RemovalTargets | null {
  if (!args.some((arg) => ROBOCOPY_PURGE_SWITCH.test(arg))) return null;
  const positionals = args.filter((arg) => !arg.startsWith("/")).slice(0, 2);
  return {
    targets: positionals,
    exitsWithoutRemoving: false,
    removesParents: false,
  };
}

/**
 * Does an `xargs` / `parallel` leaf hand its targets in on stdin?
 *
 * Only when the command it runs is itself a deletion: `find . | xargs grep TODO`
 * is a read, and reading its target list from a pipe is exactly what it is for.
 */
function pipedRemoval(name: string, args: string[]): boolean {
  if (!STDIN_ARG_COMMANDS.has(name)) return false;
  let index = 0;
  while (index < args.length) {
    const arg = args[index]!;
    if (arg === "--") {
      index++;
      break;
    }
    if (!arg.startsWith("-")) break;
    index += STDIN_ARG_VALUE_FLAGS.has(arg) ? 2 : 1;
  }
  const word = args[index];
  if (word === undefined) return false;
  const target = commandName(word);
  return (
    REMOVAL_COMMANDS.has(target) ||
    SCRIPT_SHELLS.has(target) ||
    target === ROBOCOPY ||
    STDIN_ARG_COMMANDS.has(target)
  );
}

/** Why a line this check cannot read could not be read, in the card's words. */
function unreadableReason(reason: string): string {
  switch (reason) {
    case "heredoc":
      return "a heredoc body cannot be read as commands";
    case "process-substitution":
      return "process substitution cannot be read in advance";
    case "arithmetic-expansion":
      return "arithmetic expansion cannot be read in advance";
    case "brace-expansion":
      return "brace expansion cannot be read in advance";
    case "eval":
      return "eval runs code this check cannot read";
    case "syntax":
      return "its quoting or grouping is unbalanced";
    case "too-complex":
      return "it nests deeper than this check reads";
    default:
      return "it uses a shell construct this check does not model";
  }
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

/** `\` — the whole target, nothing but backslashes. */
const BACKSLASH_ONLY = /^\\+$/;

/** `\\?\D:\x` — a drive path whose only oddity is the namespace prefix. */
const VERBATIM_DRIVE = /^[\\/]{2}\?\\[A-Za-z]:/;

/**
 * Is this a Windows path Git Bash may read differently from this check?
 *
 * Claude Code's test (`Yot`), copied whole, because the two halves are two
 * different mistakes:
 *
 * - `D:x` — a drive-*relative* path, which PowerShell and Windows APIs resolve
 *   against that drive's current directory and Git Bash reads as a plain name.
 * - `D:/x/` (or `D:/a/../b`) — a drive path whose remainder is not already
 *   normalised, so the trailing separator or the `.`/`..` segment may be
 *   interpreted on the way in. `rm -rf D:/proj/x-tb\` is this half: written with
 *   a trailing backslash, it is either the directory or one level of surprise.
 *
 * Where it lands is therefore unknown, and "unknown" is not "allow".
 */
function isWindowsUnplaceablePath(target: string, platform: NodeJS.Platform) {
  if (platform !== "win32") return false;
  const slashed = target.replace(/\\/g, "/");
  const withoutDrive = slashed.replace(/^[A-Za-z]:(?=\/)/, "");
  return (
    /^[A-Za-z]:[^/]/.test(slashed) ||
    (withoutDrive.startsWith("/") &&
      !/^\/\/[^/]/.test(withoutDrive) &&
      path.posix.normalize(withoutDrive) !== withoutDrive)
  );
}

/**
 * The target as it was written, minus one layer of surrounding quotes.
 *
 * Needed next to {@link scanWord} because the two are not the same string: the
 * shell eats `\c` in `E:\code\myrepo` (`E:codemyrepo`, a drive-relative path)
 * but not in `"E:\code\myrepo"`. Both spellings are judged, and either one
 * hitting is enough.
 */
function writtenWord(rawTarget: string): string {
  return rawTarget.replace(/^(["'])([\s\S]*)\1$/, "$2");
}

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
  judgement: Judgement,
  removesParents = false,
): DangerousRemoval | null {
  const scanned = scanWord(rawTarget);
  if (scanned.dynamic) {
    return { rule: "unresolvable", target: rawTarget, resolved: "" };
  }

  const written = writtenWord(rawTarget);

  // `rm -rf \` — Git Bash reads a lone backslash as the drive root, which is the
  // one target where the spelling and the destruction are furthest apart.
  if (judgement.platform === "win32" && BACKSLASH_ONLY.test(written)) {
    return backslashOnly(rawTarget, cwd);
  }

  // `\\?\C:\x` is `C:\x` behind a prefix. The `?` there is namespace syntax,
  // not a glob character, so the path is unwrapped *before* the glob reading
  // below — otherwise `rm -rf "\\?\D:\x"` would be judged as its own prefix.
  // (`\\.\PhysicalDrive0` unwraps to nothing, and `isCriticalSystemDirectory`
  // refuses it: there is no path on a drive to compare.)
  const verbatim = VERBATIM_DRIVE.test(written)
    ? restoreWindowsPath(written)
    : null;

  let candidate = verbatim ?? scanned.text;
  const globIndex = verbatim === null ? candidate.search(GLOB_CHAR) : -1;
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

  // Every spelling of the same target that could reach the filesystem: what the
  // shell will pass, and what was written. Judged in that order so the message
  // names the one that is actually deleted.
  const spellings = [
    verbatim ?? expandHome(written) ?? written,
    expanded,
  ].filter((spelling) => spelling.length > 0);

  for (const spelling of spellings) {
    if (isWindowsUnplaceablePath(spelling, judgement.platform)) {
      return { rule: "unplaceable", target: rawTarget, resolved: "" };
    }
  }

  const protectedRoots = [cwd, ...judgement.roots];
  for (const spelling of spellings) {
    const resolved = path.resolve(cwd, restoreWindowsPath(spelling));
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
    const hit = judgeResolvedPath(resolved, rawTarget, protectedRoots);
    if (hit) return hit;
  }
  return null;
}

/** The ways a resolved path can be one we must not delete. */
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
 *
 * The last four rules are about *not knowing* rather than about a path, so they
 * say what could not be checked and why — Claude Code words its own failure
 * table the same way ("… can't be checked before it runs") — and then say what
 * to write instead, which is the part a model can act on.
 */
export function describeDangerousRemoval(hit: DangerousRemoval): string {
  switch (hit.rule) {
    case "unresolvable":
      return `This command deletes "${hit.target}", whose value cannot be checked before it runs. It is refused unless approved explicitly and cannot be covered by an allow rule or a bypass mode.`;
    case "unparsable":
      return `This command cannot be checked before it runs (${hit.detail ?? "the shell syntax is not one this check reads"}), and it names a deletion. It needs explicit approval and cannot be covered by an allow rule or a bypass mode.`;
    case "unverifiable":
      return `This command runs "${hit.detail}", which deletes through a channel that cannot be checked before it runs. It needs explicit approval and cannot be covered by an allow rule or a bypass mode. Use "rm -rf <path>" with a literal path if you mean to remove a directory.`;
    case "backslash_only":
      return `This command deletes a backslash-only target ("${hit.target}"), which Git Bash reads as the drive root on Windows. It needs explicit approval and cannot be covered by an allow rule or a bypass mode. Write the directory you mean as a path, for example /c/work/build or C:/work/build.`;
    case "unplaceable":
      return `This command deletes "${hit.target}", a Windows path Git Bash may read differently from this check, so where it lands is unknown. It needs explicit approval and cannot be covered by an allow rule or a bypass mode. Write the directory you mean as a plain path, for example C:/work/build.`;
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

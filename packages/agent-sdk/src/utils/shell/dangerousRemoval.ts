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
 * Two Windows spellings are named rather than resolved: a backslash-only
 * target (`rm -rf \`, the drive root in Git Bash) and a drive path the shell may
 * read differently (`E:\code\myrepo` reaches `rm` as the drive-relative
 * `E:codemyrepo`). In both, the spelling and the directory are not the same
 * thing, and "unknown" is not "allow".
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
  isSystemDirectoryName,
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
  /**
   * A relative glob behind a `cd` this check cannot follow (`cd $DIR && rm -rf
   * build/*`): the directory the glob hangs off is unknown, so what it matches is.
   */
  | "relative_glob_after_cd"
  /** A glob crossing more than one directory level (`logs/*` one level deeper), so what it matches is unknown. */
  | "multi_level_glob";

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

/** Wrappers that run the command after them. A `sudo rm -rf ..` is the same act
 * as `rm -rf ..`, so the wrapper is peeled off before the command is judged.
 *
 * The value is the set of the wrapper's own flags that consume the next word
 * (`sudo -u root`, `nice -n 5`), so the value is not mistaken for the command.
 *
 * `timeout` is absent too, but not for the same reason: its wrapped command sits
 * behind a duration word (`timeout 5 rm -rf ..`), which no set of value-flags can
 * express, so it is read by {@link timeoutCommandIndex} instead.
 *
 * `chronic` is deliberately absent: Claude Code peels it nowhere on this
 * question, and every spelling added beyond it is another card that cannot be
 * dismissed or covered by a rule. The command is not lost either way —
 * `chronic rm -rf ..` is still an unknown command name, so it gets the ordinary
 * confirmation.
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
  ["noglob", new Set()],
  ["exec", new Set(["-a"])],
  ["nohup", new Set()],
  ["time", new Set(["-f", "-o", "--format", "--output"])],
  ["nice", new Set(["-n", "--adjustment"])],
  ["ionice", new Set(["-c", "-n", "-p"])],
  ["stdbuf", new Set(["-i", "-o", "-e"])],
]);

/**
 * Shells whose `-c <script>` argument is itself a command line to judge.
 *
 * This is Claude Code's list for the same question (its `f5e`), including the
 * two a session is unlikely to type by hand: `hush` (BusyBox's ash) and
 * `rbash`. A restricted shell refuses some commands but still runs the script
 * it is handed, so `rbash -c 'rm -rf ..'` deletes exactly what the plain
 * spelling does.
 */
const INLINE_SHELLS: ReadonlySet<string> = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "mksh",
  "ash",
  "hush",
  "rbash",
]);

/**
 * Applet multiplexers. `busybox sh -c '…'` runs `sh`; `busybox -c '…'` runs
 * nothing at all, because the word after `busybox` is an applet name, not a flag.
 * Claude Code draws the same line (its `nCr` drops the multiplexer only when a
 * real shell follows it), so the multiplexer is not a shell here either — it is
 * skipped only when it names one.
 */
const MULTI_CALL_BINARIES: ReadonlySet<string> = new Set(["busybox", "toybox"]);

/** A short-flag cluster carrying `c` anywhere (`-c`, `-lc`, `-ce`), as Claude
 * Code reads it — `bash -ce '…'` runs the script just as `bash -c '…'` does. */
const INLINE_SCRIPT_FLAG = /^-[A-Za-z]*c[A-Za-z]*$/;

/** A signal name or number `timeout` accepts (`-s KILL`, `--signal=TERM`). */
const TIMEOUT_SIGNAL = /^[A-Za-z0-9_.+-]+$/;

/** `timeout`'s duration: seconds unless a unit is spelled out (`5`, `2.5m`). */
const TIMEOUT_DURATION = /^\d+(?:\.\d+)?[smhd]?$/;

/** `sh -c` inside `sh -c` inside …; past this the shape is not worth chasing. */
const MAX_NESTING = 4;

/** A leading `NAME=value` word — an environment assignment, not a command. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Everything the walk carries along: the protected roots and the target platform. */
interface Judgement {
  roots: string[];
  platform: NodeJS.Platform;
}

/**
 * Does [input.command] delete something the session must not lose?
 *
 * Returns the first offending target, or `null`. Two Windows spellings are named
 * rather than resolved — a backslash-only target and a drive path the shell may
 * read differently — because in both the spelling and where it lands are not the
 * same thing.
 */
export function findDangerousRemoval(
  input: DangerousRemovalInput,
): DangerousRemoval | null {
  const judgement: Judgement = {
    roots: normalizeRoots([input.workdir, ...input.protectedRoots]),
    platform: input.platform ?? process.platform,
  };
  const cwd = path.resolve(restoreWindowsPath(input.workdir));
  // `false`: at the top level the shell's directory is the session's, by definition.
  return scanCommand(input.command, cwd, judgement, false, 0);
}

function normalizeRoots(roots: string[]): string[] {
  const resolved = roots
    .filter((root) => typeof root === "string" && root.trim().length > 0)
    .map((root) => path.resolve(restoreWindowsPath(root)));
  return [...new Set(resolved)];
}

/**
 * Walk one command line leaf by leaf, judging each removal against the directory
 * the shell is in when it runs.
 *
 * [cwdUnknown] says that directory is no longer known — a `cd` this check cannot
 * follow (`cd $DIR`, `cd -`) happened earlier in the line. Relative targets then
 * still resolve against the *old* directory, which is right for Claude Code's
 * answer (`cd $DIR && rm -rf build` is judged against the session's directory
 * there too) but wrong to trust for a glob: a glob names a set, and the set is
 * the one under a directory nobody knows. `relative_glob_after_cd` is that case.
 */
function scanCommand(
  command: string,
  startCwd: string,
  judgement: Judgement,
  cwdUnknown: boolean,
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
      return scanCommand(desugared, startCwd, judgement, cwdUnknown, depth);
    }
    // A backslash at the very end of the line escapes what follows it — nothing,
    // in practice — so the parser rejects the line as unbalanced while bash hands
    // the command a literal backslash (`bash -c 'ls C:\'` lists `C:\`). Reading the
    // word the line ends with instead of the command would report a removal for
    // every `ls C:\` and `mkdir C:\temp\`; doubling that last backslash is the
    // spelling the parser can read, so the line is judged by what the shell
    // actually removes (`rm -rf \` is the drive root, `ls C:\` removes nothing).
    const repaired = repairTrailingBackslash(command);
    if (repaired !== null) {
      return scanCommand(repaired, startCwd, judgement, cwdUnknown, depth);
    }
    return null;
  }

  let cwd = startCwd;
  for (const leaf of analysis.leaves) {
    const { name, args } = unwrapLeaf(leaf.argv);
    if (!name) continue;

    if (name === "cd") {
      const next = directoryAfterCd(args, cwd);
      // A `cd` this check *can* follow re-establishes the directory, so an
      // earlier unknown one stops mattering here: `cd $DIR && cd /x && rm -rf
      // build/*` is judged against `/x`.
      if (next !== null) {
        cwd = next;
        cwdUnknown = false;
      } else {
        cwdUnknown = true;
      }
      continue;
    }

    const script = inlineShellScript(launcherName(name), args);
    if (script !== undefined) {
      // `bash -c` inherits its parent's directory, known or not.
      const hit = scanCommand(script, cwd, judgement, cwdUnknown, depth + 1);
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
      const hit = judgeTarget(
        target,
        cwd,
        judgement,
        removesParents,
        cwdUnknown,
      );
      if (hit) return hit;
    }
  }
  return null;
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
 * The line with one more backslash at the end, so the parser reads it as the
 * literal backslash bash passes on; `null` when the line does not end in an
 * unescaped one (nothing to repair).
 */
function repairTrailingBackslash(command: string): string | null {
  let run = 0;
  while (command[command.length - 1 - run] === "\\") run++;
  if (run === 0 || run % 2 === 0) return null;
  return command + "\\";
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
 * `rm` / `/bin/rm` / `RM` → `rm`: the path prefix and the case, nothing else.
 *
 * This is the name the removal check compares, and Claude Code compares it the
 * same way — its gate takes the leaf, drops the path and asks whether the result
 * is exactly `rm` / `rmdir` (`bPe`). Windows executable suffixes are therefore
 * *not* stripped: `rm.exe` stays `rm.exe`, which is not a removal there either.
 */
function commandName(word: string): string {
  return path.basename(restoreWindowsPath(word)).toLowerCase();
}

/**
 * The name used to recognise a *wrapper* (`sudo`, `env`) or an inline shell
 * (`bash`), which is normalised more generously than the removal command's own
 * name: Claude Code routes launcher names through `UM`, which drops the path and
 * the `.exe` suffix, so `sudo.exe rm -rf ..` and `bash.exe -c 'rm -rf ..'` are
 * the same act as their plain spellings.
 */
function launcherName(word: string): string {
  return commandName(word).replace(/\.exe$/, "");
}

/**
 * Where `timeout`'s wrapped command starts, or `-1` when the words are not
 * `timeout <flags> <duration> <command>`.
 *
 * `timeout` is the one wrapper a flag table cannot read: the wrapped command is
 * two words away with a duration in between, so the table would take `5` for the
 * command name and stop there. This is Claude Code's grammar for the same
 * question (its `crt`), and it gives up the same way — an unknown flag or a
 * missing duration means nothing is peeled, so `timeout rm -rf ..` stays a
 * `timeout` call on both sides.
 */
function timeoutCommandIndex(argv: string[], start: number): number {
  let index = start + 1;
  while (index < argv.length) {
    const arg = argv[index]!;
    const next = argv[index + 1];
    if (
      arg === "--foreground" ||
      arg === "--preserve-status" ||
      arg === "--verbose"
    ) {
      index++;
    } else if (/^--(?:kill-after|signal)=[A-Za-z0-9_.+-]+$/.test(arg)) {
      index++;
    } else if (
      (arg === "--kill-after" || arg === "--signal") &&
      next &&
      TIMEOUT_SIGNAL.test(next)
    ) {
      index += 2;
    } else if (arg === "--") {
      index++;
      break;
    } else if (arg.startsWith("--")) {
      return -1;
    } else if (arg === "-v") {
      index++;
    } else if (
      (arg === "-k" || arg === "-s") &&
      next &&
      TIMEOUT_SIGNAL.test(next)
    ) {
      index += 2;
    } else if (/^-[ks][A-Za-z0-9_.+-]+$/.test(arg)) {
      index++;
    } else if (arg.startsWith("-")) {
      return -1;
    } else {
      break;
    }
  }
  if (index >= argv.length || !TIMEOUT_DURATION.test(argv[index]!)) return -1;
  return index + 1;
}

/**
 * Peel environment assignments and wrappers off a leaf: `sudo -u root rm -rf ..`
 * → `{ name: "rm", args: ["-rf", ".."] }`.
 */
function unwrapLeaf(argv: string[]): { name: string; args: string[] } {
  let index = 0;
  while (index < argv.length && ENV_ASSIGNMENT.test(argv[index]!)) index++;

  while (index < argv.length) {
    const name = launcherName(argv[index]!);
    if (name === "timeout") {
      const wrapped = timeoutCommandIndex(argv, index);
      if (wrapped < 0) break;
      index = wrapped;
      continue;
    }
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
  if (MULTI_CALL_BINARIES.has(name)) {
    const applet = args[0] === undefined ? undefined : launcherName(args[0]!);
    if (applet === undefined || !INLINE_SHELLS.has(applet)) return undefined;
    return inlineShellScript(applet, args.slice(1));
  }
  if (!INLINE_SHELLS.has(name)) return undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") break;
    if (!arg.startsWith("-") || !INLINE_SCRIPT_FLAG.test(arg)) continue;
    // `bash -c -- 'rm -rf ..'` means the same thing to bash, and Claude Code
    // reads the `--` there too — it is not a way around this check.
    const rest = args.slice(i + 1);
    const script = rest[0] === "--" ? rest[1] : rest[0];
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

const LEADING_VARIABLE =
  /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*|[0-9]+|[@*#?$!])[^}]*\}|([A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!]))/;

const PWD_SUBSTITUTION = /^(?:\$\(\s*pwd\s*\)|`\s*pwd\s*`)[\\/]*$/;

/**
 * Whether a dynamic target still has to be refused: the shell could land it on a
 * root or a system directory, which is the one thing this gate exists for.
 *
 * A variable's name says nothing about its value, so what is kept is only the
 * shapes where the rest of the word pins the landing place:
 *
 * - the variable is followed by `/` and then a glob, `$`, `/` or nothing —
 *   `rm -rf $DIR/`, `rm -rf "$DIR"/*`. With `DIR` empty the target collapses to
 *   the root; with it set to anything the target is still everything that
 *   directory holds.
 * - the variable is followed by `/` and a first-level system directory name —
 *   `rm -rf $DIR/etc`, `rm -rf ${DIR}/tmp/*`. The same collapse, one level down.
 * - the target is `$PWD` / `$HOME` / `$(pwd)`. These are not unknown — they are
 *   where this session runs — so refusing them is deliberately stricter than
 *   Claude Code, which sends them to the ordinary rules.
 *
 * Everything else (`rm -rf $DIR/build`, `rm -rf "$DIR"`, `rm -rf build/$DIR`)
 * names a directory inside something this check cannot see: the ordinary
 * permission rules still ask, and this gate stays out of the way.
 */
function dynamicTargetNeedsApproval(target: string): boolean {
  const match = LEADING_VARIABLE.exec(target);
  if (match === null) return PWD_SUBSTITUTION.test(target);
  const name = (match[1] ?? match[2])!.toUpperCase();
  const rest = target.slice(match[0].length);
  // The word is the variable and nothing else: `$DIR`, `"$DIR"`.
  if (rest === "") return name === "PWD" || name === "HOME";
  if (!/^[\\/]/.test(rest)) return false;
  // Everything after the first separator, minus trailing ones: `$DIR/` → "".
  const after = rest.slice(1).replace(/[\\/]+$/, "");
  if (after === "" || /^[*?[$\\/]/.test(after)) return true;
  // `$DIR/../..` is not a first-level name: the walk below does that arithmetic.
  if (after.startsWith(".")) return false;
  return isSystemDirectoryName(after.replace(/([\\/]\*+)+\/*$/, ""));
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
 * is not this rule's business either. A target holding a variable is reported
 * only when it can collapse onto a root or a system directory (see
 * {@link dynamicTargetNeedsApproval}); the rest names a directory inside
 * something this check cannot see, so the ordinary permission rules ask.
 *
 * Two shapes are about *not knowing* rather than about the path: a glob that
 * spans more than one directory level (`logs/*`, one level deeper) and a
 * relative glob behind a `cd` this check cannot follow. Both are reported
 * because a set nobody can enumerate is a set nobody can vouch for.
 */
function judgeTarget(
  rawTarget: string,
  cwd: string,
  judgement: Judgement,
  removesParents = false,
  cwdUnknown = false,
): DangerousRemoval | null {
  const scanned = scanWord(rawTarget);
  if (scanned.dynamic && dynamicTargetNeedsApproval(scanned.text)) {
    return { rule: "unresolvable", target: rawTarget, resolved: "" };
  }

  const written = writtenWord(rawTarget);

  // `cd $DIR && rm -rf build/*`: the shell changed into a directory this check
  // cannot name, so a relative glob hangs off nothing it can resolve. Judged
  // before the prefix arithmetic below, which would otherwise read the glob
  // against the directory the shell started in.
  const unbacked = expandHome(written) ?? written;
  if (
    cwdUnknown &&
    !path.isAbsolute(restoreWindowsPath(unbacked)) &&
    /[\\/]\*$/.test(unbacked)
  ) {
    return { rule: "relative_glob_after_cd", target: rawTarget, resolved: "" };
  }

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
  // Decided from the whole target, before the prefix is taken apart: the shapes
  // that end the walk early below (`*/*`) are exactly the ones it is about.
  const multiLevel = isMultiLevelGlob(candidate, cwd)
    ? { rule: "multi_level_glob" as const, target: rawTarget, resolved: "" }
    : null;
  const globIndex = verbatim === null ? candidate.search(GLOB_CHAR) : -1;
  if (globIndex >= 0) {
    const prefix = candidate.slice(0, globIndex);
    const trimmed = prefix.replace(/[\\/]+$/, "");
    if (trimmed === "") {
      // `*` is the contents of the current directory, not the directory: this
      // rule is about the directory itself. `/*` keeps its separator and names
      // the root, which is exactly the case worth stopping.
      if (prefix === "") return multiLevel;
      candidate = prefix;
    } else {
      candidate = trimmed;
    }
    // `./*` / `.//*`: the contents of the current directory again.
    if (candidate === ".") return multiLevel;
  }
  if (candidate === "") return multiLevel;

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
  // Last, as in Claude Code: a glob that is neither root, ancestor, home nor
  // system is still a set nobody can list when it crosses two levels.
  return multiLevel;
}

/**
 * Does this glob cross more than one directory level? (`logs/*`, one level
 * deeper; `*` twice in a row.)
 *
 * This is Claude Code's `multi_level_glob`, worked the same way: strip the
 * trailing `/*` groups off the resolved target, count the segments that went
 * away, count the glob-bearing segments left in the part relative to the
 * session directory, and report when the two together exceed one. One level
 * (`build/*`) is the ordinary "clear this directory"; two or more name a set
 * whose members — and whose directories — cannot be listed before the command
 * runs.
 */
function isMultiLevelGlob(target: string, cwd: string): boolean {
  const absolute = path.resolve(cwd, restoreWindowsPath(target));
  if (!/[\\/]\*$/.test(absolute)) return false;
  const statics = stripTrailingGlobs(absolute);
  if (statics === absolute) return false;
  const removed = countSegments(absolute) - countSegments(statics);
  const relative = relativeToSession(
    statics,
    cwd,
    path.isAbsolute(restoreWindowsPath(target)),
  );
  return removed + countSegments(relative, GLOB_CHAR) > 1;
}

/** The target with its trailing `/*` groups peeled off, as {@link isMultiLevelGlob} counts them. */
function stripTrailingGlobs(target: string): string {
  let current = target;
  let previous = "";
  while (previous !== current) {
    previous = current;
    const stripped = current.replace(/([\\/]\*+)+[\\/]*$/, "") || "/";
    if (stripped === current) continue;
    current = /[\\/]/.test(stripped) ? path.normalize(stripped) : stripped;
  }
  return current;
}

/** A path's segments, optionally only those matching [pattern]. */
function countSegments(value: string, pattern?: RegExp): number {
  return value
    .split(/[\\/]+/)
    .filter(
      (segment) =>
        segment !== "" &&
        segment !== "." &&
        (pattern === undefined || pattern.test(segment)),
    ).length;
}

/**
 * The part of an absolute path below [cwd], or the whole thing when it is not
 * below it — Claude Code's reading in `multi_level_glob`: an absolute target
 * names its own levels, a relative one has to lose the session prefix before its
 * remaining levels are counted.
 */
function relativeToSession(
  statics: string,
  cwd: string,
  targetIsAbsolute: boolean,
): string {
  if (targetIsAbsolute) return statics;
  const separator = /[\\/]$/.test(cwd) ? cwd : cwd + path.sep;
  if (statics.startsWith(separator)) return statics.slice(separator.length);
  if (statics === cwd) return "";
  return statics;
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
 * The last two rules are about *not knowing* rather than about a path, so they
 * say what could not be checked and why, and then say what to write instead,
 * which is the part a model can act on.
 */
export function describeDangerousRemoval(hit: DangerousRemoval): string {
  switch (hit.rule) {
    case "unresolvable":
      return `This command deletes "${hit.target}", a shell expansion that can leave the target at a root or a system directory — which cannot be checked before it runs. It needs explicit approval and cannot be covered by an allow rule or a bypass mode. Name the directory by its full path instead.`;
    case "backslash_only":
      return `This command deletes a backslash-only target ("${hit.target}"), which Git Bash reads as the drive root on Windows. It needs explicit approval and cannot be covered by an allow rule or a bypass mode. Write the directory you mean as a path, for example /c/work/build or C:/work/build.`;
    case "unplaceable":
      return `This command deletes "${hit.target}", a Windows path Git Bash may read differently from this check, so where it lands is unknown. It needs explicit approval and cannot be covered by an allow rule or a bypass mode. Write the directory you mean as a plain path, for example C:/work/build.`;
    case "relative_glob_after_cd":
      return `This command changes directories before the removal, so the relative glob target "${hit.target}" cannot be resolved before it runs. It needs explicit approval and cannot be covered by an allow rule or a bypass mode. Name the directory by its full path instead.`;
    case "multi_level_glob":
      return `This command deletes "${hit.target}", a glob that spans more than one directory level, so what it matches cannot be listed before it runs. It needs explicit approval and cannot be covered by an allow rule or a bypass mode. Name one directory's contents (build/*) or the paths themselves.`;
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

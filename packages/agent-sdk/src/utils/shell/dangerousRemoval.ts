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
 * * Text that is data is not a command either: a heredoc body, a here-string and
 * a comment are removed before the line is parsed, so `git add -A && git commit
 * -F - <<'MSG'` whose message mentions "rm -rf" is a commit, not a deletion. What
 * cannot be established as data stays in the line and is reported instead.
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
import { parseBashStructureDetailed } from "../bashStructure/index.js";
import type {
  BashAssignment,
  BashUnsupportedReason,
} from "../bashStructure/types.js";
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
  /** This command line itself gives the variable a value this check cannot place
   *  (`D=$(date); rm -rf "$D"`, a `read` capture, a loop variable). */
  | "derived_var"
  /** A variable spliced under a fixed root prefix (`/$D`, `~/$D`): emptying it
   *  leaves a top-level directory, not something inside the working directory. */
  | "var_root_child"
  /** The variable may be empty, and emptying it leaves the filesystem root (or
   *  its contents): `rm -rf /$D` becomes `rm -rf /`, `rm -rf $D/*` becomes `/*`. */
  | "emptyVariable"
  /** A backslash-only target (`rm -rf \`): the drive root in Git Bash on Windows. */
  | "backslash_only"
  /** A Windows path Git Bash may read differently, so where it lands is unknown. */
  | "unplaceable"
  /** A command that deletes through a channel this check cannot read. */
  | "unverifiable"
  /** The command line cannot be read, and it names a removal. */
  | "unparsable"
  /** The command nests deeper than this check follows (`bash -c` in `bash -c`, `$(…)` in `$(…)`). */
  | "nestedSpansOverrun";

export interface DangerousRemoval {
  rule: DangerousRemovalRule;
  /**
   * The target exactly as the model wrote it (the command line, for `unparsable`
   * and `nestedSpansOverrun`).
   */
  target: string;
  /**
   * Where it resolves to. Empty when the target cannot be resolved in advance,
   * and for {@link DangerousRemovalRule} `var_root_child` / `emptyVariable` it
   * is where the target lands when the variable expands to nothing.
   */
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

/**
 * Flags of {@link STDIN_ARG_COMMANDS} that consume the next word, so a value is
 * not mistaken for the command (`xargs -n 2 rm`, `parallel -j 4 rm`). Flags
 * that carry their value attached (`-n2`, `--max-args=2`) are one word and need
 * no entry.
 */
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
  // `parallel` shares the shape and adds its own value flags.
  "-j",
  "--jobs",
  "--halt",
  "--colsep",
  "--joblog",
  "--results",
  "--tmpdir",
  "-S",
  "--sshlogin",
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
  // Not a shell: the multiplexer's first word names the applet, which is the
  // command that really runs (`busybox rm -rf ..`). Peeling it keeps that
  // judgement on the applet instead of on a wrapper this check cannot read.
  ["busybox", new Set()],
]);

/**
 * Shells whose `-c <script>` argument is itself a command line to judge, and
 * whose other arguments are a *file* this check never opens
 * (`bash deploy.sh`, `sh scripts/clean.sh`). The file half is the boundary the
 * spec draws: the judgment is about the text this call carries, so a script
 * that lives in a file is not a deletion this check can see either way.
 * `busybox` is not here: its first word is an applet, not a script.
 */
const INLINE_SHELLS: ReadonlySet<string> = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "mksh",
  "ash",
]);

/** `sh -c` inside `sh -c` inside …; past this the shape is not worth chasing. */
const MAX_NESTING = 4;

/** A leading `NAME=value` word — an environment assignment, not a command. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** A shell short-flag cluster that ends in `c`: `-c`, `-lc`, `-ec`. */
const INLINE_SCRIPT_FLAG = /^-[A-Za-z]*c$/;

/**
 * The ways the detailed parse can name something it did not read as a command
 * while still leaving the walk the means to judge it: `eval` keeps its command
 * words (the second reading happens in the leaf walk), and a process
 * substitution keeps the leaves of its body. Every other error means the line
 * was not read to the end, and a line that was not read is confirmed rather
 * than cleared.
 */
const RESUMABLE_ERRORS: ReadonlySet<BashUnsupportedReason> = new Set([
  "eval",
  "process-substitution",
]);

/**
 * A word in a line this check cannot read that names a deletion. Only consulted
 * when the line cannot be read at all, and only over the text that is *not*
 * data: heredoc bodies, here-strings and comments have already been removed
 * from it, so a commit message never reaches this test while `rm -rf ../..`
 * next to an unreadable construct still does.
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
  // Past this many nested script levels the shape is not worth chasing — but
  // "not worth chasing" is not "nothing to see": a deletion deeper than this
  // check follows is confirmed, never cleared.
  if (depth > MAX_NESTING) {
    return nestedOverrun(command, `it nests ${depth} levels of shell scripts`);
  }

  // The structure-aware reader rather than the fail-closed projection: heredoc
  // bodies, here-strings and comments come back as data — removed from
  // `commandText`, never parsed as commands.
  const detail = parseBashStructureDetailed(command);

  // Command substitution is the other axis of depth. Judged ahead of the scale
  // abort below, so a line too deep to read reports instead of falling open.
  if (detail.maxNesting > MAX_NESTING) {
    return nestedOverrun(
      command,
      `it nests ${detail.maxNesting} levels of command substitutions`,
    );
  }

  // A scale abort — the line is longer than the reader takes, or the walk hit
  // its leaf budget — means the command was not read at all. Nothing in it can
  // be cleared by this check, and nothing in it is evidence of a deletion
  // either: the ordinary rules keep their say, with no card from here.
  if (detail.aborted) return null;

  // A line with an unreadable construct in it is confirmed rather than cleared —
  // unless the walk still has something to judge: `eval` keeps its command words
  // and a process substitution keeps the leaves of its body, and the loop below
  // judges both by the same rules as a command written out in full (spec
  // scenario 20). Every other error (`$((…))`, brace expansion, a heredoc that
  // could not be established as data, a syntax error) means the walk did not get
  // to the end of the line.
  const judgedFromErrors =
    detail.leaves.length > 0 &&
    detail.errors.every((reason) => RESUMABLE_ERRORS.has(reason));

  if (detail.errors.length > 0 && !judgedFromErrors) {
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
    if (detail.errors[0] === "syntax" && judgement.platform === "win32") {
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
    // Judged on `commandText`, not on what the model typed: data regions are
    // already gone, so a commit message cannot name a deletion this line makes.
    return REMOVAL_HINT.test(detail.commandText)
      ? {
          rule: "unparsable",
          target: detail.commandText.trim(),
          resolved: "",
          detail: unreadableReason(detail.errors[0] ?? "syntax"),
        }
      : null;
  }

  let cwd = startCwd;
  // Whether `cwd` is still where the shell will be: a `cd` this check could not
  // follow (`cd $DIR`) leaves `$PWD` unplaceable too.
  let cwdKnown = true;
  const bindings = new Map<string, VariableState>();
  let cursor = 0;

  // Subshells in view, innermost last. A `cd` inside `( … )` is undone when the
  // subshell ends, and so is a variable write: without this stack `(cd /tmp);
  // rm -rf .` would judge the `.` against `/tmp` and clear a deletion of the
  // session's own directory.
  const frames: Array<{ end: number; cwd: string; cwdKnown: boolean }> = [];
  let nextSubshell = 0;

  for (let index = 0; index < detail.leaves.length; index++) {
    const leaf = detail.leaves[index]!;

    // A subshell that has ended by this leaf restored the shell it was opened
    // from: the `cd` in there is undone.
    while (frames.length > 0 && frames[frames.length - 1]!.end <= index) {
      const frame = frames.pop()!;
      cwd = frame.cwd;
      cwdKnown = frame.cwdKnown;
    }
    while (
      nextSubshell < detail.subshells.length &&
      detail.subshells[nextSubshell]!.start === index
    ) {
      frames.push({
        end: detail.subshells[nextSubshell]!.end,
        cwd,
        cwdKnown,
      });
      nextSubshell++;
    }

    // Bring the variable writes this leaf can see into view: a write further
    // down the line cannot have changed what this command deletes, and one in
    // another subshell is gone before this command runs.
    while (cursor < detail.assignments.length) {
      const write = detail.assignments[cursor]!;
      if (write.visibleFrom > index) break;
      if ((write.subshell ?? 0) === (leaf.subshell ?? 0)) {
        recordBinding(bindings, write);
      }
      cursor++;
    }
    const scope: VariableScope = { bindings, cwd: cwdKnown ? cwd : null };

    // `command -v name` asks where a name resolves and runs nothing.
    if (nameQuery(leaf.argv)) continue;
    const { name, args } = unwrapLeaf(leaf.argv);
    if (!name) continue;

    if (name === "cd") {
      const next = directoryAfterCd(args, cwd);
      if (next) cwd = next;
      else cwdKnown = false;
      continue;
    }

    // A shell: `sh -c '…'` and `eval '…'` carry a command line this check
    // reads a second time, `bash deploy.sh` carries a file name and nothing
    // else, and a shell whose command line belongs to someone else
    // (`powershell -Command …`) is reported — the deletion is real and cannot
    // be seen.
    const inline = inlineScript(name, args);
    if (inline) {
      if (inline.kind === "missing") {
        // The script is not on this line: `-c` with nothing after it, or a shell
        // started with nothing but its own flags (`bash`, `bash -l`). There is no
        // command line here to run, hence nothing to delete — Claude Code stops in
        // the same place, its script reader returning nothing unless it finds
        // `-c <script>`, and counting a bare shell as unreadable opened the card
        // for probes as harmless as `command -v bash` (#3040).
        //
        // What may still be on this line is a body handed to the shell on stdin
        // (`bash <<'EOF' … EOF`, `sh <<< '…'`): that text is here, so it is read
        // like any other script instead of being written off.
        for (const body of detail.heredocBodies) {
          const hit = scanCommand(body, cwd, judgement, depth + 1);
          if (hit) return hit;
        }
        continue;
      }
      if (inline.kind === "script") {
        const hit = scanCommand(inline.script, cwd, judgement, depth + 1);
        if (hit) return hit;
      }
      continue;
    }

    if (name === "eval") {
      const script = evalScript(args, scope);
      if (script === null) {
        return {
          rule: "unparsable",
          target: leaf.text,
          resolved: "",
          detail: unreadableReason("eval"),
        };
      }
      const hit = scanCommand(script, cwd, judgement, depth + 1);
      if (hit) return hit;
      continue;
    }

    if (FOREIGN_SHELLS.has(name)) return unverifiable(leaf.text, name);

    // `xargs` / `parallel`: the command is on this line, its targets are not.
    if (STDIN_ARG_COMMANDS.has(name)) {
      const hit = judgeStdinTarget(
        name,
        leaf.text,
        args,
        cwd,
        judgement,
        depth,
        scope,
      );
      if (hit) return hit;
      continue;
    }

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
      const hit = judgeTarget(target, cwd, judgement, removesParents, scope);
      if (hit) return hit;
    }
  }

  // A process substitution kept the leaves of its body so a deletion inside it
  // could be judged above, but the construct itself is still not one this check
  // reads to the end: a line that names a removal anywhere keeps its card (spec
  // scenario 17), it just names the deletion when the body has one instead of
  // calling the whole line unreadable.
  if (
    detail.errors.includes("process-substitution") &&
    REMOVAL_HINT.test(detail.commandText)
  ) {
    return {
      rule: "unparsable",
      target: detail.commandText.trim(),
      resolved: "",
      detail: unreadableReason("process-substitution"),
    };
  }
  return null;
}

/**
 * A hit for a command this check is not willing to follow to its end: `bash -c`
 * inside `bash -c` inside …, `$(…)` inside `$(…)` inside …. Unlike a scale abort
 * (too long, too many leaves) this is a shape it can see and declines to chase,
 * so it is confirmed rather than cleared.
 */
function nestedOverrun(target: string, detail: string): DangerousRemoval {
  return {
    rule: "nestedSpansOverrun",
    target: target.trim(),
    resolved: "",
    detail,
  };
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
    // `&&` is a sequence, not two background jobs: both of its characters are
    // part of the operator, so neither may be rewritten here.
    const partOfOperator =
      command[i - 1] === ">" ||
      command[i - 1] === "&" ||
      command[i + 1] === ">";
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
 * `command -v name` / `command -V name`: the shell builtin's query form. It
 * reports where a name would resolve and executes nothing, so what follows is
 * not a command — `command -v bash` never runs bash.
 */
function nameQuery(argv: string[]): boolean {
  let index = 0;
  while (index < argv.length && ENV_ASSIGNMENT.test(argv[index]!)) index++;
  if (commandName(argv[index] ?? "") !== "command") return false;
  const flag = argv[index + 1] ?? "";
  return /^-[pvV]+$/.test(flag) && /[vV]/.test(flag);
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

/** What an inline-shell leaf will do with its arguments. */
type InlineScript =
  /** `sh -c '…'`: the script is this word, and is judged a second time. */
  | { kind: "script"; script: string }
  /** The script is not on this line at all: `sh -c` with nothing after it, or
   *  a bare `bash`, whose script comes in on stdin (`… | bash`, `bash < x`). */
  | { kind: "missing" }
  /** `bash deploy.sh`: the script is a file this check never opens. */
  | { kind: "file" };

/**
 * What a leaf of one of {@link INLINE_SHELLS} runs, or `null` when the leaf is
 * not an inline shell at all.
 *
 * The distinction the spec draws is whether the script text is on this command
 * line: `bash -c 'rm -rf ..'` is a command this check reads a second time,
 * while `bash deploy.sh` carries a file name and nothing else (`python
 * deploy.py` has no branch here at all, for the same reason).
 */
function inlineScript(name: string, args: string[]): InlineScript | null {
  if (!INLINE_SHELLS.has(name)) return null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    // `--` ends the shell's own flags: what follows is a script file.
    if (arg === "--") return { kind: "file" };
    // `-c`, `-lc`, `-ec`: a short-flag cluster that ends in `c`.
    if (!INLINE_SCRIPT_FLAG.test(arg)) continue;
    const script = args[i + 1];
    return script === undefined
      ? { kind: "missing" }
      : { kind: "script", script: scanWord(script).text };
  }
  // No `-c`: a positional word is the script file. With none the script is
  // read from stdin, which is not text this call carries either — but that is
  // the shape `printf 'rm -rf ..' | bash` has, so it stays reported.
  const scriptFile = args.some((arg) => !arg.startsWith("-"));
  return scriptFile ? { kind: "file" } : { kind: "missing" };
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
 * The words an `xargs` / `parallel` leaf runs, or `null` when it runs nothing
 * of its own (a bare `xargs` appends its input to `echo`).
 *
 * Only the wrapper's own options are skipped here: what follows them is the
 * target command and its *fixed* arguments, as xargs intends them.
 */
function stdinTargetWords(args: string[]): string[] | null {
  let index = 0;
  while (index < args.length) {
    const arg = args[index]!;
    if (arg === "--") {
      index++;
      break;
    }
    // `-0`, `-r`, `-t` take no value; `-n 2` and `-n2` both say "two".
    if (!arg.startsWith("-") || arg === "-") break;
    index += STDIN_ARG_VALUE_FLAGS.has(arg) ? 2 : 1;
  }
  return index < args.length ? args.slice(index) : null;
}

/**
 * Judge an `xargs` / `parallel` leaf (spec scenario 15).
 *
 * The command it runs is on this command line; the arguments it feeds that
 * command are not — they arrive on stdin, and xargs appends every one of them
 * to the fixed arguments. So the deletion is judged in two steps:
 *
 * - its fixed arguments are judged like any other target, which is what keeps
 *   `xargs rm -rf ..` a hit on the working directory rather than a shapeless
 *   "cannot be read";
 * - when they place nothing dangerous — or there are none, or they are a glob
 *   or a variable — the leaf is reported as a channel this check cannot read,
 *   because the words on stdin are unknown and each of them is another target
 *   (`find .. -maxdepth 0 | xargs rm -rf build` deletes the parent).
 *
 * A leaf that runs something else is not this rule's business: `find . | xargs
 * grep TODO` is a read, and reading a target list off a pipe is what it is for.
 */
function judgeStdinTarget(
  name: string,
  text: string,
  args: string[],
  cwd: string,
  judgement: Judgement,
  depth: number,
  scope: VariableScope,
): DangerousRemoval | null {
  const words = stdinTargetWords(args);
  if (words === null) return null;

  const { name: target, args: targetArgs } = unwrapLeaf(words);
  if (!target) return null;
  const runs = `${name} ${target}`;

  // What it runs may itself be a shell (`xargs sh -c 'rm "$@"' _`) or a second
  // wrapper (`xargs sudo rm -rf ..`): both are read the same way here.
  const inline = inlineScript(target, targetArgs);
  if (inline) {
    if (inline.kind === "missing") return unverifiable(text, runs);
    if (inline.kind === "file") return null;
    return scanCommand(inline.script, cwd, judgement, depth + 1);
  }
  if (FOREIGN_SHELLS.has(target)) return unverifiable(text, runs);
  if (STDIN_ARG_COMMANDS.has(target)) {
    return judgeStdinTarget(
      name,
      text,
      targetArgs,
      cwd,
      judgement,
      depth,
      scope,
    );
  }

  const deletes =
    target === ROBOCOPY
      ? robocopyTargets(targetArgs)
      : REMOVAL_COMMANDS.has(target)
        ? removalTargetsFor(target, targetArgs)
        : null;
  if (deletes === null) return null;
  if (deletes.exitsWithoutRemoving) return null;
  for (const fixed of deletes.targets) {
    const hit = judgeTarget(
      fixed,
      cwd,
      judgement,
      deletes.removesParents,
      scope,
    );
    if (hit) return hit;
  }
  return unverifiable(text, runs);
}

/**
 * The command line an `eval` leaf runs, or `null` when its argument cannot be
 * read as text before it runs (`eval "$CMD"`, `eval $(…)`).
 *
 * `eval` joins its arguments with a space and parses the result, so `eval rm -rf
 * ..` and `eval 'rm -rf ..'` are two spellings of the same command line. The
 * values this line gives the variables are used, exactly as they are elsewhere.
 */
function evalScript(args: string[], scope: VariableScope): string | null {
  const parts: string[] = [];
  for (const arg of args) {
    const scanned = scanWord(arg, scope);
    if (scanned.unresolved.length > 0) return null;
    parts.push(scanned.text);
  }
  return parts.join(" ");
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

/** What this command line does to one variable, as far as the walk has got. */
interface VariableState {
  /** How many writes are in view. More than one is not a value this check uses. */
  writes: number;
  /** The literal value, when the only write in view spells one out. */
  value: string | null;
  /** The right-hand side of the latest write, for the card. */
  rhs: string;
  /** Where a value that is not an assignment comes from. */
  source?: "read" | "for";
}

/**
 * What the variables of a word mean at one leaf: the writes in view, and where
 * the shell is (`null` once a `cd` this check could not follow makes `$PWD`
 * unplaceable too).
 */
interface VariableScope {
  bindings: ReadonlyMap<string, VariableState>;
  cwd: string | null;
}

/** One expansion a word scan could not reduce to literal text. */
interface UnresolvedExpansion {
  /** The expansion as written: `$D`, `${D}`, a backtick, `$(…)`. */
  written: string;
  /** The variable name when this is a plain variable expansion, else `""`. */
  name: string;
  /** What this command line writes to it, when it writes anything. */
  state: VariableState | undefined;
}

interface ScannedWord {
  /** The word with its quotes removed and the readable variables filled in. */
  text: string;
  /** Whether any part of it is only known after the command runs. */
  dynamic: boolean;
  /** The parts that could not be reduced, in the order written. */
  unresolved: UnresolvedExpansion[];
  /** {@link text} before the first unresolved part: the ground the expansion
   *  stands on (`/` in `/$D`, nothing at all in `$D`). */
  prefix: string;
  /** {@link text} with every unresolved part expanded to nothing. */
  degenerate: string;
}

/** Fold one variable write into the view a leaf judges its targets against. */
function recordBinding(
  bindings: Map<string, VariableState>,
  write: BashAssignment,
): void {
  const previous = bindings.get(write.name);
  bindings.set(write.name, {
    writes: (previous?.writes ?? 0) + 1,
    value: write.value,
    rhs: write.rhs,
    source: previous?.source ?? write.source,
  });
}

/**
 * Split one word as the shell would see it: quotes removed, the literal values
 * of variables this command line sets filled in, and what could not be placed
 * kept apart from what could.
 *
 * Single quotes make `$` literal, so `rm -rf '$DIR'` is an ordinary (if oddly
 * named) path and must not be reported as unresolvable.
 */
function scanWord(raw: string, scope?: VariableScope): ScannedWord {
  const unresolved: UnresolvedExpansion[] = [];
  let text = "";
  let degenerate = "";
  let dynamic = false;
  let prefix: string | null = null;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]!;

    if (quote === "'") {
      if (char === "'") {
        quote = null;
      } else {
        text += char;
        degenerate += char;
      }
      continue;
    }

    if (char === "\\") {
      const next = raw[i + 1];
      if (next !== undefined) {
        text += next;
        degenerate += next;
        i++;
      }
      continue;
    }

    if (quote === '"' && char === '"') {
      quote = null;
      continue;
    }

    if (quote === null && (char === "'" || char === '"')) {
      quote = char;
      continue;
    }

    if (char === "$" || char === "`") {
      dynamic = true;
      const expansion = readExpansion(raw, i);
      const value =
        expansion.name === "" ? null : variableValue(expansion.name, scope);
      if (value === null) {
        if (prefix === null) prefix = text;
        unresolved.push({
          written: expansion.written,
          name: expansion.name,
          state:
            expansion.name === ""
              ? undefined
              : scope?.bindings.get(expansion.name),
        });
        // As the shell passes it the word keeps the expansion; expanded to
        // nothing it drops it, which is the other landing worth judging.
        text += expansion.written;
      } else {
        text += value;
        degenerate += value;
      }
      i = expansion.end - 1;
      continue;
    }

    text += char;
    degenerate += char;
  }

  return { text, dynamic, unresolved, prefix: prefix ?? text, degenerate };
}

/**
 * The value of `$name` at this leaf, or `null` when it cannot be placed.
 *
 * Two sources, in that order: a write this command line makes — only when there
 * is exactly one in view and it is literal text — and the two variables whose
 * value a shell always has and whose path this check can name.
 */
function variableValue(
  name: string,
  scope: VariableScope | undefined,
): string | null {
  const binding = scope?.bindings.get(name);
  if (binding) {
    return binding.writes === 1 ? binding.value : null;
  }
  if (!scope) return null;
  if (name === "PWD") return scope.cwd;
  if (name === "HOME") return os.homedir();
  return null;
}

/** Read one `$…` or backtick expansion starting at [start]. */
function readExpansion(
  raw: string,
  start: number,
): { written: string; name: string; end: number } {
  if (raw[start] === "`") {
    const close = raw.indexOf("`", start + 1);
    const end = close === -1 ? raw.length : close + 1;
    return { written: raw.slice(start, end), name: "", end };
  }

  const next = raw[start + 1];
  if (next === "{") {
    const close = raw.indexOf("}", start + 2);
    const limit = close === -1 ? raw.length : close;
    const inner = raw.slice(start + 2, limit);
    const name = /^[A-Za-z_][A-Za-z0-9_]*$/.test(inner) ? inner : "";
    const end = close === -1 ? raw.length : close + 1;
    return { written: raw.slice(start, end), name, end };
  }

  if (next === "(") {
    // `$(…)`: balanced parentheses, ignoring the ones inside quotes.
    let depth = 0;
    let quote: '"' | "'" | null = null;
    let i = start + 1;
    for (; i < raw.length; i++) {
      const char = raw[i]!;
      if (char === "\\") {
        i++;
        continue;
      }
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"') quote = char;
      else if (char === "(") depth++;
      else if (char === ")" && --depth === 0) {
        i++;
        break;
      }
    }
    return { written: raw.slice(start, i), name: "", end: i };
  }

  if (next !== undefined && /[A-Za-z_]/.test(next)) {
    let end = start + 2;
    while (end < raw.length && /[A-Za-z0-9_]/.test(raw[end]!)) end++;
    return {
      written: raw.slice(start, end),
      name: raw.slice(start + 1, end),
      end,
    };
  }

  // `$?`, `$1`, `$@`, a lone `$`: an expansion with no name to look up.
  const end = Math.min(start + 2, raw.length);
  return { written: raw.slice(start, end), name: "", end };
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
 * A target spelled with variables is first reduced as far as this command line
 * allows (see {@link scanWord}); only what is left unknown is reported, and
 * {@link judgeDynamicTarget} says which kind of unknown it is. Everything else
 * is pure path arithmetic on the resolved spelling.
 */
function judgeTarget(
  rawTarget: string,
  cwd: string,
  judgement: Judgement,
  removesParents = false,
  scope?: VariableScope,
): DangerousRemoval | null {
  const scanned = scanWord(rawTarget, scope);
  if (scanned.unresolved.length > 0) {
    return judgeDynamicTarget(
      rawTarget,
      scanned,
      cwd,
      judgement,
      removesParents,
    );
  }
  return judgeStaticTarget(
    scanned.text,
    writtenWord(rawTarget),
    rawTarget,
    cwd,
    judgement,
    removesParents,
  );
}

/**
 * Judge a target whose value is not fully known before the command runs.
 *
 * Silence is not an option: a target this check cannot place is exactly the
 * "variable path" family Claude Code refuses, and skipping it would be a
 * documented way around every static check. What is worth doing is naming
 * *which* unknown it is, because that is what the person — and the model
 * reading the refusal — needs:
 *
 * - the command line itself writes the variable, from something this check does
 *   not read (`D=$(date)`, `read`, a loop variable): `derived_var`;
 * - emptying the variable leaves the filesystem root or a directory directly
 *   under it (`rm -rf /$D` becomes `rm -rf /`, `rm -rf $D/*` becomes
 *   `rm -rf /*`): `emptyVariable`;
 * - the variable is spliced under a fixed root prefix, so even a value this
 *   check never sees cannot bring the target inside the working directory
 *   (`rm -rf "/$D"`, `rm -rf "~/$D"`): `var_root_child`;
 * - nothing more can be said: `unresolvable`, as before.
 */
function judgeDynamicTarget(
  rawTarget: string,
  scanned: ScannedWord,
  cwd: string,
  judgement: Judgement,
  removesParents: boolean,
): DangerousRemoval {
  const bound = scanned.unresolved.find((part) => part.state !== undefined);
  if (bound) {
    return {
      rule: "derived_var",
      target: rawTarget,
      resolved: "",
      detail: bindingReason(bound.name, bound.state!),
    };
  }

  const landing = emptyExpansion(
    scanned.degenerate,
    cwd,
    judgement,
    rawTarget,
    removesParents,
  );
  const anchored = isRootAnchored(scanned.prefix, judgement.platform);
  const expansions = scanned.unresolved.map((part) => part.written).join(", ");

  // Emptying the variable leaves the root itself — the sharpest thing the card
  // can say, so it is said before the shape of the prefix is.
  if (landing?.atRoot || (!anchored && landing !== null)) {
    return {
      rule: "emptyVariable",
      target: rawTarget,
      resolved: landing?.resolved ?? "",
      detail: expansions,
    };
  }
  if (anchored) {
    return {
      rule: "var_root_child",
      target: rawTarget,
      resolved: landing?.resolved ?? "",
      detail: expansions,
    };
  }
  return { rule: "unresolvable", target: rawTarget, resolved: "" };
}

interface DepartureLanding {
  /** Where the target lands when the variables are empty. */
  resolved: string;
  /** …and that landing is the filesystem root itself (or its contents). */
  atRoot: boolean;
}

/**
 * Where the target lands when every unresolved variable in it expands to
 * nothing, or `null` when that landing is still an ordinary directory.
 *
 * `rm -rf /$D` becomes `rm -rf /` and `rm -rf $D/*` becomes `rm -rf /*`: with
 * `D` unset those are not "a directory inside the project", and the shell
 * erroring out is the best case. The same question is asked one level down —
 * `rm -rf $D/sub` becomes `/sub`, a directory directly below the root — and for
 * any landing the gate itself would refuse (home, a system directory, a
 * protected root).
 */
function emptyExpansion(
  degenerate: string,
  cwd: string,
  judgement: Judgement,
  rawTarget: string,
  removesParents: boolean,
): DepartureLanding | null {
  if (degenerate.trim() === "") return null;

  const hit = judgeStaticTarget(
    degenerate,
    degenerate,
    rawTarget,
    cwd,
    judgement,
    removesParents,
  );
  if (hit) {
    return {
      resolved: hit.resolved || degenerate,
      atRoot: hit.rule === "root",
    };
  }

  const resolved = path.resolve(cwd, restoreWindowsPath(degenerate));
  if (path.dirname(resolved) === path.parse(resolved).root) {
    return { resolved, atRoot: false };
  }
  return null;
}

/**
 * Does the literal text before the first unresolved expansion start at a fixed
 * absolute place — the filesystem root, the user's home, or a drive? Then the
 * expansion can only choose a name *below* that place: `/$D` and `~/$D` cannot
 * land inside the working directory whatever the variable holds.
 */
function isRootAnchored(prefix: string, platform: NodeJS.Platform): boolean {
  return (
    prefix.startsWith("/") ||
    prefix === "~" ||
    prefix.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/.test(prefix) ||
    (platform === "win32" && prefix.startsWith("\\"))
  );
}

/** What this command line does to the variable, in the card's words. */
function bindingReason(name: string, state: VariableState): string {
  if (state.writes > 1) {
    return `$${name} is assigned more than once on this command line`;
  }
  if (state.source === "read") return `$${name} is read from stdin`;
  if (state.source === "for") return `$${name} is a loop variable`;
  return state.rhs === ""
    ? `$${name} is set to an empty value on this command line`
    : `$${name} is set to \`${state.rhs}\` on this command line`;
}

/**
 * Judge one removal target whose value is fully known.
 *
 * A glob is judged by its static prefix rather than the whole word: `rm -rf
 * build/*` clears a directory inside the project (an ordinary, still-confirmed
 * operation), while `rm -rf /*` and `rm -rf ../*` name the root or a parent. A
 * bare `*` is the contents of the current directory — not the directory — so it
 * is not this rule's business either.
 */
function judgeStaticTarget(
  text: string,
  written: string,
  rawTarget: string,
  cwd: string,
  judgement: Judgement,
  removesParents = false,
): DangerousRemoval | null {
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

  let candidate = verbatim ?? text;
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
 * The rules after the first are about *not knowing* rather than about a path, so they
 * say what could not be checked and why — Claude Code words its own failure
 * table the same way ("… can't be checked before it runs") — and then say what
 * to write instead, which is the part a model can act on.
 */
export function describeDangerousRemoval(hit: DangerousRemoval): string {
  switch (hit.rule) {
    case "unresolvable":
      return `This command deletes "${hit.target}", whose value cannot be checked before it runs. It is refused unless approved explicitly and cannot be covered by an allow rule or a bypass mode.`;
    case "derived_var":
      return `This command deletes "${hit.target}", and ${hit.detail}, so its value cannot be checked before it runs. It needs explicit approval and cannot be covered by an allow rule or a bypass mode. Use a literal path if you mean to remove a directory.`;
    case "var_root_child":
      return `This command deletes "${hit.target}", a variable (${hit.detail}) spliced under a fixed root prefix: with nothing in it the target becomes ${hit.resolved || "a top-level directory"}, not a directory inside the working directory. It needs explicit approval and cannot be covered by an allow rule or a bypass mode. Use a literal path if you mean to remove a directory.`;
    case "emptyVariable":
      return `This command deletes "${hit.target}", whose variable (${hit.detail}) may be empty — and with nothing in it the target becomes ${hit.resolved || "the filesystem root"}, which is nothing like a directory inside the working directory. It needs explicit approval and cannot be covered by an allow rule or a bypass mode. Use a literal path if you mean to remove a directory.`;
    case "unparsable":
      return `This command cannot be checked before it runs (${hit.detail ?? "the shell syntax is not one this check reads"}), and it names a deletion. It needs explicit approval and cannot be covered by an allow rule or a bypass mode.`;
    case "nestedSpansOverrun":
      return `This command nests deeper than this check follows (${hit.detail ?? "nested shell scripts"}), so what it runs cannot be checked before it starts. It needs explicit approval and cannot be covered by an allow rule or a bypass mode. Use a flat command that spells out the directory you mean.`;
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

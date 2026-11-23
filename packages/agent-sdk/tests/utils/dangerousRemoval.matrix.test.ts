/**
 * Table-driven acceptance matrix for「删除自身工作目录的内建硬闸」.
 *
 * The spec is `docs/specs/core/tool-permission-system.md`, user story
 * 「用户故事：删除自身工作目录的内建硬闸」, acceptance scenarios 1-25. Every row
 * pins the *exact* rule the check reports (or `null` for "nothing to confirm"),
 * not merely "it stopped something", so a drift in behavior — a target that
 * starts being judged `unresolvable` instead of `working_directory`, a channel
 * that starts falling open — turns one named row red instead of passing quietly.
 *
 * The rows also carry the behaviour changes the three hardening batches made
 * (`change: "loosened"` / `"tightened"`): cases that came back cleared and must
 * stay cleared, and cases that gained (or sharpened) a card and must keep it.
 *
 * Scenarios 10-12 are not decided here: 10-11 are `PermissionManager`'s decision
 * band and 12 is the PowerShell channel, so their coverage lives in
 * `tests/managers/permissionManager.dangerousRemoval.test.ts` and the
 * powershellTool tests.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findDangerousRemoval,
  type DangerousRemovalRule,
} from "../../src/utils/shell/dangerousRemoval.js";

vi.mock("node:fs");

/** A worktree-shaped session: `sub` is where the shell starts. */
const WORKDIR = path.resolve(path.sep, "fake", "worktree", "repo", "sub");
/** The `permissions.additionalDirectories` entry: protected, but not the cwd. */
const ADDITIONAL = path.resolve(path.sep, "data", "exports");
const PROTECTED_ROOTS = [WORKDIR, ADDITIONAL];
const WINDOWS = process.platform === "win32";

/**
 * The drive the fixture sits on, upper case; `C` off Windows, where there is no
 * drive to name. Rows that talk about *other* drives need one that the fixture
 * is not on — `D:\media` is an ancestor of the working directory whenever the
 * fixture itself is on `D:`.
 */
const DRIVE_ROOT = path.parse(WORKDIR).root;
const DRIVE = /^[A-Za-z]:\\?$/.test(DRIVE_ROOT)
  ? DRIVE_ROOT[0]!.toUpperCase()
  : "C";
const OTHER_DRIVE = DRIVE === "Z" ? "Y" : "Z";

/**
 * A path as it survives the shell: forward slashes only. `rm -rf C:\a\b` reaches
 * `rm` spelled `C:ab` — a drive-relative name that is not the directory written,
 * which is itself something this check asks about — so commands never carry a
 * backslash path except when the backslash *is* the subject (scenario 23-25).
 */
function commandPath(p: string): string {
  return p.split(path.sep).join("/");
}

/** `/d/fake/x` — a path as Git Bash spells a drive. */
function msysPath(...segments: string[]): string {
  return ["", DRIVE.toLowerCase(), ...segments].join("/");
}

/** `/cygdrive/d/fake/x` — the same path in Git Bash's other spelling. */
function cygdrivePath(...segments: string[]): string {
  return ["", "cygdrive", DRIVE.toLowerCase(), ...segments].join("/");
}

/** `//localhost/D$/fake/x` — the same path through the drive's admin share. */
function adminSharePath(...segments: string[]): string {
  return `//localhost/${[`${DRIVE}$`, ...segments].join("/")}`;
}

/** `echo $(echo … $(inner) …)` — `levels` command substitutions deep. */
function nestedSubstitution(levels: number, inner: string): string {
  return `echo ${"$(echo ".repeat(levels)}${inner}${")".repeat(levels)}`;
}

/** `bash -c "bash -c '…'"` — `levels` inline shells deep, around a removal. */
function nestedShells(levels: number): string {
  let command = "rm -rf ../..";
  for (let i = 0; i < levels; i++) {
    command = `bash -c ${JSON.stringify(command)}`;
  }
  return command;
}

/** One row of the matrix: one command line, one exact verdict. */
interface Row {
  /** The command line as the model would send it. */
  command: string;
  /** The exact rule this check must report, or `null` for "nothing to confirm". */
  expected: DangerousRemovalRule | null;
  /** The acceptance scenario in the spec this row pins. */
  spec: string;
  /** What the row is about, in one line; also part of the test name. */
  note: string;
  /** Judge the line as Git Bash on Windows reads it, whatever host runs this. */
  platform?: NodeJS.Platform;
  /** Real-path answers for this row; identity when absent. */
  realpath?: Record<string, string>;
  /**
   * Set when the row pins a behaviour change from one of the hardening batches:
   * `loosened` = confirmed before, cleared now; `tightened` = cleared (or named
   * another rule) before, this rule now.
   */
  change?: "loosened" | "tightened";
}

interface JudgeOptions {
  platform?: NodeJS.Platform;
}

function judge(
  command: string,
  options: JudgeOptions = {},
): DangerousRemovalRule | null {
  return (
    findDangerousRemoval({
      command,
      workdir: WORKDIR,
      protectedRoots: PROTECTED_ROOTS,
      platform: options.platform ?? process.platform,
    })?.rule ?? null
  );
}

/**
 * The real path of every target is its own spelling unless a row says
 * otherwise. `.native` is the call the guard makes (the JS one leaves 8.3 short
 * names alone), so it is the one to stand in for.
 */
function answerRealPaths(answers: Record<string, string> | undefined): void {
  vi.mocked(fs.realpathSync.native).mockImplementation((target) => {
    const asked = target.toString();
    return answers?.[asked] ?? asked;
  });
}

/** Turn one row into one test that asserts the exact rule. */
function rows(cases: Row[]): void {
  for (const row of cases) {
    const change = row.change ? ` [${row.change}]` : "";
    it(`scenario ${row.spec} — ${row.note}${change}`, () => {
      answerRealPaths(row.realpath);
      expect(
        judge(row.command, row),
        `scenario ${row.spec} (${row.note}): ${JSON.stringify(row.command)}`,
      ).toBe(row.expected);
    });
  }
}

// ---------------------------------------------------------------------------
// Scenarios 1-9: the path arithmetic — equal, ancestor, additional directory,
// root, home, real path, several targets, compound commands, globs.
// ---------------------------------------------------------------------------

const BASIC: Row[] = [
  {
    command: "rm -rf .",
    expected: "working_directory",
    spec: "1",
    note: "the working directory as `.`",
  },
  {
    command: `rm -rf ${commandPath(WORKDIR)}`,
    expected: "working_directory",
    spec: "1",
    note: "the working directory by absolute path",
  },
  {
    command: `rm -rf '${commandPath(WORKDIR)}'`,
    expected: "working_directory",
    spec: "1",
    note: "the same target, quoted",
  },
  {
    command: "rm -rf ..",
    expected: "working_directory",
    spec: "2",
    note: "the parent, which contains the working directory",
  },
  {
    command: "rm -rf ../..",
    expected: "working_directory",
    spec: "2",
    note: "the grandparent",
  },
  {
    command: "rm -rf ./build/../..",
    expected: "working_directory",
    spec: "2",
    note: "an ancestor reached through an `..` segment",
  },
  {
    command: `rm -rf ${commandPath(path.dirname(WORKDIR))}`,
    expected: "working_directory",
    spec: "2",
    note: "an ancestor by absolute path",
  },
  {
    command: "rmdir ..",
    expected: "working_directory",
    spec: "2",
    note: "the same target through `rmdir`",
  },
  {
    command: "rmdir -p empty/nested",
    expected: "working_directory",
    spec: "2",
    note: "`rmdir -p`, which walks up to the root",
  },
  {
    command: `rm -rf ${commandPath(ADDITIONAL)}`,
    expected: "working_directory",
    spec: "3",
    note: "an additional directory itself",
  },
  {
    command: `rm -rf ${commandPath(path.dirname(ADDITIONAL))}`,
    expected: "working_directory",
    spec: "3",
    note: "an ancestor of an additional directory",
  },
  {
    command: `rm -rf ${commandPath(path.join(ADDITIONAL, "sub"))}`,
    expected: null,
    spec: "3",
    note: "a directory below an additional directory is not protected",
  },
  {
    command: "rm -rf /",
    expected: "root",
    spec: "4",
    note: "the filesystem root",
  },
  {
    command: "rm -rf ~",
    expected: "home",
    spec: "4",
    note: "the user's home directory as `~`",
  },
  {
    command: `rm -rf ${commandPath(os.homedir())}`,
    expected: "home",
    spec: "4",
    note: "the user's home directory by absolute path",
  },
  {
    command: "rm -rf /etc",
    expected: "system",
    spec: "4",
    note: "a first-level system directory",
  },
  {
    command: `rm -rf ${commandPath(path.resolve(path.sep, "usr", "local", "lib", "x"))}`,
    expected: null,
    spec: "4",
    note: "a directory far below a system directory is ordinary",
  },
  {
    command: `rm -rf ${commandPath(path.resolve(path.sep, "fake", "link-to-repo"))}`,
    expected: "working_directory",
    spec: "5",
    note: "a symlink that resolves to the working directory",
    realpath: {
      [path.resolve(path.sep, "fake", "link-to-repo")]: WORKDIR,
    },
  },
  {
    command: "rm -rf a b ..",
    expected: "working_directory",
    spec: "6",
    note: "one of several targets is enough",
  },
  {
    command: "rm -rf -- ..",
    expected: "working_directory",
    spec: "6",
    note: "operands after `--` are targets",
  },
  {
    command: "rm --help",
    expected: null,
    spec: "6",
    note: "`--help` names no target",
  },
  {
    command: "rm --version ../..",
    expected: null,
    spec: "6",
    note: "`--version` deletes nothing, even next to a path",
  },
  {
    command: "a && rm -rf ..",
    expected: "working_directory",
    spec: "7",
    note: "the second leaf of a `&&` list",
  },
  {
    command: "cd /srv && rm -rf /srv",
    expected: "working_directory",
    spec: "7",
    note: "a `cd` earlier on the line moves the directory being protected",
  },
  {
    command: "cat list | rm -rf ../..",
    expected: "working_directory",
    spec: "7",
    note: "a leaf on the right of a pipe",
  },
  {
    command: "sudo rm -rf ../..",
    expected: "working_directory",
    spec: "7",
    note: "a deletion behind `sudo`",
  },
  {
    command: "env FOO=1 rm -rf ../..",
    expected: "working_directory",
    spec: "7",
    note: "a deletion behind `env`",
  },
  {
    command: "bash -c 'rm -rf ../..'",
    expected: "working_directory",
    spec: "7",
    note: "an inline shell script",
  },
  {
    command: "rm -rf ../.. &",
    expected: "working_directory",
    spec: "7",
    note: "a background job deletes exactly what the foreground one does",
  },
  {
    command: "rm -rf $UNKNOWN",
    expected: "unresolvable",
    spec: "8",
    note: "a variable this line never sets",
  },
  {
    command: "rm -rf $(pwd)",
    expected: "unresolvable",
    spec: "8",
    note: "a command substitution as the target",
  },
  {
    command: "rm -rf `pwd`",
    expected: "unresolvable",
    spec: "8",
    note: "the backtick spelling of the same target",
  },
  {
    command: "rm -rf build/$UNKNOWN",
    expected: "unresolvable",
    spec: "8",
    note: "a variable below a fixed prefix that stays inside the session",
  },
  {
    command: "rm -rf *",
    expected: null,
    spec: "9",
    note: "a bare glob is the contents of the directory, not the directory",
  },
  {
    command: "rm -rf build/*",
    expected: null,
    spec: "9",
    note: "a glob below the working directory",
  },
  {
    command: "rm -rf /*",
    // `\` — the drive root on Windows — is the "every first-level directory is
    // critical" shape there, which is the same hit under another name.
    expected: process.platform === "win32" ? "system" : "root",
    spec: "9",
    note: "a glob whose static prefix is the root",
  },
  {
    command: "rm -rf ../*",
    expected: "working_directory",
    spec: "9",
    note: "a glob whose static prefix is a parent",
  },
];

// ---------------------------------------------------------------------------
// Scenarios 13-22: the channels that carry, hide or interrupt a command line.
// ---------------------------------------------------------------------------

const CHANNELS: Row[] = [
  {
    command: "powershell -NoProfile -Command Remove-Item x",
    expected: "unverifiable",
    spec: "13",
    note: "a foreign shell whose command line is not read",
  },
  {
    command: "pwsh -File clean.ps1",
    expected: "unverifiable",
    spec: "13",
    note: "PowerShell Core",
  },
  {
    command: "wsl rm -rf /",
    expected: "unverifiable",
    spec: "13",
    note: "the WSL launcher",
  },
  {
    command: "su - postgres -c 'rm -rf x'",
    expected: "unverifiable",
    spec: "13",
    note: "`su`, whose script belongs to another account's shell",
  },
  {
    command: "cmd //c rd /s /q src",
    expected: "unverifiable",
    spec: "13",
    note: "the Windows command interpreter",
  },
  {
    command: "fish -c 'rm -rf ..'",
    expected: "unverifiable",
    spec: "13",
    note: "a shell whose grammar this check does not model",
  },
  {
    command: "robocopy build ../.. /MIR",
    expected: "working_directory",
    spec: "13",
    note: "`robocopy /MIR` empties the mirror side",
  },
  {
    command: "robocopy build ../..",
    expected: null,
    spec: "13",
    note: "a plain robocopy only copies",
  },
  {
    command: "busybox rm -rf ../..",
    expected: "working_directory",
    spec: "13",
    note: "the busybox applet is judged as the command it is",
  },
  {
    command: "busybox ls",
    expected: null,
    spec: "13",
    note: "a busybox applet that deletes nothing comes back cleared",
    change: "loosened",
  },
  {
    command: "bash deploy.sh",
    expected: null,
    spec: "14",
    note: "a script file is outside the text this check carries",
    change: "loosened",
  },
  {
    command: "sh scripts/clean.sh -rf /",
    expected: null,
    spec: "14",
    note: "the same, with flags that would be dangerous inline",
    change: "loosened",
  },
  {
    command: "zsh x.sh",
    expected: null,
    spec: "14",
    note: "another shell, a script file",
    change: "loosened",
  },
  {
    command: "python deploy.py",
    expected: null,
    spec: "14",
    note: "an interpreter with a script file",
    change: "loosened",
  },
  {
    command: "bash -x scripts/clean.sh",
    expected: null,
    spec: "14",
    note: "trace flags do not turn the file into text",
    change: "loosened",
  },
  {
    command: "bash -- deploy.sh",
    expected: null,
    spec: "14",
    note: "`--` ends the shell's flags: what follows is a file",
  },
  {
    command: "xargs rm -rf ..",
    expected: "working_directory",
    spec: "15",
    note: "xargs runs a deletion whose fixed arguments already place a parent",
    change: "tightened",
  },
  {
    command: "xargs -n 2 rm -rf ../..",
    expected: "working_directory",
    spec: "15",
    note: "the same behind an option that takes a value",
    change: "tightened",
  },
  {
    command: "xargs sh -c 'rm -rf ..'",
    expected: "working_directory",
    spec: "15",
    note: "xargs runs an inline shell this check reads",
  },
  {
    command: "ls | xargs sudo rm -rf ../..",
    expected: "working_directory",
    spec: "15",
    note: "a wrapper between xargs and the deletion",
    change: "tightened",
  },
  {
    command: "parallel -j 4 rm -rf ..",
    expected: "working_directory",
    spec: "15",
    note: "`parallel` names its deletion on this line",
    change: "tightened",
  },
  {
    command: "ls | xargs rm -rf",
    expected: "unverifiable",
    spec: "15",
    note: "the targets arrive on stdin, so the landing is unknown",
  },
  {
    command: "find . -print0 | xargs -0 rmdir",
    expected: "unverifiable",
    spec: "15",
    note: "the same through a NUL-separated list",
  },
  {
    command: "echo build | xargs rm -rf build",
    expected: "unverifiable",
    spec: "15",
    note: "even an ordinary fixed argument is appended to by stdin",
  },
  {
    command: "find . | parallel rm -rf {}",
    expected: "unverifiable",
    spec: "15",
    note: "`parallel` with a placeholder target",
  },
  {
    command: "find . -name x | xargs grep TODO",
    expected: null,
    spec: "15",
    note: "what xargs runs is not a deletion: reading a list off a pipe is fine",
  },
  {
    command: "cat files | parallel wc -l",
    expected: null,
    spec: "15",
    note: "the same for `parallel`",
  },
  {
    command: [
      "git add -A && git commit -F - <<'MSG'",
      "",
      "fix PowerShell quoting in the remove-item path",
      "rm -rf the old build directory",
      "",
      "MSG",
    ].join("\n"),
    expected: null,
    spec: "16",
    note: "a heredoc body is data: a commit message mentioning a deletion is a commit",
    change: "loosened",
  },
  {
    command: "git commit -F - <<MSG\nrm -rf ../..\nMSG",
    expected: null,
    spec: "16",
    note: "an unquoted heredoc body with no expansion is data too",
    change: "loosened",
  },
  {
    command: "grep pattern <<< 'rm -rf ../..'",
    expected: null,
    spec: "16",
    note: "a here-string word is data",
    change: "loosened",
  },
  {
    command: "ls -la   # PowerShell note: rm -rf ../..",
    expected: null,
    spec: "16",
    note: "a comment is data",
    change: "loosened",
  },
  {
    command: "cat <<EOF > notes.txt\nhello\nEOF",
    expected: null,
    spec: "16",
    note: "an ordinary heredoc write with no removal anywhere",
  },
  {
    command: "cat <<EOF > notes.txt\n## notes\nEOF\nrm -rf ../..",
    expected: "working_directory",
    spec: "16",
    note: "a closed heredoc is data, and the command after it is judged",
    change: "tightened",
  },
  {
    command: "trap 'rm -rf ../..' EXIT",
    expected: "unparsable",
    spec: "17",
    note: "a construct the parser cannot model, naming a deletion",
  },
  {
    command: "rm -rf $((1+2))",
    expected: "unparsable",
    spec: "17",
    note: "arithmetic expansion in the target",
  },
  {
    command: "rm -rf ../.. {a,b}",
    expected: "unparsable",
    spec: "17",
    note: "brace expansion in the target",
  },
  {
    command: "rm -rf ../.. <<EOF\nx",
    expected: "unparsable",
    spec: "17",
    note: "an unclosed heredoc leaves everything after it unplaceable",
  },
  {
    command: "cat <<EOF\n$(rm -rf ../..)\nEOF",
    expected: "unparsable",
    spec: "17",
    note: "an unquoted heredoc body is expanded, so `$(…)` in it really runs",
  },
  {
    command: "grep x <<< $(rm -rf ../..)",
    expected: "unparsable",
    spec: "17",
    note: "a here-string with an expansion in it",
  },
  {
    command: "echo $((1+2))",
    expected: null,
    spec: "17",
    note: "an unreadable construct that names no deletion stays ordinary",
  },
  {
    command: `echo ${"x".repeat(12_000)}`,
    expected: null,
    spec: "18",
    note: "past the length limit the check abstains instead of guessing",
    change: "loosened",
  },
  {
    command: `echo ${"x".repeat(12_000)} && rm -rf ../..`,
    expected: null,
    spec: "18",
    note: "the stated cost of scenario 18: an over-long line is not judged",
    change: "loosened",
  },
  {
    command: nestedSubstitution(3, "$(rm -rf ../..)"),
    expected: "working_directory",
    spec: "19",
    note: "nesting this check still follows is judged by its content",
  },
  {
    command: nestedSubstitution(4, "$(rm -rf ../..)"),
    expected: "nestedSpansOverrun",
    spec: "19",
    note: "command substitution past the nesting limit",
    change: "tightened",
  },
  {
    command: nestedSubstitution(4, "$(echo hi)"),
    expected: "nestedSpansOverrun",
    spec: "19",
    note: "the limit is about depth, not about what is nested",
    change: "tightened",
  },
  {
    command: nestedShells(4),
    expected: "working_directory",
    spec: "19",
    note: "inline shells up to the limit are still read",
  },
  {
    command: nestedShells(5),
    expected: "nestedSpansOverrun",
    spec: "19",
    note: "inline shells past the limit",
    change: "tightened",
  },
  {
    command: "eval 'rm -rf ../..'",
    expected: "working_directory",
    spec: "20",
    note: "eval's argument is a command line, judged a second time",
    change: "loosened",
  },
  {
    command: "eval rm -rf ../..",
    expected: "working_directory",
    spec: "20",
    note: "eval joins its words: the same command",
  },
  {
    command: "eval 'ls -la'",
    expected: null,
    spec: "20",
    note: "a second reading that finds a read comes back cleared",
    change: "loosened",
  },
  {
    command: "eval",
    expected: null,
    spec: "20",
    note: "a bare eval with no text to read",
    change: "loosened",
  },
  {
    command: 'eval "rm -rf $CMD"',
    expected: "unparsable",
    spec: "20",
    note: "an argument that is not text yet",
  },
  {
    command: "sh -c 'ls -la'",
    expected: null,
    spec: "20",
    note: "an inline read is not a wrapper this check refuses to follow",
  },
  {
    command: "sh -lc 'rm -rf ../..'",
    expected: "working_directory",
    spec: "20",
    note: "a flag cluster that ends in `c`",
  },
  {
    command: "bash",
    expected: null,
    spec: "13",
    note: "a shell with nothing but its own flags runs no command line",
    change: "loosened",
  },
  {
    command: "bash -c",
    expected: null,
    spec: "13",
    note: "`-c` with nothing after it carries no script",
    change: "loosened",
  },
  {
    command: "printf 'rm -rf ../..' | bash",
    expected: null,
    spec: "13",
    note: "a piped body is data, not a script line — the same trade-off CC makes",
    change: "loosened",
  },
  {
    command: "diff <(rm -rf ../..) <(sort b)",
    expected: "working_directory",
    spec: "20",
    note: "a deletion inside a process substitution",
    change: "tightened",
  },
  {
    command: "rm -rf ../.. ; cat <(echo x)",
    expected: "working_directory",
    spec: "20",
    note: "the named deletion wins over the unreadable construct next to it",
    change: "tightened",
  },
  {
    command: "cat <(echo hi)",
    expected: null,
    spec: "20",
    note: "a process substitution that deletes nothing",
  },
  {
    command: "rm -rf build ; cat <(sort x)",
    expected: "unparsable",
    spec: "20",
    note: "an ordinary removal next to an unreadable construct keeps its card",
  },
  {
    command: 'D=..; rm -rf "$D"',
    expected: "working_directory",
    spec: "21",
    note: "one static assignment on this line gives the variable a value",
  },
  {
    command: 'D=/etc; rm -rf "$D"',
    expected: "system",
    spec: "21",
    note: "the assigned value is judged like any other path",
  },
  {
    command: 'D=build; rm -rf "$D"',
    expected: null,
    spec: "21",
    note: "an ordinary value gives an ordinary removal",
    change: "loosened",
  },
  {
    command: 'D=node_modules; rm -rf "$D"/cache',
    expected: null,
    spec: "21",
    note: "the same value with a suffix",
    change: "loosened",
  },
  {
    command: 'D=$(pwd); rm -rf "$D"',
    expected: "derived_var",
    spec: "21",
    note: "a right-hand side this check does not read",
    change: "tightened",
  },
  {
    command: 'D=`pwd`; rm -rf "$D"',
    expected: "derived_var",
    spec: "21",
    note: "the backtick spelling of the same right-hand side",
    change: "tightened",
  },
  {
    command: 'D="$OTHER"; rm -rf "$D"',
    expected: "derived_var",
    spec: "21",
    note: "a right-hand side that is another variable",
  },
  {
    command: 'D=..; D=build; rm -rf "$D"',
    expected: "derived_var",
    spec: "21",
    note: "two writes: neither value is the one the shell uses",
  },
  {
    command: 'for d in ..; do rm -rf "$d"; done',
    expected: "derived_var",
    spec: "21",
    note: "a loop variable is not a value this line spells out",
  },
  {
    command: 'while read d; do rm -rf "$d"; done < list',
    expected: "derived_var",
    spec: "21",
    note: "a `read` capture comes from stdin",
  },
  {
    command: 'D=.. rm -rf "$D"',
    expected: "unresolvable",
    spec: "21",
    note: "a prefix assignment belongs to that command, so `$D` is still unset",
  },
  {
    command: 'rm -rf "/${D}/sub"; D=build',
    expected: "var_root_child",
    spec: "21",
    note: "an assignment after the use says nothing about the target",
    change: "tightened",
  },
  {
    command: 'rm -rf "/${D}/sub"',
    expected: "var_root_child",
    spec: "21",
    note: "a variable spliced under the root",
    change: "tightened",
  },
  {
    command: 'rm -rf "~/$D"',
    expected: "var_root_child",
    spec: "21",
    note: "a variable spliced under the home directory",
  },
  {
    command: 'rm -rf "/$D"',
    expected: "emptyVariable",
    spec: "21",
    note: "one level shallower than the previous row: the empty value is the root",
  },
  {
    command: "rm -rf /$D",
    expected: "emptyVariable",
    spec: "21",
    note: "the unquoted spelling of the same target",
  },
  {
    command: "rm -rf $D/*",
    expected: "emptyVariable",
    spec: "21",
    note: "an empty variable leaves `/*`",
  },
  {
    command: 'rm -rf "$D"/*',
    expected: "emptyVariable",
    spec: "21",
    note: "the quoted spelling leaves the same glob",
    change: "tightened",
  },
  {
    command: 'rm -rf "$D"',
    expected: "unresolvable",
    spec: "21",
    note: "with nothing in the variable there is no target at all",
  },
  {
    command: 'rm -rf "$PWD"',
    expected: "working_directory",
    spec: "21",
    note: "`$PWD` is a directory this check can name",
    change: "tightened",
  },
  {
    command: "rm -rf $PWD",
    expected: "working_directory",
    spec: "21",
    note: "the same, unquoted",
    change: "tightened",
  },
  {
    command: 'rm -rf "$PWD/.."',
    expected: "working_directory",
    spec: "21",
    note: "the parent of the shell's own directory",
  },
  {
    command: 'rm -rf "$PWD/build"',
    expected: null,
    spec: "21",
    note: "a directory inside the session, named through `$PWD`",
    change: "loosened",
  },
  {
    command: 'rm -rf "$HOME/.cache"',
    expected: null,
    spec: "21",
    note: "a directory below home, named through `$HOME`",
    change: "loosened",
  },
  {
    command: 'rm -rf "$HOME"',
    expected: "home",
    spec: "21",
    note: "home itself through `$HOME`",
    change: "tightened",
  },
  {
    command: 'cd "$WHERE"; rm -rf "$PWD"',
    expected: "unresolvable",
    spec: "21",
    note: "a `cd` this check cannot follow makes `$PWD` unplaceable again",
  },
  {
    command: "find . -delete",
    expected: null,
    spec: "22",
    note: "a deletion shape outside this rule",
  },
  {
    command: "mv repo repo2",
    expected: null,
    spec: "22",
    note: "a move is not a removal",
  },
  {
    command: "echo 'rm -rf ../..'",
    expected: null,
    spec: "22",
    note: "quoted text is data, not a command",
  },

  // ── Structures this check can now read instead of calling unreadable: a
  // grouping paren, a function body, a query builtin, and a heredoc handed to a
  // shell (scenarios 13-14, 20). Before these the whole line came back as one
  // shapeless card; now each end of the decision is pinned by name.
  {
    command: "(cd /tmp); rm -rf .",
    expected: "working_directory",
    spec: "13",
    note: "a subshell's `cd` does not move the shell that runs the `rm`",
    change: "tightened",
  },
  {
    command: "(cd src && ls); rm -rf build",
    expected: null,
    spec: "13",
    note: "the same, with the deletion inside the session",
    change: "loosened",
  },
  {
    command: "(rm -rf ../..)",
    expected: "working_directory",
    spec: "13",
    note: "a deletion inside a subshell is a deletion",
    change: "tightened",
  },
  {
    command: "f(){ rm -rf ../..; }; f",
    expected: "working_directory",
    spec: "13",
    note: "a function body is judged by the commands it holds",
    change: "tightened",
  },
  {
    command: "f(){ rm -rf build; }; f",
    expected: null,
    spec: "13",
    note: "the same, with the deletion inside the session",
    change: "loosened",
  },
  {
    command: "command -v bash",
    expected: null,
    spec: "13",
    note: "`command -v` asks where a name resolves and runs nothing",
    change: "loosened",
  },
  {
    command: "command -v bash && rm -rf ../..",
    expected: "working_directory",
    spec: "13",
    note: "the query does not hide what runs next to it",
  },
  {
    command: "bash deploy.sh",
    expected: null,
    spec: "14",
    note: "a script file's contents never enter this judgement",
    change: "loosened",
  },
  {
    command: ["bash <<'EOF'", `rm -rf ${commandPath(WORKDIR)}`, "EOF"].join(
      "\n",
    ),
    expected: "working_directory",
    spec: "14",
    note: "a heredoc handed to a shell is that shell's script",
    change: "tightened",
  },
  {
    command: ["bash <<'EOF'", "rm -rf build", "EOF"].join("\n"),
    expected: null,
    spec: "14",
    note: "the same, with the deletion inside the session",
    change: "loosened",
  },
  {
    command: ["cat <<'EOF' | bash", "rm -rf ../..", "EOF"].join("\n"),
    expected: "working_directory",
    spec: "14",
    note: "the body reaches the shell through a pipe",
    change: "tightened",
  },
  {
    command: ["git commit -F - <<'MSG'", "rm -rf ../..", "MSG"].join("\n"),
    expected: null,
    spec: "16",
    note: "the same shape, but the body is a commit message",
    change: "loosened",
  },
  {
    command: 'V=abc; D=/tmp/$V; rm -rf "$D"',
    expected: null,
    spec: "21",
    note: "a target built from a value this line assigns",
    change: "loosened",
  },
  {
    command: 'D=/tmp/$V; rm -rf "$D"',
    expected: "derived_var",
    spec: "21",
    note: "the same, with `$V` never assigned: the value stays unknown",
  },
  {
    command: "(V=x); (rm -rf /$V)",
    expected: "emptyVariable",
    spec: "21",
    note: "a second subshell does not inherit the first one's variables",
    change: "tightened",
  },
];

// ---------------------------------------------------------------------------
// Scenarios 23-24: spelled for Git Bash on Windows. The `platform` argument is
// what the check judges by, so these rows run on any host.
// ---------------------------------------------------------------------------

const WINDOWS_READING: Row[] = [
  {
    command: "rm -rf \\",
    expected: "backslash_only",
    spec: "23",
    note: "a lone backslash is the drive root in Git Bash",
    platform: "win32",
  },
  {
    command: "rm -rf '\\'",
    expected: "backslash_only",
    spec: "23",
    note: "the same target, quoted",
    platform: "win32",
  },
  {
    command: "rm -rf \\\\",
    expected: "backslash_only",
    spec: "23",
    note: "several backslashes are the same target",
    platform: "win32",
  },
  {
    command: "rm -rf D:\\",
    expected: "unplaceable",
    spec: "24",
    note: "a drive root written with a trailing backslash the shell may eat",
    platform: "win32",
  },
  {
    command: "rm -rf D:/proj/x-tb\\",
    expected: "unplaceable",
    spec: "24",
    note: "the trailing backslash on an ordinary directory",
    platform: "win32",
  },
  {
    command: "rm -rf E:\\code\\myrepo",
    expected: "unplaceable",
    spec: "24",
    note: "bare backslashes reach the shell as a drive-relative name",
    platform: "win32",
  },
  {
    command: "rm -rf E:code",
    expected: "unplaceable",
    spec: "24",
    note: "the drive-relative name itself",
    platform: "win32",
  },
  {
    command: "rm -rf D:/proj/../other",
    expected: "unplaceable",
    spec: "24",
    note: "a drive path whose remainder is not normalised",
    platform: "win32",
  },
  {
    command: "robocopy build ../.. /PURGE",
    expected: "working_directory",
    spec: "13",
    note: "`robocopy /PURGE` empties the destination",
    platform: "win32",
  },
  {
    command: "robocopy build ../.. /MOV",
    expected: "working_directory",
    spec: "13",
    note: "`robocopy /MOV` moves, which is the same loss",
    platform: "win32",
  },
  {
    // Off Windows a lone backslash is just an odd name; the line still names a
    // removal, so it is reported as unreadable rather than as the drive root.
    command: "rm -rf \\",
    expected: "unparsable",
    spec: "23",
    note: "the same target on POSIX, where it is not the root",
    platform: "linux",
  },
];

// ---------------------------------------------------------------------------
// Scenarios 4 and 25 on a Windows host: the drive spellings are deciphered by
// `restoreWindowsPath`, which answers for the host it runs on. Skipped where
// there is no drive to name instead of being "verified" against a machine that
// cannot have one.
// ---------------------------------------------------------------------------

const WINDOWS_HOST: Row[] = [
  {
    command: `rm -rf ${OTHER_DRIVE}:/media`,
    expected: "system",
    spec: "4",
    note: "the first-level directory of any drive",
  },
  {
    command: `rm -rf ${msysPath("fake", "worktree", "repo")}`,
    expected: "working_directory",
    spec: "25",
    note: "a drive path in the `/d/x` spelling",
  },
  {
    command: `rm -rf ${cygdrivePath("fake", "worktree", "repo")}`,
    expected: "working_directory",
    spec: "25",
    note: "the `/cygdrive/d/x` spelling",
  },
  {
    command: `rm -rf '${adminSharePath("fake", "worktree", "repo")}'`,
    expected: "working_directory",
    spec: "25",
    note: "the local administrative share `//localhost/D$/x`",
  },
  {
    command: `rm -rf '\\\\?\\${OTHER_DRIVE}:\\fake'`,
    expected: "system",
    spec: "25",
    note: "a `\\\\?\\` drive path, read as the drive path it names",
  },
];

/** Scenario numbers this table covers; 10-12 are decided elsewhere. */
const DECIDED_HERE = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
  "23",
  "24",
  "25",
];

const ALL_ROWS = [...BASIC, ...CHANNELS, ...WINDOWS_READING, ...WINDOWS_HOST];

beforeEach(() => {
  vi.clearAllMocks();
  answerRealPaths(undefined);
});

describe("hard gate — path arithmetic (scenarios 1-9)", () => {
  rows(BASIC);
});

describe("hard gate — channels, data and nesting (scenarios 13-22)", () => {
  rows(CHANNELS);
});

describe("hard gate — Windows spellings read as Git Bash reads them (scenarios 23-24)", () => {
  rows(WINDOWS_READING);
});

describe.skipIf(!WINDOWS)(
  "hard gate — Windows host spellings (scenarios 4, 25)",
  () => {
    rows(WINDOWS_HOST);
  },
);

describe("hard gate — the matrix itself", () => {
  it("covers every acceptance scenario this module decides", () => {
    const covered = new Set(ALL_ROWS.map((row) => row.spec));
    expect([...covered].sort()).toEqual([...DECIDED_HERE].sort());
  });

  it("pins the behaviour changes the hardening batches made", () => {
    // Each batch widened some cases and sharpened others; both directions have
    // to stay visible in the table, or a regression has nothing to break.
    for (const change of ["loosened", "tightened"] as const) {
      expect(
        ALL_ROWS.filter((row) => row.change === change).length,
        change,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

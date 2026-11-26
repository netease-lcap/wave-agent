import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeDangerousRemoval,
  findDangerousRemoval,
  type DangerousRemoval,
} from "../../src/utils/shell/dangerousRemoval.js";

vi.mock("node:fs");

/** A worktree-shaped session: `sub` is where the shell starts. */
const WORKDIR = path.resolve(path.sep, "fake", "worktree", "repo", "sub");
const PROTECTED = [WORKDIR];
const WINDOWS = process.platform === "win32";

/**
 * The same session shape, named on drive C.
 *
 * `WORKDIR` above is `path.resolve(path.sep, …)`, which takes its drive from
 * wherever the test process happens to run: C: on a developer machine, D: on the
 * GitHub Windows runner (`D:\a\wave-agent\…`). The Windows-only cases below ask
 * *which drive a spelling names* (`/c/…`, `\\?\D:\x`), so they cannot be written
 * against a workdir whose drive moves with the host: on the runner the D:
 * spelling would name the session's own drive and the C: one nothing at all,
 * which is the same command judged two different ways.
 */
const C_DRIVE_WORKDIR = path.win32.join(
  "C:\\",
  "fake",
  "worktree",
  "repo",
  "sub",
);

/**
 * Spell a path the way a POSIX shell will hand it back. A literal `D:\x` in a
 * command line loses its backslashes to the parser (each one escapes the next
 * character), so the only faithful way to say "this very directory" is the
 * forward-slash spelling.
 */
function commandPath(p: string): string {
  return p.split(path.sep).join("/");
}

function judge(
  command: string,
  platform: NodeJS.Platform = process.platform,
): DangerousRemoval | null {
  return findDangerousRemoval({
    command,
    workdir: WORKDIR,
    protectedRoots: PROTECTED,
    platform,
  });
}

function ruleOf(
  command: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  return judge(command, platform)?.rule ?? null;
}

/** Judge the command as Windows Git Bash would read it, on any host. */
function windowsRuleOf(command: string): string | null {
  return ruleOf(command, "win32");
}

/** The same, judged against the C: session rather than the host's own drive. */
function judgeOnC(command: string): DangerousRemoval | null {
  return findDangerousRemoval({
    command,
    workdir: C_DRIVE_WORKDIR,
    protectedRoots: [C_DRIVE_WORKDIR],
    platform: "win32",
  });
}

function cDriveRuleOf(command: string): string | null {
  return judgeOnC(command)?.rule ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Every path is its own real path unless a test says otherwise.
  vi.mocked(fs.realpathSync.native).mockImplementation((target) =>
    target.toString(),
  );
});

describe("findDangerousRemoval — targets that end the session", () => {
  it("refuses the working directory itself", () => {
    expect(ruleOf("rm -rf .")).toBe("working_directory");
    expect(ruleOf(`rm -rf ${commandPath(WORKDIR)}`)).toBe("working_directory");
    expect(ruleOf(`rm -rf '${commandPath(WORKDIR)}'`)).toBe(
      "working_directory",
    );
  });

  it("refuses every ancestor of the working directory", () => {
    const worktree = path.dirname(WORKDIR);
    const repo = path.dirname(worktree);

    expect(judge("rm -rf ..")?.resolved).toBe(worktree);
    expect(judge("rm -rf ../..")?.resolved).toBe(repo);
    expect(judge(`rm -rf ${commandPath(repo)}`)?.resolved).toBe(repo);
    expect(ruleOf("rm -rf ../../..")).toBe("working_directory");
    expect(ruleOf(`rm -rf ${commandPath(path.dirname(repo))}`)).toBe(
      "working_directory",
    );
  });

  it("refuses a target that reaches the working directory through ..", () => {
    expect(ruleOf("rm -rf ./build/../..")).toBe("working_directory");
    // An absolute drive path with an un-normalised `..` segment is the other
    // half of the Windows rule: the shell may read it differently, so the
    // verdict there is "where it lands is unknown" — still a stop, and one that
    // says why — rather than the directory it would reach.
    expect(ruleOf(`rm -rf ${commandPath(WORKDIR)}/..`)).toBe(
      WINDOWS ? "unplaceable" : "working_directory",
    );
  });

  it("refuses the user's home directory", () => {
    expect(ruleOf("rm -rf ~")).toBe("home");
    expect(ruleOf(`rm -rf ${os.homedir()}`)).toBe("home");
  });

  it("refuses a filesystem root", () => {
    expect(ruleOf("rm -rf /")).toBe("root");
  });

  it("refuses a first-level system directory", () => {
    expect(ruleOf("rm -rf /etc")).toBe("system");
    expect(judge("rm -rf /etc")?.resolved).toBe(path.resolve(path.sep, "etc"));
  });

  it("refuses an rmdir of a parent", () => {
    expect(ruleOf("rmdir ..")).toBe("working_directory");
    expect(ruleOf("rmdir ../..")).toBe("working_directory");
  });

  it("refuses an rmdir -p, which walks up to the root", () => {
    expect(ruleOf("rmdir -p empty/nested")).toBe("working_directory");
  });

  it("refuses a symlink that resolves to the working directory", () => {
    const link = path.resolve(path.sep, "fake", "link-to-repo");
    vi.mocked(fs.realpathSync.native).mockImplementation((target) =>
      path.resolve(target.toString()) === link ? WORKDIR : target.toString(),
    );

    expect(judge(`rm -rf ${commandPath(link)}`)?.rule).toBe(
      "working_directory",
    );
  });

  it("refuses a target that cannot be resolved before it runs", () => {
    expect(ruleOf("rm -rf $UNKNOWN")).toBe("unresolvable");
    expect(ruleOf("rm -rf $PWD")).toBe("unresolvable");
    expect(ruleOf('rm -rf "$PWD"')).toBe("unresolvable");
    expect(ruleOf("rm -rf $(pwd)")).toBe("unresolvable");
    expect(ruleOf("rm -rf `pwd`")).toBe("unresolvable");
    expect(ruleOf('rm -rf "$DIR"/*')).toBe("unresolvable");
  });

  it("refuses a glob whose static prefix is the root or a parent", () => {
    expect(ruleOf("rm -rf /*")).not.toBeNull();
    expect(ruleOf("rm -rf ../*")).toBe("working_directory");
  });

  it("refuses a glob that crosses more than one directory level", () => {
    // One level is the ordinary "clear this directory"; two or more name a set
    // whose members cannot be listed before the command runs, which is Claude
    // Code's `multi_level_glob` (spec scene 9).
    expect(ruleOf("rm -rf logs/*/*")).toBe("multi_level_glob");
    expect(ruleOf("rm -rf */*")).toBe("multi_level_glob");
    expect(ruleOf("rm -rf logs/*/x/*")).toBe("multi_level_glob");
    const hit = judge("rm -rf logs/*/*")!;
    expect(describeDangerousRemoval(hit)).toContain("cannot be covered");
    // A glob whose static prefix is the working directory's parent keeps the
    // stronger answer.
    expect(ruleOf("rm -rf ../*/*")).toBe("working_directory");
  });

  it("reports the path it refused, so the card can name it", () => {
    const hit = judge("rm -rf ../..")!;
    expect(hit.target).toBe("../..");
    expect(describeDangerousRemoval(hit)).toContain(hit.resolved);
    expect(describeDangerousRemoval(hit)).toContain("cannot be covered");
  });
});

describe("findDangerousRemoval — shapes that hide the command", () => {
  it("finds it in a compound command", () => {
    expect(ruleOf("a && rm -rf ..")).toBe("working_directory");
    expect(ruleOf("rm -rf build ; rm -rf ../..")).toBe("working_directory");
    expect(ruleOf("chmod -R 777 . && rm -rf ..")).toBe("working_directory");
  });

  it("follows a cd inside the same command line", () => {
    expect(ruleOf("cd /elsewhere && rm -rf /elsewhere")).toBe(
      "working_directory",
    );
    expect(ruleOf("cd ../.. && rm -rf repo")).toBe("working_directory");
  });

  it("looks through wrappers", () => {
    expect(ruleOf("sudo rm -rf ../..")).toBe("working_directory");
    expect(ruleOf("sudo -u root rm -rf ../..")).toBe("working_directory");
    expect(ruleOf("env FOO=1 rm -rf ../..")).toBe("working_directory");
    expect(ruleOf("nohup rm -rf ../..")).toBe("working_directory");
    expect(ruleOf("nice -n 5 rm -rf ../..")).toBe("working_directory");
    expect(ruleOf("X=1 rm -rf ../..")).toBe("working_directory");
  });

  it("reads timeout's flags and duration, which a flag table cannot", () => {
    expect(ruleOf("timeout 5 rm -rf ../..")).toBe("working_directory");
    expect(ruleOf("timeout 2.5m rm -rf ../..")).toBe("working_directory");
    expect(ruleOf("timeout -s KILL 5 rm -rf ../..")).toBe("working_directory");
    expect(ruleOf("timeout -k 1 5 rm -rf ../..")).toBe("working_directory");
    expect(ruleOf("timeout --signal=TERM 5 rm -rf ../..")).toBe(
      "working_directory",
    );
    expect(ruleOf("timeout --kill-after=1 5 rm -rf ../..")).toBe(
      "working_directory",
    );
    expect(ruleOf("timeout -v -- 5 rm -rf ../..")).toBe("working_directory");
    expect(ruleOf("sudo timeout 5 rm -rf ../..")).toBe("working_directory");
    // Not `timeout <flags> <duration> <command>`: nothing is peeled, so this is
    // an ordinary confirmation in Claude Code as well.
    expect(ruleOf("timeout rm -rf ../..")).toBeNull();
    expect(ruleOf("timeout --nonsense 5 rm -rf ../..")).toBeNull();
  });

  it("looks inside an inline shell script", () => {
    expect(ruleOf("bash -c 'rm -rf ../..'")).toBe("working_directory");
    expect(ruleOf("sh -lc 'rm -rf ../..'")).toBe("working_directory");
    // `c` anywhere in the cluster, a `--` after it, and the two shells a session
    // rarely types: Claude Code reads all of these, so they cannot be a way past.
    expect(ruleOf("bash -ce 'rm -rf ../..'")).toBe("working_directory");
    expect(ruleOf("sh -ec 'rm -rf ../..'")).toBe("working_directory");
    expect(ruleOf("bash -c -- 'rm -rf ../..'")).toBe("working_directory");
    expect(ruleOf("hush -c 'rm -rf ../..'")).toBe("working_directory");
    expect(ruleOf("rbash -c 'rm -rf ../..'")).toBe("working_directory");
    // A multiplexer is not a shell: it is skipped only when it names one.
    expect(ruleOf("busybox sh -c 'rm -rf ../..'")).toBe("working_directory");
    expect(ruleOf("toybox sh -c 'rm -rf ../..'")).toBe("working_directory");
    expect(ruleOf("busybox -c 'rm -rf ../..'")).toBeNull();
    const elsewhere = path.resolve(path.sep, "fake", "elsewhere");
    expect(
      ruleOf(
        `sudo bash -c 'cd ${commandPath(elsewhere)} && rm -rf ${commandPath(elsewhere)}'`,
      ),
    ).toBe("working_directory");
  });

  it("refuses a relative glob behind a cd it cannot follow", () => {
    // The shell moved into a directory nothing here can name, so `build/*` hangs
    // off an unknown directory — Claude Code's `relative_glob_after_cd` (spec
    // scene 21). The alternative is reading the glob against the directory the
    // shell started in, which is not the directory the command runs in.
    expect(ruleOf("cd $DIR && rm -rf build/*")).toBe("relative_glob_after_cd");
    expect(ruleOf("cd $DIR && rm -rf ./build/*")).toBe(
      "relative_glob_after_cd",
    );
    expect(ruleOf("cd - && rm -rf build/*")).toBe("relative_glob_after_cd");
    expect(ruleOf("cd $DIR && bash -c 'rm -rf build/*'")).toBe(
      "relative_glob_after_cd",
    );
    // A cd this check *can* follow moves the reference instead — narrower than
    // Claude Code, which cannot follow any cd and so asks on every relative glob
    // behind one.
    expect(ruleOf("cd /elsewhere && rm -rf build/*")).toBeNull();
    expect(ruleOf("cd $DIR && cd /elsewhere && rm -rf build/*")).toBeNull();
    // Not a glob: the previous directory stays the reference, as in Claude Code,
    // and an absolute target never needed the cd.
    expect(ruleOf("cd $DIR && rm -rf build")).toBeNull();
    expect(ruleOf("cd $DIR && rm -rf ../..")).toBe("working_directory");
  });

  it("reads a background job, which the parser stops at", () => {
    expect(ruleOf("rm -rf ../.. &")).toBe("working_directory");
    expect(ruleOf("nohup rm -rf ../.. &")).toBe("working_directory");
  });

  it("reads a long or clustered flag set", () => {
    expect(ruleOf("rm --recursive --force ../..")).toBe("working_directory");
    expect(ruleOf("rm -fr ../..")).toBe("working_directory");
    expect(ruleOf("rm -r -f ../..")).toBe("working_directory");
    expect(ruleOf("rm -rf -- ../..")).toBe("working_directory");
  });
});

describe("findDangerousRemoval — Windows spellings", () => {
  it("refuses a backslash-only target", () => {
    // `rm -rf \` is the drive root in Git Bash, written with one character.
    expect(windowsRuleOf("rm -rf \\")).toBe("backslash_only");
    expect(windowsRuleOf("rm -rf '\\'")).toBe("backslash_only");
    expect(windowsRuleOf("rm -rf \\\\")).toBe("backslash_only");
    // On POSIX a lone backslash is just an odd name, not the root.
    expect(ruleOf("rm -rf \\", "linux")).not.toBe("backslash_only");
  });

  it("refuses a trailing backslash the shell would eat", () => {
    expect(windowsRuleOf("rm -rf D:\\")).toBe("unplaceable");
    expect(windowsRuleOf("rm -rf D:/proj/x-tb\\")).toBe("unplaceable");
    expect(windowsRuleOf("rm -rf E:/code/myrepo\\")).toBe("unplaceable");
  });

  it("reads a trailing backslash as the literal the shell passes on", () => {
    // `bash -c 'ls C:\'` lists `C:\`: bash hands the command a literal backslash,
    // so only the guard's own parser has to be taught the spelling. Judging the
    // word the line ends with instead reported a removal for every one of these.
    for (const command of [
      "ls C:\\",
      "cd C:\\",
      "cat D:\\",
      "mkdir C:\\temp\\",
      "echo hello \\",
      "git status \\",
    ]) {
      expect(windowsRuleOf(command), command).toBeNull();
    }
  });

  it("refuses a drive path Git Bash may read differently", () => {
    // A bare `\` in a command line is an escape: `E:\code\myrepo` reaches the
    // shell as `E:codemyrepo`, a drive-*relative* name.
    expect(windowsRuleOf("rm -rf E:\\code\\myrepo")).toBe("unplaceable");
    expect(windowsRuleOf('rm -rf "E:\\code\\myrepo"')).toBe("unplaceable");
    expect(windowsRuleOf("rm -rf E:code")).toBe("unplaceable");
    expect(windowsRuleOf("rm -rf D:/proj/../other")).toBe("unplaceable");
  });

  it("says what to write instead", () => {
    for (const command of ["rm -rf \\", "rm -rf E:/code/myrepo\\"]) {
      const hit = judge(command, "win32")!;
      expect(describeDangerousRemoval(hit)).toContain("cannot be covered");
      expect(describeDangerousRemoval(hit)).toContain("C:/work/build");
    }
  });

  // The restore direction is host-bound (`path.resolve` follows the host, and
  // `restoreWindowsPath` returns the path untouched off Windows), so the drive
  // it lands on only means something on Windows. The session is pinned to C: so
  // each case judges the drive the command names, whatever drive this process
  // runs from.
  it.runIf(WINDOWS)(
    "reads the MSYS spellings as the drive path they name",
    () => {
      expect(cDriveRuleOf("rm -rf /c/fake/worktree/repo")).toBe(
        "working_directory",
      );
      // `D:\fake` is a first-level directory of its own drive, and no ancestor of
      // the C: session above.
      expect(cDriveRuleOf("rm -rf /cygdrive/d/fake")).toBe("system");
      expect(cDriveRuleOf("rm -rf '//localhost/C$/fake/worktree/repo'")).toBe(
        "working_directory",
      );
    },
  );

  it.runIf(WINDOWS)("reads \\\\?\\D:\\x as D:\\x", () => {
    const hit = judgeOnC('rm -rf "\\\\?\\D:\\fake"');
    expect(hit?.rule).toBe("system");
    expect(hit?.resolved).toBe("D:\\fake");
  });

  it("leaves ordinary removals ordinary on Windows", () => {
    for (const command of [
      "rm -rf build",
      "rm -rf node_modules",
      "rm -rf build/out",
      "rmdir empty-dir",
      'echo "rm -rf .."',
      'git commit -m "fix rm bug"',
      'grep -r "rm -rf" .',
    ]) {
      expect(judge(command, "win32")).toBeNull();
    }
  });
});

describe("findDangerousRemoval — ordinary removals stay ordinary", () => {
  it("allows a directory inside the working directory", () => {
    for (const command of [
      "rm -rf build",
      "rm -rf node_modules",
      "rm -rf build/out",
      "rm a.txt",
      "rm a.txt b.txt -rf",
      "rmdir empty-dir",
      "rm -rf .git",
    ]) {
      expect(judge(command)).toBeNull();
    }
  });

  it("allows a sibling of the working directory", () => {
    expect(judge("rm -rf ../build")).toBeNull();
  });

  it("allows the ordinary glob shapes", () => {
    for (const command of [
      "rm -rf *",
      "rm -rf ./*",
      "rm -rf build/*",
      "rm -rf *.log",
      "rm -rf logs/*",
    ]) {
      expect(judge(command)).toBeNull();
    }
  });

  it("ignores a path far below a system directory", () => {
    // Spelled with forward slashes, which is the form the shell really passes:
    // a bare backslash is an escape, so `C:\usr\local` reaches `rm` as the
    // drive-relative `C:usrlocal` — a different target, judged as such.
    const target = commandPath(
      path.resolve(path.sep, "usr", "local", "lib", "x"),
    );
    expect(judge(`rm -rf ${target}`)).toBeNull();
  });

  it("ignores --help / --version, which delete nothing", () => {
    expect(judge("rm --help")).toBeNull();
    expect(judge("rm --version ../..")).toBeNull();
  });

  it("ignores a single-quoted variable, which is a literal name", () => {
    expect(judge("rm -rf '$DIR'")).toBeNull();
  });

  it("ignores deletion shapes it does not claim to cover", () => {
    expect(judge("find . -delete")).toBeNull();
    expect(judge("mv repo repo2")).toBeNull();
    expect(judge("echo 'rm -rf ../..'")).toBeNull();
    expect(judge("ls | xargs rm -rf")).toBeNull();
  });

  it("ignores spellings Claude Code does not read as a removal", () => {
    // Claude Code peels `builtin` but not `chronic`, and it compares the removal
    // command's own name without stripping a Windows executable suffix — so
    // `rm.exe -rf ..` is not a removal there, and giving it the card that cannot
    // be dismissed would be stricter than the thing we are aligning with
    // (spec scene 18). The command is still not allowed outright: an unknown
    // name gets the ordinary confirmation.
    expect(judge("chronic rm -rf ../..")).toBeNull();
    expect(judge("rm.exe -rf ../..")).toBeNull();
    expect(judge("RMDIR.BAT ..")).toBeNull();
  });

  it("still reads builtin, which Claude Code peels too", () => {
    // `builtin rm` runs the builtin `rm`, which is the same `rm`: Claude Code's
    // AST path strips `builtin` before it asks whether the command is a removal
    // (spec scene 17).
    expect(ruleOf("builtin rm -rf ../..")).toBe("working_directory");
    // The zsh precommand modifier is in Claude Code's own peel list (its `S1`).
    expect(ruleOf("noglob rm -rf ../..")).toBe("working_directory");
  });

  it("still reads a wrapper or inline shell spelled with a suffix", () => {
    // Launcher names go through the more generous normalisation: Claude Code
    // drops the path *and* the `.exe` there, so these are the plain commands.
    expect(ruleOf("sudo.exe rm -rf ../..")).toBe("working_directory");
    expect(ruleOf("bash.exe -c 'rm -rf ../..'")).toBe("working_directory");
  });

  it("ignores a command the parser cannot read", () => {
    expect(judge("eval 'rm -rf ../..'")).toBeNull();
  });
});

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
 * A path as it can appear in a command line.
 *
 * A bare word only survives the shell with forward slashes: `rm -rf C:\a\b`
 * reaches `rm` spelled `C:ab`, a drive-relative name that is *not* the directory
 * written — which is itself a thing this check now asks about. Test commands
 * therefore carry the spelling the shell really passes.
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

beforeEach(() => {
  vi.clearAllMocks();
  // Every path is its own real path unless a test says otherwise. `.native` is
  // the call the guard makes (the JS one leaves 8.3 short names alone), so it is
  // the one to stand in for.
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
    const throughParent = `rm -rf ${commandPath(WORKDIR)}/..`;
    if (WINDOWS) {
      // An absolute drive path with an un-normalised `..` segment is the other
      // half of the Windows rule: the shell may read it differently, so the
      // verdict is "where it lands is unknown" — a stop that names that, rather
      // than the directory it would reach.
      expect(ruleOf(throughParent)).toBe("unplaceable");
    } else {
      expect(ruleOf(throughParent)).toBe("working_directory");
    }
  });

  it("refuses the user's home directory", () => {
    expect(ruleOf("rm -rf ~")).toBe("home");
    expect(ruleOf(`rm -rf ${commandPath(os.homedir())}`)).toBe("home");
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

  it("looks inside an inline shell script", () => {
    expect(ruleOf("bash -c 'rm -rf ../..'")).toBe("working_directory");
    expect(ruleOf("sh -lc 'rm -rf ../..'")).toBe("working_directory");
    const elsewhere = path.resolve(path.sep, "fake", "elsewhere");
    expect(
      ruleOf(
        `sudo bash -c 'cd ${commandPath(elsewhere)} && rm -rf ${commandPath(elsewhere)}'`,
      ),
    ).toBe("working_directory");
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

  it("strips an executable suffix before judging", () => {
    expect(ruleOf("RM.EXE -rf ../..")).toBe("working_directory");
    expect(ruleOf("rmdir.BAT ../..")).toBe("working_directory");
    expect(ruleOf("/bin/rm -rf ../..")).toBe("working_directory");
  });
});

describe("findDangerousRemoval — what it cannot read, it asks about", () => {
  it("asks when the command line cannot be parsed and names a removal", () => {
    expect(ruleOf("eval 'rm -rf ../..'")).toBe("unparsable");
    expect(ruleOf("rm -rf $((1+2))")).toBe("unparsable");
    expect(ruleOf("rm -rf ../.. && echo $((1+2))")).toBe("unparsable");
    expect(ruleOf("rm -rf ../.. <<EOF\nx\nEOF")).toBe("unparsable");
    expect(ruleOf("rm -rf ../.. ; cat <(echo x)")).toBe("unparsable");
    expect(ruleOf("rm -rf ../.. {a,b}")).toBe("unparsable");
  });

  it("says why it could not read the line", () => {
    const hit = judge("rm -rf ../.. <<EOF\nx\nEOF")!;
    expect(hit.detail).toContain("heredoc");
    expect(describeDangerousRemoval(hit)).toContain("cannot be checked before");
    expect(describeDangerousRemoval(hit)).toContain("cannot be covered");
  });

  it("asks when a shell's script is a file this check never opens", () => {
    expect(ruleOf("bash deploy.sh")).toBe("unverifiable");
    expect(ruleOf("sh scripts/clean.sh -rf")).toBe("unverifiable");
  });

  it("asks when another shell owns the command line", () => {
    expect(ruleOf("cmd //c rd /s /q src")).toBe("unverifiable");
    expect(ruleOf("powershell -NoProfile -Command Remove-Item x")).toBe(
      "unverifiable",
    );
    expect(ruleOf("pwsh -File clean.ps1")).toBe("unverifiable");
    expect(ruleOf("wsl rm -rf /")).toBe("unverifiable");
    expect(ruleOf("su - postgres -c 'rm -rf x'")).toBe("unverifiable");
  });

  it("asks when the targets arrive on stdin", () => {
    expect(ruleOf("ls | xargs rm -rf")).toBe("unverifiable");
    expect(ruleOf("find . -print0 | xargs -0 rmdir")).toBe("unverifiable");
    expect(ruleOf("cat list | parallel pwsh")).toBe("unverifiable");
  });

  it("still ignores a pipe that feeds a read", () => {
    expect(judge("find . -name x | xargs grep TODO")).toBeNull();
    expect(judge("cat files | xargs wc -l")).toBeNull();
  });

  it("still ignores a heredoc that names no removal", () => {
    expect(judge("cat <<EOF > notes.txt\nhello\nEOF")).toBeNull();
  });

  it("names the command that hides the deletion", () => {
    const hit = judge("bash deploy.sh")!;
    expect(hit.detail).toBe("bash");
    expect(describeDangerousRemoval(hit)).toContain('"bash"');
  });
});

describe("findDangerousRemoval — Windows spellings", () => {
  it("asks about a backslash-only target", () => {
    // `rm -rf \` is the drive root in Git Bash, written with one character.
    expect(windowsRuleOf("rm -rf \\")).toBe("backslash_only");
    expect(windowsRuleOf("rm -rf '\\'")).toBe("backslash_only");
    expect(windowsRuleOf("rm -rf \\\\")).toBe("backslash_only");
    // On POSIX a lone backslash is just an odd name, not the root.
    expect(ruleOf("rm -rf \\", "linux")).not.toBe("backslash_only");
  });

  it("asks about a trailing backslash the shell would eat", () => {
    expect(windowsRuleOf("rm -rf D:\\")).toBe("unplaceable");
    expect(windowsRuleOf("rm -rf D:/proj/x-tb\\")).toBe("unplaceable");
    expect(windowsRuleOf("rm -rf E:/code/myrepo\\")).toBe("unplaceable");
  });

  it("asks about a drive path Git Bash may read differently", () => {
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

  // The restore direction is host-bound (`restoreWindowsPath` returns the path
  // untouched off Windows), so these two only mean something on Windows.
  it.runIf(WINDOWS)(
    "reads the MSYS spellings as the drive path they name",
    () => {
      expect(ruleOf("rm -rf /c/fake/worktree/repo", "win32")).toBe(
        "working_directory",
      );
      expect(ruleOf("rm -rf /cygdrive/d/fake", "win32")).toBe("system");
      expect(
        ruleOf("rm -rf '//localhost/C$/fake/worktree/repo'", "win32"),
      ).toBe("working_directory");
    },
  );

  it.runIf(WINDOWS)("reads \\\\?\\D:\\x as D:\\x", () => {
    const hit = judge('rm -rf "\\\\?\\D:\\fake"', "win32");
    expect(hit?.rule).toBe("system");
    expect(hit?.resolved).toBe("D:\\fake");
  });

  it("asks about robocopy when it mirrors or moves", () => {
    expect(ruleOf("robocopy build ../.. /MIR")).toBe("working_directory");
    expect(ruleOf("robocopy build ../.. /PURGE")).toBe("working_directory");
    expect(ruleOf("robocopy build ../.. /MOV")).toBe("working_directory");
  });

  it("leaves robocopy alone when it only copies", () => {
    expect(judge("robocopy build ../..")).toBeNull();
    expect(judge("robocopy build ../.. /S /E")).toBeNull();
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
      "rm -rf logs/*/*",
    ]) {
      expect(judge(command)).toBeNull();
    }
  });

  it("ignores a path far below a system directory", () => {
    const target = path.resolve(path.sep, "usr", "local", "lib", "x");
    expect(judge(`rm -rf ${commandPath(target)}`)).toBeNull();
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
  });
});

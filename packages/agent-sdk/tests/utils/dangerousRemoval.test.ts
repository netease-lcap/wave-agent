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
 * The drive the fixture sits on, upper case: `path.resolve(path.sep, …)` lands on
 * whichever drive the test runs *from* — `C:` in one checkout, `D:` in another —
 * so a Windows spelling built from a literal letter names a directory the fixture
 * has nothing to do with, and the case only means something on the machine it was
 * written on. Everything below is built from this letter instead.
 *
 * Off Windows there is no drive to name; `C` is only there to keep the commands
 * readable, since none of those spellings is read as a drive there.
 */
const DRIVE_ROOT = path.parse(WORKDIR).root;
const DRIVE = /^[A-Za-z]:\\?$/.test(DRIVE_ROOT)
  ? DRIVE_ROOT[0]!.toUpperCase()
  : "C";

/**
 * A drive the fixture is *not* on: `D:\x` is an ancestor of the working directory
 * whenever the fixture itself is on `D:`, and "every drive's first-level directory
 * is critical" can only be seen on a drive that is not.
 */
const OTHER_DRIVE = DRIVE === "Z" ? "Y" : "Z";

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
    expect(ruleOf("rm -rf $(pwd)")).toBe("unresolvable");
    expect(ruleOf("rm -rf `pwd`")).toBe("unresolvable");
    // `$PWD` and `$HOME` are not unknown: a shell always has both, so the
    // verdict is the directory itself rather than "cannot be checked".
    expect(ruleOf("rm -rf $PWD")).toBe("working_directory");
    expect(ruleOf('rm -rf "$PWD"')).toBe("working_directory");
    expect(ruleOf('rm -rf "$HOME"')).toBe("home");
    // Emptying an unknown variable leaves `/*`, which is the root's contents.
    expect(ruleOf('rm -rf "$DIR"/*')).toBe("emptyVariable");
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
    expect(ruleOf("trap 'rm -rf ../..' EXIT")).toBe("unparsable");
    expect(ruleOf("rm -rf $((1+2))")).toBe("unparsable");
    expect(ruleOf("rm -rf ../.. && echo $((1+2))")).toBe("unparsable");
    // An *unclosed* heredoc is the readable counterpart of the case below:
    // nothing after it can be placed, so the line is reported. A closed one is
    // judged by the command it belongs to.
    expect(ruleOf("rm -rf ../.. <<EOF\nx")).toBe("unparsable");
    // A process substitution is read for the commands inside it, but the
    // construct itself is still not one this check reads to the end: an
    // ordinary removal next to one keeps its card.
    expect(ruleOf("rm -rf build ; cat <(sort x)")).toBe("unparsable");
    expect(ruleOf("rm -rf ../.. {a,b}")).toBe("unparsable");
  });

  it("says why it could not read the line", () => {
    const hit = judge("rm -rf ../.. <<EOF\nx")!;
    expect(hit.detail).toContain("heredoc");
    expect(describeDangerousRemoval(hit)).toContain("cannot be checked before");
    expect(describeDangerousRemoval(hit)).toContain("cannot be covered");
  });

  it("stays silent about a shell started with no script of its own", () => {
    // The probe that opened a card in a bypass session: `command` is peeled as
    // a wrapper, leaving a shell that runs no command line of its own.
    expect(judge("command -v bash")).toBeNull();
    expect(judge("command -V sh")).toBeNull();
    expect(judge("bash")).toBeNull();
    expect(judge("bash -l")).toBeNull();
    expect(judge("bash --version")).toBeNull();
    // `-o` takes its value from the next word, which is a setting, not a script.
    expect(judge("sh -o pipefail")).toBeNull();
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
    const hit = judge("powershell -Command Remove-Item x")!;
    expect(hit.detail).toBe("powershell");
    expect(describeDangerousRemoval(hit)).toContain('"powershell"');
  });
});

describe("findDangerousRemoval — channels that carry a command line", () => {
  it("re-reads the script an inline shell carries", () => {
    expect(ruleOf("bash -c 'rm -rf ../..'")).toBe("working_directory");
    expect(ruleOf("zsh -c 'rm -rf ../..'")).toBe("working_directory");
    // The second reading uses the same rules: a read comes back cleared, not
    // as a wrapper this check refuses to follow.
    expect(judge("sh -c 'ls -la'")).toBeNull();
    // `--` ends the shell's own flags: what follows is a script file.
    expect(judge("bash -- deploy.sh")).toBeNull();
  });

  it("leaves a script file to the ordinary rules", () => {
    // Spec scenario 14: the judgment is about the text this call carries, and
    // a script that lives in a file never enters it.
    for (const command of [
      "bash deploy.sh",
      "sh scripts/clean.sh",
      "sh scripts/clean.sh -rf /",
      "zsh x.sh",
      "bash -x scripts/clean.sh",
      "python deploy.py",
    ]) {
      expect(judge(command), command).toBeNull();
    }
  });

  it("reads the command line eval is given", () => {
    expect(ruleOf("eval 'rm -rf ../..'")).toBe("working_directory");
    expect(ruleOf('eval "rm -rf ../.."')).toBe("working_directory");
    // `eval` joins its words and parses the result: the same command.
    expect(ruleOf("eval rm -rf ../..")).toBe("working_directory");
    // A read comes back cleared, not reported as an unreadable line.
    expect(judge("eval 'ls -la'")).toBeNull();
    expect(judge("eval")).toBeNull();
    // An argument that is not text yet is still reported, and so is a target
    // the second reading cannot place.
    expect(ruleOf('eval "rm -rf $CMD"')).toBe("unparsable");
    expect(ruleOf("eval 'rm -rf $DIR'")).toBe("unresolvable");
  });

  it("reads the command inside a process substitution", () => {
    // Spec scenario 20: `<( … )` carries a command line, so a deletion in it
    // is judged by the same rules instead of the line being unreadable.
    expect(ruleOf("diff <(rm -rf ../..) <(sort b)")).toBe("working_directory");
    expect(ruleOf("rm -rf ../.. ; cat <(echo x)")).toBe("working_directory");
    // Nothing to delete on either side: an ordinary read.
    expect(judge("cat <(echo hi)")).toBeNull();
  });

  it("judges what xargs runs by its fixed arguments", () => {
    // The fixed arguments are on this line, so the hit names them exactly.
    expect(judge("xargs rm -rf ..")?.rule).toBe("working_directory");
    expect(judge("xargs rm -rf ..")?.resolved).toBe(path.dirname(WORKDIR));
    expect(ruleOf("xargs -n 2 rm -rf ../..")).toBe("working_directory");
    expect(ruleOf("xargs sudo rm -rf ../..")).toBe("working_directory");
    expect(ruleOf("xargs sh -c 'rm -rf ..'")).toBe("working_directory");

    // The words on stdin are not in this line, and every one of them becomes
    // another target: a deletion whose fixed arguments place nothing dangerous,
    // or name a wildcard or a variable, is reported rather than cleared.
    for (const command of [
      "ls | xargs rm -rf",
      "find . -name x | xargs rm",
      "echo build | xargs rm -rf build",
      "find . | parallel rm -rf {}",
    ]) {
      expect(ruleOf(command), command).toBe("unverifiable");
    }

    // What it runs is not a deletion: reading a target list off a pipe is
    // exactly what these commands are for.
    expect(judge("find . -name x | xargs grep TODO")).toBeNull();
    expect(judge("cat files | parallel wc -l")).toBeNull();
  });

  it("still reports a wrapper it cannot read inside xargs", () => {
    expect(ruleOf("cat list | parallel pwsh")).toBe("unverifiable");
    expect(judge("cat list | parallel pwsh")?.detail).toBe("parallel pwsh");
  });
});

describe("findDangerousRemoval — variables the command sets", () => {
  it("judges a variable this line assigns once, from a literal", () => {
    // Spec scenario 21: a statically known value is judged as that value.
    expect(judge('D=..; rm -rf "$D"')?.rule).toBe("working_directory");
    expect(judge('D=..; rm -rf "$D"')?.target).toBe('"$D"');
    expect(judge('D=".."; rm -rf "$D"')?.resolved).toBe(path.dirname(WORKDIR));
    expect(ruleOf('D=/etc; rm -rf "$D"')).toBe("system");
    expect(ruleOf('D=/elsewhere; cd /elsewhere && rm -rf "$D"')).toBe(
      "working_directory",
    );
    // The value is ordinary, so the removal is ordinary — the same answer the
    // literal path gets.
    expect(judge('D=build; rm -rf "$D"')).toBeNull();
    expect(judge('D=node_modules; rm -rf "$D"/cache')).toBeNull();
  });

  it("does not use a value the line has not assigned yet", () => {
    // The shell expands `"$D"` before it performs the removal, so an
    // assignment further down the line says nothing about this target.
    expect(ruleOf('rm -rf "/${D}/sub"; D=build')).toBe("var_root_child");
    expect(ruleOf('rm -rf "/${D}/sub"; D=build; D=..')).toBe("var_root_child");
    // A prefix assignment belongs to that command only: `"$D"` is expanded by
    // the *current* shell, where `D` is still unset.
    expect(ruleOf('D=.. rm -rf "$D"')).toBe("unresolvable");
  });

  it("reports a variable the line derives instead of spelling out", () => {
    // Spec scenarios 8 and 21: what cannot be placed is still reported.
    expect(ruleOf('D=$(pwd); rm -rf "$D"')).toBe("derived_var");
    expect(ruleOf('D=`pwd`; rm -rf "$D"')).toBe("derived_var");
    expect(ruleOf('D="$OTHER"; rm -rf "$D"')).toBe("derived_var");
    expect(ruleOf('D=..; D=build; rm -rf "$D"')).toBe("derived_var");
    expect(ruleOf('for d in ..; do rm -rf "$d"; done')).toBe("derived_var");
    expect(ruleOf('while read d; do rm -rf "$d"; done < list')).toBe(
      "derived_var",
    );

    const hit = judge('D=$(pwd); rm -rf "$D"')!;
    expect(hit.detail).toContain("$(pwd)");
    expect(describeDangerousRemoval(hit)).toContain("cannot be covered");
  });

  it("reports a variable pinned under a fixed root prefix", () => {
    // `/$D` empties to the root itself, so it is reported as that rather than
    // as "a variable under a prefix" — see the next test.
    expect(ruleOf('rm -rf "/$D"')).toBe("emptyVariable");
    expect(ruleOf('rm -rf "/${D}/sub"')).toBe("var_root_child");
    // Same hit, two names: Windows reports the empty expansion as reaching the
    // root here, Linux reports "a variable under a prefix".
    expect(ruleOf('rm -rf "~/$D"')).toBe(
      WINDOWS ? "emptyVariable" : "var_root_child",
    );
    expect(ruleOf('rm -rf "C:/$D"')).toBe("var_root_child");
    // Whatever `D` holds, the target cannot come back inside the working
    // directory: the prefix already left it.
    expect(judge('rm -rf "~/$D"')?.resolved).toBe(path.resolve(os.homedir()));

    const hit = judge('rm -rf "/${D}/sub"')!;
    expect(hit.target).toBe('"/${D}/sub"');
    expect(describeDangerousRemoval(hit)).toContain(hit.resolved);
    expect(describeDangerousRemoval(hit)).toContain("cannot be covered");
  });

  it("reports a variable whose empty expansion reaches the root", () => {
    expect(judge("rm -rf /$D")?.rule).toBe("emptyVariable");
    expect(judge("rm -rf /$D")?.resolved).toBe(path.parse(WORKDIR).root);
    expect(ruleOf("rm -rf $D/*")).toBe("emptyVariable");
    expect(ruleOf('rm -rf "$D"/*')).toBe("emptyVariable");
    expect(ruleOf("rm -rf $D/")).toBe("emptyVariable");
    // One level down is still not "inside the project": `$D/sub` with nothing
    // in `D` is `/sub`.
    expect(judge('rm -rf "$D/sub"')?.resolved).toBe(
      path.join(path.parse(WORKDIR).root, "sub"),
    );
    expect(ruleOf('rm -rf "$D/sub"')).toBe("emptyVariable");
    // Empty with nothing left is no target at all: `rm` refuses to run.
    expect(ruleOf('rm -rf "$D"')).toBe("unresolvable");
  });

  it("places $PWD and $HOME as the directories they are", () => {
    expect(ruleOf('rm -rf "$PWD/.."')).toBe("working_directory");
    expect(ruleOf('rm -rf "$PWD/build"')).toBeNull();
    expect(ruleOf('rm -rf "$HOME/.cache"')).toBeNull();
    // A `cd` this check cannot follow makes `$PWD` unplaceable again.
    expect(ruleOf('cd "$WHERE"; rm -rf "$PWD"')).toBe("unresolvable");
  });
});

describe("findDangerousRemoval — text that is data is not a command", () => {
  it("does not read a heredoc body as commands", () => {
    // The shape this rule exists for: the message is data, so however many
    // deletions it mentions, the command is a commit.
    const commit = [
      "git add -A && git commit -F - <<'MSG'",
      "",
      "fix PowerShell quoting in the remove-item path",
      "rm -rf the old build directory",
      "",
      "MSG",
    ].join("\n");
    expect(judge(commit)).toBeNull();
    expect(judge("git commit -F - <<'MSG'\nrm -rf ../..\nMSG")).toBeNull();
    expect(
      judge('git commit -F - <<"MSG"\nPowerShell: rm -rf ../..\nMSG'),
    ).toBeNull();
    // `<<-` strips leading tabs from the body and from the closing delimiter.
    expect(judge("cat <<-EOF > notes.txt\n\trm -rf ../..\n\tEOF")).toBeNull();
  });

  it("does not read a here-string or a comment as commands", () => {
    expect(judge("grep pattern <<< 'rm -rf ../..'")).toBeNull();
    expect(judge("ls -la   # PowerShell note: rm -rf ../..")).toBeNull();
  });

  it("judges the command a heredoc belongs to", () => {
    expect(ruleOf("rm -rf ../.. <<EOF\nx\nEOF")).toBe("working_directory");
    expect(ruleOf("rm -rf ../.. <<'EOF'\nx\nEOF")).toBe("working_directory");
    expect(ruleOf("cat <<EOF > notes.txt\n## notes\nEOF\nrm -rf ../..")).toBe(
      "working_directory",
    );
  });

  it("reports a heredoc it cannot establish as data", () => {
    // Unclosed: every later line could be the delimiter, so nothing after the
    // body can be placed.
    expect(ruleOf("rm -rf ../.. <<EOF\nx")).toBe("unparsable");
    // An unquoted body is expanded, and `$(…)` in it really does run.
    expect(ruleOf("cat <<EOF\n$(rm -rf ../..)\nEOF")).toBe("unparsable");
    expect(ruleOf("grep x <<< $(rm -rf ../..)")).toBe("unparsable");
  });
});

describe("findDangerousRemoval — scale limits", () => {
  const nest = (levels: number, inner: string) =>
    `echo ${"$(echo ".repeat(levels)}${inner}${")".repeat(levels)}`;

  /** `bash -c` wrapped around `bash -c` … around a removal. */
  const shells = (levels: number) => {
    let command = "rm -rf ../..";
    for (let i = 0; i < levels; i++) {
      command = `bash -c ${JSON.stringify(command)}`;
    }
    return command;
  };

  it("does not judge a line past the length limit", () => {
    // A line is usually long because of its data (a commit message, a heredoc).
    // The cost is the one the spec states: a deletion hidden in an over-long line
    // loses this extra layer, not the confirmation `rm` gets from the ordinary
    // rules in every mode.
    const filler = "x".repeat(12_000);
    expect(judge(`echo ${filler}`)).toBeNull();
    expect(judge(`echo ${filler} && rm -rf ../..`)).toBeNull();
  });

  it("reports nesting deeper than it follows", () => {
    // Four levels are still read, and the `rm` inside them is judged.
    expect(ruleOf(nest(3, "$(rm -rf ../..)"))).toBe("working_directory");
    expect(ruleOf(nest(4, "$(rm -rf ../..)"))).toBe("nestedSpansOverrun");
    expect(ruleOf(shells(4))).toBe("working_directory");
    expect(ruleOf(shells(5))).toBe("nestedSpansOverrun");
  });

  it("says why it did not follow the nesting", () => {
    const hit = judge(nest(4, "$(rm -rf ../..)"))!;
    expect(hit.detail).toContain("command substitutions");
    expect(describeDangerousRemoval(hit)).toContain("cannot be checked before");
    expect(describeDangerousRemoval(hit)).toContain("cannot be covered");
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

  // The restore direction is host-bound: `restoreWindowsPath` answers for the
  // machine running the test, not for the `platform` argument, and off Windows
  // none of these spellings names a drive (`/d/x` is an ordinary name under `/`).
  // So each case states what it means on the host it runs on, instead of being
  // skipped on the hosts that cannot have drives.
  it("reads the MSYS spellings as the drive path they name", () => {
    // Three spellings of the repository above `sub` — `/d/…`, `/cygdrive/d/…` and
    // its `D$` share — all of them on the fixture's own drive, so all of them
    // name the directory the command would really delete.
    const spellings = [
      msysPath("fake", "worktree", "repo"),
      cygdrivePath("fake", "worktree", "repo"),
      `'${adminSharePath("fake", "worktree", "repo")}'`,
    ];
    for (const spelling of spellings) {
      expect(ruleOf(`rm -rf ${spelling}`, "win32")).toBe(
        WINDOWS ? "working_directory" : null,
      );
    }
  });

  it("reads a \\\\?\\ drive path as the drive path it names", () => {
    // On a drive the session does not work on: on the fixture's own drive the
    // path behind the prefix is an ancestor of the working directory, and the two
    // rules would not be told apart.
    const spelling = `\\\\?\\${OTHER_DRIVE}:\\fake`;
    const hit = judge(`rm -rf "${spelling}"`, "win32");
    // Off Windows the prefix names no drive: `\\?\Z:\fake` is an ordinary name,
    // backslashes and all, which lands *inside* the working directory — a removal
    // below the session, and exactly what this check lets through.
    expect(hit ? { rule: hit.rule, resolved: hit.resolved } : null).toEqual(
      WINDOWS ? { rule: "system", resolved: `${OTHER_DRIVE}:\\fake` } : null,
    );
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

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

function judge(command: string): DangerousRemoval | null {
  return findDangerousRemoval({
    command,
    workdir: WORKDIR,
    protectedRoots: PROTECTED,
  });
}

function ruleOf(command: string): string | null {
  return judge(command)?.rule ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Every path is its own real path unless a test says otherwise.
  vi.mocked(fs.realpathSync).mockImplementation((target) => target.toString());
});

describe("findDangerousRemoval — targets that end the session", () => {
  it("refuses the working directory itself", () => {
    expect(ruleOf("rm -rf .")).toBe("working_directory");
    expect(ruleOf(`rm -rf ${WORKDIR}`)).toBe("working_directory");
    expect(ruleOf(`rm -rf '${WORKDIR}'`)).toBe("working_directory");
  });

  it("refuses every ancestor of the working directory", () => {
    const worktree = path.dirname(WORKDIR);
    const repo = path.dirname(worktree);

    expect(judge("rm -rf ..")?.resolved).toBe(worktree);
    expect(judge("rm -rf ../..")?.resolved).toBe(repo);
    expect(judge(`rm -rf ${repo}`)?.resolved).toBe(repo);
    expect(ruleOf("rm -rf ../../..")).toBe("working_directory");
    expect(ruleOf(`rm -rf ${path.dirname(repo)}`)).toBe("working_directory");
  });

  it("refuses a target that reaches the working directory through ..", () => {
    expect(ruleOf("rm -rf ./build/../..")).toBe("working_directory");
    expect(ruleOf(`rm -rf ${WORKDIR}/..`)).toBe("working_directory");
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
    vi.mocked(fs.realpathSync).mockImplementation((target) =>
      path.resolve(target.toString()) === link ? WORKDIR : target.toString(),
    );

    expect(judge(`rm -rf ${link}`)?.rule).toBe("working_directory");
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
      ruleOf(`sudo bash -c 'cd ${elsewhere} && rm -rf ${elsewhere}'`),
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

  it("ignores a command the parser cannot read", () => {
    expect(judge("eval 'rm -rf ../..'")).toBeNull();
  });
});

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeDangerousTarget,
  findDangerousTarget,
  isDangerousTargetPath,
} from "../../../src/tools/powershellTool/pathValidation.js";

vi.mock("node:fs");

beforeEach(() => {
  // Symlink resolution is a filesystem call; without a stand-in every path
  // comparison would fail closed and prove nothing.
  vi.mocked(fs.realpathSync.native).mockImplementation((p) => p.toString());
});

const ROOT = path.parse(process.cwd()).root;
const WORKDIR = path.join(ROOT, "work", "project");

describe("isDangerousTargetPath", () => {
  it("should refuse a filesystem root", () => {
    expect(isDangerousTargetPath(ROOT, WORKDIR)).toBe(true);
  });

  it("should refuse a root reached by walking up", () => {
    expect(isDangerousTargetPath("../..", WORKDIR)).toBe(true);
  });

  it("should refuse a home reference however it is spelled", () => {
    for (const target of ["~", "$HOME", "$env:USERPROFILE", "%USERPROFILE%"]) {
      expect(isDangerousTargetPath(target, WORKDIR)).toBe(true);
    }
  });

  it("should refuse the real home directory spelled out", () => {
    expect(isDangerousTargetPath(os.homedir(), WORKDIR)).toBe(true);
  });

  it.skipIf(process.platform !== "win32")(
    "should refuse the Windows installation",
    () => {
      expect(isDangerousTargetPath("C:\\Windows", WORKDIR)).toBe(true);
      expect(isDangerousTargetPath("C:\\Windows\\System32", WORKDIR)).toBe(
        true,
      );
      expect(isDangerousTargetPath("C:\\Program Files", WORKDIR)).toBe(true);
    },
  );

  it.skipIf(process.platform === "win32")("should refuse /etc and /usr", () => {
    expect(isDangerousTargetPath("/etc", WORKDIR)).toBe(true);
    expect(isDangerousTargetPath("/usr/bin", WORKDIR)).toBe(true);
  });

  it("should allow an ordinary path inside the project", () => {
    expect(isDangerousTargetPath("src/index.ts", WORKDIR)).toBe(false);
    expect(isDangerousTargetPath("./dist", WORKDIR)).toBe(false);
    expect(isDangerousTargetPath("a/b/c.txt", WORKDIR)).toBe(false);
  });

  it("should allow a path below a system directory", () => {
    // Only the directory itself is refused; deleting a temp file inside it is
    // an ordinary (still confirmed) operation.
    expect(
      isDangerousTargetPath(
        path.join(ROOT, "Windows", "Temp", "x.txt"),
        WORKDIR,
      ),
    ).toBe(false);
  });

  it("should ignore an empty target", () => {
    expect(isDangerousTargetPath("", WORKDIR)).toBe(false);
    expect(isDangerousTargetPath("   ", WORKDIR)).toBe(false);
  });

  it("should resolve the same way it reports", () => {
    expect(describeDangerousTarget("..\\..", WORKDIR)).toBe(
      path.resolve(WORKDIR, "..\\.."),
    );
  });
});

describe("the session's own directories", () => {
  const PROJECT = path.join(ROOT, "work", "project", "repo");
  const SUB = path.join(PROJECT, "sub");
  const ADDED = path.join(ROOT, "work", "shared");

  it("should refuse the directory the command runs in", () => {
    expect(findDangerousTarget(".", SUB, [SUB])).toEqual({
      reason: "working_directory",
      resolved: SUB,
    });
    expect(isDangerousTargetPath(SUB, SUB, [SUB])).toBe(true);
  });

  it("should refuse an ancestor of it, however it is reached", () => {
    for (const target of ["..", "../..", PROJECT, path.join(ROOT, "work")]) {
      expect(findDangerousTarget(target, SUB, [SUB])?.reason).toBe(
        "working_directory",
      );
    }
  });

  it("should refuse an ancestor of an additional directory", () => {
    expect(findDangerousTarget(path.dirname(ADDED), SUB, [SUB, ADDED])).toEqual(
      { reason: "working_directory", resolved: path.dirname(ADDED) },
    );
  });

  it("should allow a directory inside the working directory", () => {
    // `Remove-Item .\build -Recurse` is an ordinary build cleanup: only the
    // roots themselves and their ancestors are refused.
    expect(isDangerousTargetPath("build", SUB, [SUB])).toBe(false);
    expect(isDangerousTargetPath(path.join(SUB, "build"), SUB, [SUB])).toBe(
      false,
    );
    expect(isDangerousTargetPath("build", SUB, [SUB, ADDED])).toBe(false);
  });

  it("should allow a sibling that one dot short of the ancestor", () => {
    expect(
      isDangerousTargetPath(path.join(ROOT, "work", "project", "repo2"), SUB, [
        SUB,
      ]),
    ).toBe(false);
  });

  it("should refuse a symlink that points at the working directory", () => {
    // Symlinks are resolved by `isPathAtOrAbove`, so the spelling does not
    // matter; the mock below stands in for the filesystem.
    vi.mocked(fs.realpathSync.native).mockImplementation((p) => {
      const text = p.toString();
      return text === path.resolve(SUB, "link") ? SUB : text;
    });
    expect(findDangerousTarget("link", SUB, [SUB])?.reason).toBe(
      "working_directory",
    );
  });
});

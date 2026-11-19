import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeDangerousTarget,
  isDangerousTargetPath,
} from "../../../src/tools/powershellTool/pathValidation.js";

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

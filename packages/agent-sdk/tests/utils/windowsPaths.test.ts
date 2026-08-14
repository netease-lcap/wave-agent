/**
 * Windows path → POSIX conversion utilities unit tests.
 *
 * Pure functions — no child_process involved. The real-spawn behavior these
 * utilities feed into is covered by tests/services/hook.integration.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  windowsPathToPosixPath,
  toPosixCommand,
} from "../../src/utils/windowsPaths.js";

describe("windowsPathToPosixPath", () => {
  it("converts backslash drive-letter paths", () => {
    expect(windowsPathToPosixPath("C:\\Users\\foo")).toBe("/c/Users/foo");
    expect(windowsPathToPosixPath("D:\\a\\repo\\x.js")).toBe("/d/a/repo/x.js");
  });

  it("converts forward-slash drive-letter paths", () => {
    expect(windowsPathToPosixPath("C:/Users/foo")).toBe("/c/Users/foo");
  });

  it("lowercases the drive letter", () => {
    expect(windowsPathToPosixPath("c:\\Users\\foo")).toBe("/c/Users/foo");
  });

  it("preserves UNC paths", () => {
    expect(windowsPathToPosixPath("\\\\server\\share\\dir")).toBe(
      "//server/share/dir",
    );
  });

  it("leaves already-POSIX paths intact", () => {
    expect(windowsPathToPosixPath("/home/user/file.js")).toBe(
      "/home/user/file.js",
    );
  });
});

describe("toPosixCommand", () => {
  it("converts quoted Windows paths", () => {
    expect(toPosixCommand('node "C:\\path\\script.js"')).toBe(
      'node "/c/path/script.js"',
    );
  });

  it("converts quoted Windows paths containing spaces", () => {
    expect(
      toPosixCommand('node "C:\\Program Files\\node\\script.js" arg'),
    ).toBe('node "/c/Program Files/node/script.js" arg');
  });

  it("converts bare (unquoted) Windows paths", () => {
    expect(toPosixCommand("cd C:\\repo\\src")).toBe("cd /c/repo/src");
  });

  it("leaves URLs and already-POSIX commands untouched", () => {
    expect(toPosixCommand('grep -n "x" http://example.com')).toBe(
      'grep -n "x" http://example.com',
    );
    expect(toPosixCommand("node /home/user/script.js")).toBe(
      "node /home/user/script.js",
    );
  });

  it("converts multiple Windows paths in one command", () => {
    expect(
      toPosixCommand(
        'node "C:\\a\\b.js" --config "C:\\cfg\\config.json" C:\\output',
      ),
    ).toBe('node "/c/a/b.js" --config "/c/cfg/config.json" /c/output');
  });
});

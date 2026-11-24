import { describe, expect, it } from "vitest";
import {
  interpretBashExit,
  interpretPowerShellExit,
} from "../../src/tools/shellExitCode.js";

describe("interpretBashExit", () => {
  it("reads exit 1 from a search as the command's own answer", () => {
    expect(interpretBashExit("grep -n needle src", 1)).toEqual({
      failed: false,
      interpretation: "No matches found",
    });
    expect(interpretBashExit("rg foo", 1).interpretation).toBe(
      "No matches found",
    );
    expect(interpretBashExit("/usr/bin/find . -name x", 1).interpretation).toBe(
      "Some directories were inaccessible",
    );
    expect(interpretBashExit("diff a b", 1).interpretation).toBe(
      "Files differ",
    );
    expect(interpretBashExit("test -f x", 1).interpretation).toBe(
      "Condition is false",
    );
    expect(interpretBashExit("[ -f x ]", 1).interpretation).toBe(
      "Condition is false",
    );
  });

  it("reads a git subcommand as the command", () => {
    expect(interpretBashExit("git diff --stat", 1).interpretation).toBe(
      "Files differ",
    );
    expect(interpretBashExit("git grep -n foo", 1).interpretation).toBe(
      "No matches found",
    );
    // The table covers two subcommands, not `git` as a whole.
    expect(interpretBashExit("git checkout foo", 1).failed).toBe(true);
  });

  it("still fails for exit 1 outside the table, and for other codes", () => {
    expect(interpretBashExit("exit 1", 1).failed).toBe(true);
    expect(interpretBashExit("grep x f", 2).failed).toBe(true);
    expect(interpretBashExit("grep x f", 0)).toEqual({ failed: false });
  });

  it("judges the last command of a pipeline", () => {
    // The exit code belongs to `head`, not to `rg`.
    expect(interpretBashExit("rg x f | head", 1).failed).toBe(true);
    expect(interpretBashExit("cat f | grep x", 1).interpretation).toBe(
      "No matches found",
    );
  });

  it("takes a quoted pipe and a leading assignment as data", () => {
    expect(interpretBashExit('rg "a|b" src', 1).interpretation).toBe(
      "No matches found",
    );
    expect(interpretBashExit("FOO=1 rg -n a src", 1).interpretation).toBe(
      "No matches found",
    );
  });

  it("drops the exemption when the command is an && chain", () => {
    // The last link of the chain owns the code, so its name cannot be the answer.
    expect(interpretBashExit("grep x f && echo ok", 1).failed).toBe(true);
    expect(interpretBashExit("echo ok && grep x f", 1).failed).toBe(true);
    // An `&&` inside quotes is data, not an operator.
    expect(interpretBashExit('rg "a&&b" src', 1).interpretation).toBe(
      "No matches found",
    );
  });
});

describe("interpretPowerShellExit", () => {
  it("uses the Windows side of the table", () => {
    expect(interpretPowerShellExit("findstr /n x f", 1).interpretation).toBe(
      "No matches found",
    );
    expect(interpretPowerShellExit("where node", 1).interpretation).toBe(
      "No matching files found",
    );
    expect(interpretPowerShellExit("fc a b", 1).interpretation).toBe(
      "Files differ",
    );
  });

  it("reads robocopy 0-7 as success and 8 and up as failure", () => {
    expect(interpretPowerShellExit("robocopy a b", 0)).toEqual({
      failed: false,
      interpretation: "No files copied (already in sync)",
    });
    expect(interpretPowerShellExit("robocopy a b", 1).interpretation).toBe(
      "Files copied successfully",
    );
    expect(interpretPowerShellExit("robocopy a b", 3).interpretation).toBe(
      "Files copied successfully",
    );
    expect(interpretPowerShellExit("robocopy a b", 2).interpretation).toBe(
      "Robocopy completed (no errors)",
    );
    expect(interpretPowerShellExit("robocopy a b", 8).failed).toBe(true);
  });
});

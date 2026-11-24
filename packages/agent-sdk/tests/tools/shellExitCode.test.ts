import { describe, expect, it } from "vitest";
import {
  fallbackInterpretation,
  interpretBashExit,
  interpretPowerShellExit,
} from "../../src/tools/shellExitCode.js";

describe("interpretBashExit", () => {
  it("reads exit 1 from a search as the command's own answer", () => {
    expect(interpretBashExit("grep -n needle src", 1)).toEqual({
      noteExitCode: false,
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
    expect(interpretBashExit("git checkout foo", 1)).toEqual({
      noteExitCode: true,
      interpretation: fallbackInterpretation(1),
    });
  });

  it("notes the exit code for every non-zero exit outside the table", () => {
    expect(interpretBashExit("exit 1", 1)).toEqual({
      noteExitCode: true,
      interpretation: "Command failed with exit code: 1",
    });
    expect(interpretBashExit("grep x f", 0)).toEqual({ noteExitCode: false });
  });

  it("drops the reading from a family command that exits 2 or higher", () => {
    // CC 的 `fU` 只在 `n === 1` 时给 `message`：家族内 2 起既算错、又不带解释句。
    expect(interpretBashExit("grep x f", 2)).toEqual({ noteExitCode: true });
    expect(interpretBashExit("git diff", 128)).toEqual({ noteExitCode: true });
  });

  it("judges the last command of a pipeline", () => {
    // The exit code belongs to `head`, not to `rg`.
    expect(interpretBashExit("rg x f | head", 1).interpretation).toBe(
      fallbackInterpretation(1),
    );
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

  it("judges an && chain by its last command, with no exemption", () => {
    // CC 的工具正文走 `$Kt`（家族只看最后一个命令词），带 `&&` 豁免的 `z3o` 只用于
    // 后台任务状态——所以链尾不是家族命令时，退出码属于链尾。
    expect(interpretBashExit("grep x f && echo ok", 1).noteExitCode).toBe(true);
    expect(interpretBashExit("grep x f && echo ok", 1).interpretation).toBe(
      fallbackInterpretation(1),
    );
    // 链尾是家族命令时照常读它的答案——退出码确实由它产生。
    expect(interpretBashExit("echo ok && grep x f", 1)).toEqual({
      noteExitCode: false,
      interpretation: "No matches found",
    });
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

  it("reads robocopy 0-7 as the command's own answer and 8 and up as the fallback", () => {
    expect(interpretPowerShellExit("robocopy a b", 0)).toEqual({
      noteExitCode: false,
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
    expect(interpretPowerShellExit("robocopy a b", 8)).toEqual({
      noteExitCode: true,
      interpretation: "Command failed with exit code: 8",
    });
  });
});

import { describe, it, expect } from "vitest";
import { getPowerShellPath } from "../../src/utils/shell/powershellDetection.js";
import {
  MAX_PARSE_COMMAND_BYTES,
  parsePowerShellCommand,
  resetPowerShellParserCache,
} from "../../src/utils/powershellStructure/psParser.js";

/**
 * The real thing: an actual `powershell.exe` / `pwsh.exe` doing the parse.
 *
 * Everything here is about the parts a fake cannot prove — that the argv
 * survives `CreateProcess`, that the script runs on this PowerShell version,
 * that the JSON comes back readable, that a real timeout is recognised. The
 * fixtures in `tests/utils/powershellStructure/fixtures` were captured from
 * exactly this path; this file keeps it working.
 *
 * Skipped where there is no PowerShell (macOS, Linux).
 */
const shellPath =
  process.platform === "win32" ? getPowerShellPath() : undefined;

describe.skipIf(!shellPath)("parsePowerShellCommand (real PowerShell)", () => {
  it("parses a pipeline into three commands", async () => {
    const result = await parsePowerShellCommand(
      "Get-Process | Where-Object { $_.CPU -gt 10 } | Select-Object -First 5",
    );

    expect(result.valid).toBe(true);
    expect(result.statements).toHaveLength(1);
    expect(
      result.statements[0].commands.map((command) => command.name),
    ).toEqual(["Get-Process", "Where-Object", "Select-Object"]);
    expect(result.statements[0].securityPatterns).toEqual({
      hasScriptBlocks: true,
      hasMemberInvocations: true,
    });
  });

  it("sees the commands inside a control-flow body", async () => {
    const result = await parsePowerShellCommand(
      "if (Test-Path x) { Remove-Item -Recurse x }",
    );

    expect(result.valid).toBe(true);
    expect(result.statements[0].commands).toEqual([]);
    expect(result.statements[0].nestedCommands?.map((c) => c.name)).toEqual([
      "Test-Path",
      "Remove-Item",
    ]);
  });

  it("reports a syntax error as invalid, with the parser's own message", async () => {
    // An unterminated string is a parse error on every PowerShell version (a
    // missing argument value is not — that only fails at run time).
    const result = await parsePowerShellCommand(
      "Get-ChildItem -Path 'unclosed",
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0].message.length).toBeGreaterThan(0);
    expect(result.errors[0].errorId.length).toBeGreaterThan(0);
  });

  it("round-trips a command whose text dies in an argv", async () => {
    // Quotes, `$`, a newline and non-ASCII: all of it travels as base64, and the
    // parse errors come back as UTF-8 rather than in the console codepage.
    const command = "Write-Output '中文'; Get-Item \"a b\"; # 注释";

    const result = await parsePowerShellCommand(command);

    expect(result.valid).toBe(true);
    expect(result.originalCommand).toBe(command);
    expect(result.statements[0].commands[0].args).toEqual(["中文"]);
  });

  it("answers a repeated command from the cache", async () => {
    resetPowerShellParserCache();

    const first = await parsePowerShellCommand("Get-Date -Format o");
    const second = await parsePowerShellCommand("Get-Date -Format o");

    expect(second).toBe(first);
  });

  it("refuses a command over the argv budget without spawning", async () => {
    const started = Date.now();

    const result = await parsePowerShellCommand(
      "a".repeat(MAX_PARSE_COMMAND_BYTES + 1),
    );

    expect(result.errors[0].errorId).toBe("CommandTooLong");
    // No spawn: the gate returns immediately.
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

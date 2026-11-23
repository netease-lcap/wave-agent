import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  POWERSHELL_SPAWN_FLAGS,
  createPowerShellProvider,
} from "../../../src/utils/shell/powershellProvider.js";

const SHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const TEMP_DIR = path.join(os.tmpdir(), "wave-powershell-provider-test");

describe("powershellProvider", () => {
  it("declares itself as PowerShell and keeps the resolved binary", () => {
    const provider = createPowerShellProvider(SHELL);

    expect(provider.type).toBe("powershell");
    expect(provider.shellPath).toBe(SHELL);
    // No process group: a detached child on Windows cannot have its console
    // suppressed, and this shell parents nothing long-lived.
    expect(provider.detached).toBe(false);
    expect(provider.getEnvironmentOverrides("Get-ChildItem")).toEqual({});
  });

  it("builds the spawn argv the tool hands to spawn", () => {
    const provider = createPowerShellProvider(SHELL);

    const args = provider.getSpawnArgs("Get-ChildItem -Path .");

    expect(args).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-NoLogo",
      "-Command",
      "Get-ChildItem -Path .",
    ]);
    // The flag list is exported so a second caller cannot spell it differently.
    expect(args.slice(0, -1)).toEqual([...POWERSHELL_SPAWN_FLAGS]);
  });

  it("passes the command through untouched — no shadows to install", async () => {
    const provider = createPowerShellProvider(SHELL);

    await expect(provider.prepareCommand("Get-Content .\\a.txt")).resolves.toBe(
      "Get-Content .\\a.txt",
    );
  });

  it("appends the exit probe and the CWD tracker, in that order", () => {
    const provider = createPowerShellProvider(SHELL);

    const exec = provider.buildExecCommand("Get-Location", {
      tempDir: () => TEMP_DIR,
      cwdTracking: true,
    });

    expect(
      exec.cwdFilePath.startsWith(path.join(TEMP_DIR, "wave_ps_cwd_")),
    ).toBe(true);
    // The probe has to run before the Out-File line, or the write itself would
    // decide the exit status.
    const probeAt = exec.commandString.indexOf("$_ec = if ($null -ne");
    const cwdAt = exec.commandString.indexOf("| Out-File -FilePath");
    expect(exec.commandString.startsWith("Get-Location")).toBe(true);
    expect(probeAt).toBeGreaterThan(0);
    expect(cwdAt).toBeGreaterThan(probeAt);
    // $LASTEXITCODE first (only a native program sets it), then $?, then exit.
    expect(exec.commandString).toContain(
      "$_ec = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }",
    );
    expect(exec.commandString).toContain(
      `Out-File -FilePath '${exec.cwdFilePath}' -Encoding utf8 -NoNewline`,
    );
    expect(exec.commandString.trimEnd().endsWith("exit $_ec")).toBe(true);
  });

  it("keeps the exit probe when CWD tracking is off", () => {
    const provider = createPowerShellProvider(SHELL);

    const exec = provider.buildExecCommand("Get-Location", {
      tempDir: () => TEMP_DIR,
      cwdTracking: false,
    });

    expect(exec.commandString).toContain("elseif ($?) { 0 } else { 1 }");
    expect(exec.commandString).not.toContain("Out-File");
    expect(exec.commandString.trimEnd().endsWith("exit $_ec")).toBe(true);
  });
});

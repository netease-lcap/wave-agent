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

  it("passes the command through untouched — no shadows to install", () => {
    const provider = createPowerShellProvider(SHELL);

    expect(provider.prepareCommand("Get-Content .\\a.txt")).toBe(
      "Get-Content .\\a.txt",
    );
  });

  it("adds no CWD prologue yet, and asks the temp dir only for the file path", () => {
    const provider = createPowerShellProvider(SHELL);

    const exec = provider.buildExecCommand("Get-Location", {
      tempDir: () => TEMP_DIR,
      cwdTracking: true,
    });

    expect(exec.commandString).toBe("Get-Location");
    expect(exec.cwdFilePath).toBe(path.join(TEMP_DIR, "wave_ps_cwd.tmp"));
  });
});

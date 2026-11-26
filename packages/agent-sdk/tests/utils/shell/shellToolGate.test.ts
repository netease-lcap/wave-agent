import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectShellToolGateInput,
  isPowerShellToolEnabled,
  MSG_NO_SHELL,
  MSG_POWERSHELL_MISSING,
  POWERSHELL_TOOL_ENV_VAR,
  resolveSessionShell,
  resolveShellKind,
} from "../../../src/utils/shell/shellToolGate.js";
import { isBashAvailable } from "../../../src/utils/bashAvailability.js";
import { resolveShellPath } from "../../../src/utils/shellResolver.js";
import { getPowerShellPath } from "../../../src/utils/shell/powershellDetection.js";
import { loadMergedWaveConfig } from "../../../src/services/configurationService.js";

vi.mock("../../../src/utils/bashAvailability.js", () => ({
  isBashAvailable: vi.fn(),
}));

vi.mock("../../../src/services/configurationService.js", () => ({
  loadMergedWaveConfig: vi.fn(),
}));

vi.mock("../../../src/utils/shellResolver.js", () => ({
  resolveShellPath: vi.fn(),
}));

vi.mock("../../../src/utils/shell/powershellDetection.js", () => ({
  getPowerShellPath: vi.fn(),
}));

// 每个 case 自带环境。`collectShellToolGateInput` 在 settings 没表态时回落到
// process.env，而这条变量的值常常来自开发者自己的 ~/.wave/settings.json ——
// 它经会话 env 进了测试进程，于是「没有 Git Bash 就走 PowerShell」这几条会在
// 一台把 PowerShell 工具关掉的机器上假红（实测 WAVE_USE_POWERSHELL_TOOL=0 时
// 2 条失败）。空串与未设置同义（`parseFlag` 对空串返回 undefined），钉成它就
// 是钉成「没人表态」；case 里 `vi.stubEnv` 的值仍然覆盖它。
beforeEach(() => {
  vi.stubEnv(POWERSHELL_TOOL_ENV_VAR, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const gate = (
  platform: NodeJS.Platform,
  envValue: string | undefined,
  hasGitBash: boolean,
) => ({ platform, envValue, hasGitBash });

describe("isPowerShellToolEnabled", () => {
  // The whole matrix from design §2.4: platform × hasGitBash × envValue.
  const cases: Array<[string, string | undefined, boolean, boolean]> = [
    // envValue, hasGitBash, expected on win32
    ["unset, no bash", undefined, false, true],
    ['"" , no bash', "", false, true],
    ['" 1 ", no bash', " 1 ", false, true],
    ["TRUE, no bash", "TRUE", false, true],
    ["1, no bash", "1", false, true],
    ["true, no bash", "true", false, true],
    ["yes, no bash", "yes", false, true],
    ["on, no bash", "on", false, true],
    ["0, no bash", "0", false, false],
    ["false, no bash", "false", false, false],
    ["no, no bash", "no", false, false],
    ["off, no bash", "off", false, false],
    ["unset, bash present", undefined, true, false],
    ['"" , bash present', "", true, false],
    ['" 1 ", bash present', " 1 ", true, true],
    ["TRUE, bash present", "TRUE", true, true],
    ["yes, bash present", "yes", true, true],
    ["0, bash present", "0", true, false],
    ["no, bash present", "no", true, false],
    // Unrecognised is "no opinion", not "off" — the documented cost of only
    // accepting explicit values.
    ["maybe, no bash", "maybe", false, true],
    ["maybe, bash present", "maybe", true, false],
  ];

  for (const [label, envValue, hasGitBash, expected] of cases) {
    it(`reads ${label} as ${expected ? "on" : "off"}`, () => {
      expect(isPowerShellToolEnabled(gate("win32", envValue, hasGitBash))).toBe(
        expected,
      );
    });
  }

  it("is off on every other platform, whatever the env says", () => {
    for (const platform of ["darwin", "linux"] as NodeJS.Platform[]) {
      for (const envValue of [undefined, "", "1", "0", "yes", "maybe"]) {
        expect(isPowerShellToolEnabled(gate(platform, envValue, false))).toBe(
          false,
        );
        expect(isPowerShellToolEnabled(gate(platform, envValue, true))).toBe(
          false,
        );
      }
    }
  });
});

describe("resolveShellKind", () => {
  it("picks bash on Windows when Git Bash is there and nothing asked for PowerShell", () => {
    expect(resolveShellKind(gate("win32", undefined, true))).toBe("bash");
  });

  it("picks PowerShell when the gate says so", () => {
    expect(resolveShellKind(gate("win32", undefined, false))).toBe(
      "powershell",
    );
    expect(resolveShellKind(gate("win32", "1", true))).toBe("powershell");
  });

  it("answers none when the opt-out leaves neither shell", () => {
    expect(resolveShellKind(gate("win32", "0", false))).toBe("none");
    expect(resolveShellKind(gate("win32", "off", false))).toBe("none");
  });

  it("picks bash on other platforms", () => {
    expect(resolveShellKind(gate("darwin", "1", true))).toBe("bash");
  });

  it("answers none off Windows when even bash is missing", () => {
    expect(resolveShellKind(gate("linux", undefined, false))).toBe("none");
  });
});

describe("collectShellToolGateInput", () => {
  it("prefers the settings env over the process env", () => {
    vi.mocked(loadMergedWaveConfig).mockReturnValue({
      env: { WAVE_USE_POWERSHELL_TOOL: "1" },
    } as ReturnType<typeof loadMergedWaveConfig>);
    vi.mocked(isBashAvailable).mockReturnValue(true);
    vi.stubEnv("WAVE_USE_POWERSHELL_TOOL", "0");

    expect(collectShellToolGateInput("/work")).toEqual({
      platform: process.platform,
      envValue: "1",
      hasGitBash: true,
    });

    vi.unstubAllEnvs();
  });

  it("falls back to the process env when settings say nothing", () => {
    vi.mocked(loadMergedWaveConfig).mockReturnValue({});
    vi.mocked(isBashAvailable).mockReturnValue(false);
    vi.stubEnv("WAVE_USE_POWERSHELL_TOOL", "yes");

    expect(collectShellToolGateInput("/work").envValue).toBe("yes");

    vi.unstubAllEnvs();
  });

  it("survives a failing settings read", () => {
    vi.mocked(loadMergedWaveConfig).mockImplementation(() => {
      throw new Error("EACCES");
    });
    vi.mocked(isBashAvailable).mockReturnValue(false);
    vi.stubEnv("WAVE_USE_POWERSHELL_TOOL", "1");

    expect(collectShellToolGateInput("/work").envValue).toBe("1");

    vi.unstubAllEnvs();
  });
});

describe("resolveSessionShell", () => {
  /** Pin the platform for one case; `restore()` puts it back. */
  const pinPlatform = (platform: NodeJS.Platform) => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: platform });
    return () =>
      Object.defineProperty(process, "platform", { value: original });
  };

  it("returns the Git Bash binary for a bash session", () => {
    const restore = pinPlatform("win32");
    vi.mocked(loadMergedWaveConfig).mockReturnValue({});
    vi.mocked(isBashAvailable).mockReturnValue(true);
    vi.mocked(resolveShellPath).mockReturnValue(
      "C:\\Program Files\\Git\\bin\\bash.exe",
    );

    expect(resolveSessionShell("/work")).toEqual({
      kind: "bash",
      shellPath: "C:\\Program Files\\Git\\bin\\bash.exe",
    });

    restore();
  });

  it("returns the PowerShell binary for a PowerShell session", () => {
    const restore = pinPlatform("win32");
    vi.mocked(loadMergedWaveConfig).mockReturnValue({});
    vi.mocked(isBashAvailable).mockReturnValue(false);
    vi.mocked(getPowerShellPath).mockReturnValue(
      "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    );

    expect(resolveSessionShell("/work")).toEqual({
      kind: "powershell",
      shellPath: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    });

    restore();
  });

  it("separates 'the gate chose PowerShell but it is not installed' from 'no shell at all'", () => {
    const restore = pinPlatform("win32");
    vi.mocked(loadMergedWaveConfig).mockReturnValue({});
    vi.mocked(isBashAvailable).mockReturnValue(false);
    vi.mocked(getPowerShellPath).mockReturnValue(undefined);

    // The two have different fixes ("install PowerShell 7" vs "install Git for
    // Windows"), so one shared message would send half the readers the wrong way.
    expect(resolveSessionShell("/work")).toEqual({
      problem: MSG_POWERSHELL_MISSING,
    });

    restore();
  });

  it("reports no shell when both are absent", () => {
    const restore = pinPlatform("win32");
    vi.mocked(loadMergedWaveConfig).mockReturnValue({});
    vi.mocked(isBashAvailable).mockReturnValue(false);
    vi.stubEnv("WAVE_USE_POWERSHELL_TOOL", "0");

    expect(resolveSessionShell("/work")).toEqual({ problem: MSG_NO_SHELL });

    vi.unstubAllEnvs();
    restore();
  });

  it("reports no shell when the gate says bash but no binary was found", () => {
    // Off Windows there is no PowerShell branch, so a box without bash/zsh is
    // the same dead end as a Windows box without Git for Windows.
    const restore = pinPlatform("linux");
    vi.mocked(loadMergedWaveConfig).mockReturnValue({});
    vi.mocked(isBashAvailable).mockReturnValue(false);
    vi.mocked(resolveShellPath).mockReturnValue(undefined);

    expect(resolveSessionShell("/work")).toEqual({ problem: MSG_NO_SHELL });

    restore();
  });

  it("reads the settings of the workdir it was given", () => {
    const restore = pinPlatform("win32");
    vi.mocked(loadMergedWaveConfig).mockReturnValue({});
    vi.mocked(isBashAvailable).mockReturnValue(true);
    vi.mocked(resolveShellPath).mockReturnValue("/usr/bin/bash");

    resolveSessionShell("/work/project");

    // The workdir decides which settings.json is read, so a per-project opt-out
    // is honoured here exactly as the tool registry honours it.
    expect(loadMergedWaveConfig).toHaveBeenCalledWith("/work/project");

    restore();
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  collectShellToolGateInput,
  isPowerShellToolEnabled,
  resolveShellKind,
} from "../../../src/utils/shell/shellToolGate.js";
import { isBashAvailable } from "../../../src/utils/bashAvailability.js";
import { loadMergedWaveConfig } from "../../../src/services/configurationService.js";

vi.mock("../../../src/utils/bashAvailability.js", () => ({
  isBashAvailable: vi.fn(),
}));

vi.mock("../../../src/services/configurationService.js", () => ({
  loadMergedWaveConfig: vi.fn(),
}));

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

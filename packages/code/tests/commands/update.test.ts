import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnSync, spawn, fetchMock } = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  spawn: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("child_process", () => ({ spawnSync, spawn }));

import { updateCommand } from "../../src/commands/update.js";

const MIRROR = "https://registry.npmmirror.com";
const OFFICIAL = "https://registry.npmjs.org";

/** Every terminal branch exits; throwing keeps the flow terminal — a no-op exit
 * would let the command "continue" past it and run work the branch skipped. */
class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
    this.name = "ExitSignal";
  }
}

const exitCodes: number[] = [];

// Module-level spies, accessed through these handles (oxlint's no-console flags
// a bare `console.error` member expression, even in tests).
const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
const exitSpy = vi
  .spyOn(process, "exit")
  .mockImplementation((code?: string | number | null) => {
    const exitCode = Number(code ?? 0);
    exitCodes.push(exitCode);
    throw new ExitSignal(exitCode);
  });

/** Runs the command and returns the first exit code it asked for.
 *
 * The command wraps its body in a try/catch that reports and then exits 1, so
 * the throwing exit is swallowed there and `exit(1)` lands on top of it. In a
 * real process the first exit already ended things — the first code is the
 * truth, and `exitCodes[0]` is what the assertions below read. */
async function runUpdate(): Promise<number> {
  try {
    await updateCommand();
  } catch (error) {
    if (!(error instanceof ExitSignal)) throw error;
  }
  return exitCodes[0];
}

/** A 200 npm registry response carrying just the version field we read. */
function latestResponse(version: string) {
  return { ok: true, status: 200, json: async () => ({ version }) };
}

/** The args of the final spawnSync — the install, after the detection probes. */
function installCall() {
  return spawnSync.mock.calls.at(-1) as [string, string[], object];
}

/**
 * Answers every spawnSync with the given package manager owning the global
 * install: its probes report wave-code as installed and its install succeeds,
 * while the other managers miss (non-zero status).
 */
function usePackageManager(manager: "npm" | "pnpm" | "yarn") {
  spawnSync.mockImplementation((command: string) =>
    command === manager
      ? { status: 0, stdout: "wave-code@1.3.0" }
      : { status: 1, stdout: "" },
  );
}

beforeEach(() => {
  exitCodes.length = 0;
  logSpy.mockClear();
  errorSpy.mockClear();
  exitSpy.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  usePackageManager("npm");
});

afterEach(() => {
  vi.unstubAllGlobals();
  spawnSync.mockReset();
  fetchMock.mockReset();
});

describe("updateCommand registry", () => {
  it("checks the latest version on the npm mirror, with a timeout", async () => {
    fetchMock.mockResolvedValue(latestResponse("99.0.0"));

    await runUpdate();

    expect(fetchMock.mock.calls[0][0]).toBe(`${MIRROR}/wave-code/latest`);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("installs from the mirror for npm", async () => {
    fetchMock.mockResolvedValue(latestResponse("99.0.0"));

    expect(await runUpdate()).toBe(0);
    expect(installCall()).toEqual([
      "npm",
      ["install", "-g", "wave-code@latest", `--registry=${MIRROR}`],
      { stdio: "inherit" },
    ]);
  });

  it("installs from the mirror for pnpm", async () => {
    fetchMock.mockResolvedValue(latestResponse("99.0.0"));
    usePackageManager("pnpm");

    await runUpdate();

    expect(installCall()).toEqual([
      "pnpm",
      ["add", "-g", "wave-code@latest", `--registry=${MIRROR}`],
      { stdio: "inherit" },
    ]);
  });

  it("installs from the mirror for yarn", async () => {
    fetchMock.mockResolvedValue(latestResponse("99.0.0"));
    usePackageManager("yarn");

    await runUpdate();

    expect(installCall()).toEqual([
      "yarn",
      ["global", "add", "wave-code@latest", `--registry=${MIRROR}`],
      { stdio: "inherit" },
    ]);
  });

  it("falls back to the official registry when the mirror fails, and installs from it", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"))
      .mockResolvedValueOnce(latestResponse("99.0.0"));

    await runUpdate();

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `${MIRROR}/wave-code/latest`,
      `${OFFICIAL}/wave-code/latest`,
    ]);
    // Installing from the mirror would fail for the same reason the check did.
    expect(installCall()[1]).toContain(`--registry=${OFFICIAL}`);
  });

  it("treats a non-2xx mirror response as unreachable and falls back", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) })
      .mockResolvedValueOnce(latestResponse("99.0.0"));

    await runUpdate();

    expect(fetchMock.mock.calls[1][0]).toBe(`${OFFICIAL}/wave-code/latest`);
    expect(installCall()[1]).toContain(`--registry=${OFFICIAL}`);
  });

  it("reports one error naming both registries, and installs nothing, when both fail", async () => {
    fetchMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));

    expect(await runUpdate()).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Error checking for updates"),
      expect.any(Error),
    );
    const [, error] = errorSpy.mock.calls[0];
    expect((error as Error).message).toContain(MIRROR);
    expect((error as Error).message).toContain(OFFICIAL);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("checks for updates but installs nothing when already up to date", async () => {
    fetchMock.mockResolvedValue(latestResponse("0.0.1"));

    expect(await runUpdate()).toBe(0);
    expect(spawnSync).not.toHaveBeenCalled();
  });
});

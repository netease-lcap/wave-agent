import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SandboxManager,
  commandMatchesExcludedPattern,
} from "../../src/sandbox/SandboxManager.js";
import type {
  SandboxConfiguration,
  WaveConfiguration,
} from "../../src/types/configuration.js";
import { logger } from "../../src/utils/globalLogger.js";
import { ensureRuntimeDeps } from "../../src/utils/runtimeDeps.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/**
 * The installer is not under test here — only whether the manager asks for it.
 * `includeSandbox` is the whole opt-in: without it the CLI never downloads the
 * 12MB runtime package.
 */
const installProbe = vi.hoisted(() => ({ available: true }));

vi.mock("../../src/utils/runtimeDeps.js", () => ({
  ensureRuntimeDeps: vi.fn(async () => ({ available: installProbe.available })),
}));

const WORKDIR = "/fake/project";

function createRuntime() {
  return {
    SandboxManager: {
      initialize: vi.fn(async () => {}),
      wrapWithSandbox: vi.fn(
        async (command: string) => `sandboxed[${command}]`,
      ),
      annotateStderrWithSandboxFailures: vi.fn(
        (_commandId: string, stderr: string) =>
          `${stderr}\n<sandbox_violations>\ndeny file-write /\n</sandbox_violations>`,
      ),
      updateConfig: vi.fn(),
      cleanupAfterCommand: vi.fn(),
      isSupportedPlatform: vi.fn(() => true),
    },
  };
}

function createManager(
  sandbox: SandboxConfiguration | undefined,
  options: {
    platform?: NodeJS.Platform;
    runtime?: ReturnType<typeof createRuntime> | null;
  } = {},
) {
  const runtime =
    options.runtime === undefined ? createRuntime() : options.runtime;
  const configuration: WaveConfiguration = sandbox ? { sandbox } : {};
  const manager = new SandboxManager({
    getConfiguration: () => configuration,
    workdir: WORKDIR,
    platform: options.platform ?? "darwin",
    loadRuntime: async () => runtime as never,
  });
  return { manager, runtime };
}

describe("commandMatchesExcludedPattern", () => {
  it("matches an exact command", () => {
    expect(commandMatchesExcludedPattern("npm test", "npm test")).toBe(true);
    expect(commandMatchesExcludedPattern("npm test --watch", "npm test")).toBe(
      false,
    );
  });

  it("matches a prefix pattern with `:*`", () => {
    expect(
      commandMatchesExcludedPattern("npm run test --watch", "npm run test:*"),
    ).toBe(true);
    expect(
      commandMatchesExcludedPattern("npm run test2", "npm run test:*"),
    ).toBe(false);
  });

  it("matches a wildcard pattern", () => {
    expect(commandMatchesExcludedPattern("docker ps -a", "docker *")).toBe(
      true,
    );
  });

  it("checks every subcommand of a compound command", () => {
    expect(
      commandMatchesExcludedPattern("echo hi && docker ps", "docker ps"),
    ).toBe(true);
  });

  it("matches through leading environment variables", () => {
    expect(
      commandMatchesExcludedPattern("FOO=bar docker ps", "docker ps"),
    ).toBe(true);
  });
});

describe("SandboxManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installProbe.available = true;
  });

  it("never sandboxes while the switch is off", async () => {
    const { manager, runtime } = createManager(undefined);

    const decision = await manager.decide("ls");

    expect(decision).toEqual({ sandboxed: false, reason: "disabled" });
    expect(runtime?.SandboxManager.initialize).not.toHaveBeenCalled();
  });

  it("reports Windows as unsupported and does not load the runtime", async () => {
    const { manager, runtime } = createManager(
      { enabled: true },
      { platform: "win32" },
    );

    const decision = await manager.decide("ls");

    expect(decision.sandboxed).toBe(false);
    expect(decision.reason).toContain("Windows");
    expect(runtime?.SandboxManager.initialize).not.toHaveBeenCalled();
    expect(manager.getUnavailableReason()).toContain("Windows");
  });

  it("sandboxes a command once the runtime is initialized, initializing only once", async () => {
    const { manager, runtime } = createManager({ enabled: true });

    expect((await manager.decide("ls")).sandboxed).toBe(true);
    expect((await manager.decide("pwd")).sandboxed).toBe(true);
    expect(runtime?.SandboxManager.initialize).toHaveBeenCalledTimes(1);
  });

  it("honours the model's request to run unsandboxed when policy allows it", async () => {
    const { manager } = createManager({ enabled: true });

    const decision = await manager.decide("ls", true);

    expect(decision).toEqual({
      sandboxed: false,
      reason: "requested-by-model",
    });
  });

  it("ignores the model's request when unsandboxed commands are forbidden", async () => {
    const { manager } = createManager({
      enabled: true,
      allowUnsandboxedCommands: false,
    });

    expect((await manager.decide("ls", true)).sandboxed).toBe(true);
  });

  it("keeps excluded commands outside the sandbox", async () => {
    const { manager } = createManager({
      enabled: true,
      excludedCommands: ["npm run test:*"],
    });

    const decision = await manager.decide("npm run test --watch");

    expect(decision.sandboxed).toBe(false);
    expect(decision.reason).toContain("npm run test");
  });

  it("degrades instead of auto-allowing when initialization fails", async () => {
    const runtime = createRuntime();
    runtime.SandboxManager.initialize.mockRejectedValueOnce(
      new Error("bwrap exploded"),
    );
    const { manager } = createManager(
      { enabled: true },
      { runtime: runtime as never },
    );

    const decision = await manager.decide("ls");

    expect(decision).toEqual({
      sandboxed: false,
      reason: "initialization-failed",
    });
  });

  it("wraps, annotates and cleans up", async () => {
    const { manager, runtime } = createManager({ enabled: true });
    await manager.decide("ls");

    const wrapped = await manager.wrap("ls", "/bin/bash", "tool_1");

    expect(wrapped).toBe("sandboxed[ls]");
    expect(runtime?.SandboxManager.wrapWithSandbox).toHaveBeenCalledWith(
      "ls",
      "/bin/bash",
      undefined,
      undefined,
      { commandId: "tool_1" },
    );

    expect(manager.annotate("tool_1", "boom")).toContain(
      "<sandbox_violations>",
    );
    manager.cleanup();
    expect(runtime?.SandboxManager.cleanupAfterCommand).toHaveBeenCalled();
  });

  it("initializes before wrapping, even when decide() was never called", async () => {
    // `wrapWithSandbox` uses the config registered by `initialize()`. Wrapping
    // without it would run the command under the runtime's own defaults — a
    // boundary that looks present but is not the one we computed.
    const { manager, runtime } = createManager({ enabled: true });

    const wrapped = await manager.wrap("ls", "/bin/bash", "tool_1");

    expect(wrapped).toBe("sandboxed[ls]");
    expect(runtime?.SandboxManager.initialize).toHaveBeenCalledTimes(1);
  });

  it("refuses to wrap when initialization fails", async () => {
    const runtime = createRuntime();
    runtime.SandboxManager.initialize.mockRejectedValueOnce(
      new Error("no bwrap"),
    );
    const { manager } = createManager({ enabled: true }, { runtime });

    expect(await manager.wrap("ls")).toBeNull();
  });

  it("only fails commands when failIfUnavailable is set", () => {
    const { manager } = createManager({ enabled: true });
    expect(manager.shouldFailCommand()).toBe(false);

    const { manager: strict } = createManager({
      enabled: true,
      failIfUnavailable: true,
    });
    expect(strict.shouldFailCommand()).toBe(true);
  });

  it("reports missing dependencies on Linux", () => {
    const { manager } = createManager({ enabled: true }, { platform: "linux" });

    // The test machine may or may not have the tools installed; either the
    // sandbox is available or the reason names what is missing. What must not
    // happen is a silent "available" with no dependency check behind it.
    const reason = manager.getUnavailableReason();
    if (reason) {
      expect(reason).toMatch(/bubblewrap|socat|ripgrep/);
    } else {
      expect(manager.isAvailable()).toBe(true);
    }
  });

  it("downloads the runtime package on demand, then retries the load", async () => {
    // A host-copied CLI has no node_modules, so the first sandboxed command in
    // that process is where the 12MB runtime package gets fetched.
    const runtime = createRuntime();
    // First load misses (the package is not on disk yet), the retry after the
    // download finds it.
    let loads = 0;
    const manager = new SandboxManager({
      getConfiguration: () => ({ sandbox: { enabled: true } }),
      workdir: WORKDIR,
      platform: "darwin",
      loadRuntime: async () => (++loads === 1 ? null : runtime) as never,
    });

    expect((await manager.decide("ls")).sandboxed).toBe(true);
    expect(ensureRuntimeDeps).toHaveBeenCalledWith({ includeSandbox: true });
  });

  it("degrades with a warning when the runtime cannot be downloaded", async () => {
    installProbe.available = false;
    const manager = new SandboxManager({
      getConfiguration: () => ({ sandbox: { enabled: true } }),
      workdir: WORKDIR,
      platform: "darwin",
      loadRuntime: async () => null,
    });

    const decision = await manager.decide("ls");

    // Not "sandboxed": the permission gate auto-allows on this answer, so a
    // failed install must never be reported as a sandboxed run.
    expect(decision).toEqual({
      sandboxed: false,
      reason: "initialization-failed",
    });
    expect(ensureRuntimeDeps).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("could not be downloaded"),
    );
  });
});

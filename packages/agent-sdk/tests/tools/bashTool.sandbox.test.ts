import { describe, it, expect, vi, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { spawn } from "child_process";
import { bashTool } from "../../src/tools/bashTool.js";
import type { ToolContext } from "../../src/tools/types.js";
import type { ChildProcess } from "child_process";
import { createMockTaskManager } from "../helpers/mockFactories.js";

vi.mock("child_process");
vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockSpawn = vi.mocked(spawn);
const WORKDIR = "/fake/project";
const SANDBOX_TMPDIR = path.join(os.tmpdir(), "wave-sandbox-test");

function createFakeSandbox(options: {
  sandboxed: boolean;
  failIfUnavailable?: boolean;
}) {
  return {
    decide: vi.fn(async () => ({
      sandboxed: options.sandboxed,
      reason: "disabled",
    })),
    wrap: vi.fn(async (command: string) => `SANDBOX(${command})`),
    annotate: vi.fn(
      (_commandId: string, output: string) => `${output}\n<violations/>`,
    ),
    cleanup: vi.fn(),
    prepareTempDir: vi.fn(() => SANDBOX_TMPDIR),
    getTempDir: vi.fn(() => SANDBOX_TMPDIR),
    shouldFailCommand: vi.fn(() => options.failIfUnavailable ?? false),
    getUnavailableReason: vi.fn(() => "dependencies are missing"),
  };
}

function mockChild(output = "done"): ChildProcess {
  return {
    pid: 4321,
    stdout: {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === "data") {
          setTimeout(() => callback(Buffer.from(output)), 0);
        }
      }),
    },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, callback: (code: number) => void) => {
      if (event === "exit") {
        setTimeout(() => callback(0), 5);
      }
    }),
    kill: vi.fn(),
    killed: false,
  } as unknown as ChildProcess;
}

function createContext(
  sandboxManager: ReturnType<typeof createFakeSandbox>,
): ToolContext {
  return {
    workdir: WORKDIR,
    taskManager: createMockTaskManager(),
    sandboxManager: sandboxManager as unknown as ToolContext["sandboxManager"],
  };
}

describe("bashTool — sandbox wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wraps the command, points TMPDIR at the sandbox dir and annotates violations", async () => {
    const sandboxManager = createFakeSandbox({ sandboxed: true });
    mockSpawn.mockReturnValue(mockChild());

    const result = await bashTool.execute(
      { command: "echo hi" },
      createContext(sandboxManager),
    );

    expect(sandboxManager.wrap).toHaveBeenCalledTimes(1);
    const [command, spawnOptions] = mockSpawn.mock.calls[0]!;
    expect(String(command)).toContain("SANDBOX(");
    expect(
      (spawnOptions as unknown as { env: Record<string, string> }).env.TMPDIR,
    ).toBe(SANDBOX_TMPDIR);
    expect(result.content).toContain("<violations/>");
    expect(sandboxManager.cleanup).toHaveBeenCalled();
  });

  it("runs unwrapped when the command stays outside the sandbox", async () => {
    const sandboxManager = createFakeSandbox({ sandboxed: false });
    mockSpawn.mockReturnValue(mockChild());

    await bashTool.execute(
      { command: "echo hi" },
      createContext(sandboxManager),
    );

    expect(sandboxManager.wrap).not.toHaveBeenCalled();
    const [command, spawnOptions] = mockSpawn.mock.calls[0]!;
    expect(String(command)).not.toContain("SANDBOX(");
    expect(
      (spawnOptions as unknown as { env: Record<string, string> }).env.TMPDIR,
    ).toBeUndefined();
    expect(sandboxManager.annotate).not.toHaveBeenCalled();
  });

  it("fails the call instead of running unsandboxed when the sandbox is required", async () => {
    const sandboxManager = createFakeSandbox({
      sandboxed: false,
      failIfUnavailable: true,
    });

    const result = await bashTool.execute(
      { command: "echo hi" },
      createContext(sandboxManager),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Sandbox is required but unavailable");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("passes the model's bypass request to the sandbox judgment", async () => {
    const sandboxManager = createFakeSandbox({ sandboxed: false });
    mockSpawn.mockReturnValue(mockChild());

    await bashTool.execute(
      { command: "echo hi", dangerouslyDisableSandbox: true },
      createContext(sandboxManager),
    );

    expect(sandboxManager.decide).toHaveBeenCalledWith("echo hi", true);
  });
});

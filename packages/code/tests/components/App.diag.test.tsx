import React from "react";
import { render } from "ink-testing-library";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";
import { App } from "../../src/components/App.js";
import {
  stripAnsiColors,
  hasUncommittedChanges,
  hasNewCommits,
  getDefaultRemoteBranch,
} from "wave-agent-sdk";

vi.mock("wave-agent-sdk", async () => {
  const actual = await vi.importActual("wave-agent-sdk");
  return {
    ...actual,
    Agent: {
      create: vi.fn().mockResolvedValue({
        destroy: vi.fn(),
        abortMessage: vi.fn(),
        sessionId: "test-session-id",
        messages: [],
        isLoading: false,
        isCommandRunning: false,
        isCompacting: false,
        workingDirectory: process.cwd(),
        getPermissionMode: vi.fn().mockReturnValue("default"),
        getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
        getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
        getMcpServers: vi.fn().mockReturnValue([]),
        getSlashCommands: vi.fn().mockReturnValue([]),
        getMaxInputTokens: vi.fn(() => 128000),
        setWorktreeSession: vi.fn(),
      }),
    },
    hasUncommittedChanges: vi.fn(),
    hasNewCommits: vi.fn(),
    getDefaultRemoteBranch: vi.fn(),
  };
});

vi.mock("../../src/utils/worktree.js", () => ({
  removeWorktree: vi.fn(),
}));

const D = (msg: string) => {
  process.stderr.write(`[DIAG2] ${msg}\n`);
};

const handlerSrc = (h: unknown): string => {
  const s = String(h);
  return s.slice(0, 60);
};

describe("App Component DIAG (3-test structure)", () => {
  let processOnSpy: MockInstance<typeof process.on>;
  let processOffSpy: MockInstance<typeof process.off>;

  beforeEach(() => {
    vi.clearAllMocks();
    processOnSpy = vi.spyOn(process, "on").mockImplementation(() => process);
    processOffSpy = vi.spyOn(process, "off").mockImplementation(() => process);
  });

  afterEach(() => {
    processOnSpy.mockRestore();
    processOffSpy.mockRestore();
  });

  const worktreeSession = {
    name: "test-feat",
    path: "/repo/test-feat",
    branch: "worktree-test-feat",
    repoRoot: "/repo",
    hasUncommittedChanges: false,
    hasNewCommits: false,
    isNew: false,
  };

  it("T1 should render the main interface with file count", async () => {
    const { lastFrame } = render(<App onExit={vi.fn()} />);

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("WAVE");
    });

    const sigints = processOnSpy.mock.calls.filter((c) => c[0] === "SIGINT");
    D(
      `T1 done. SIGINT regs seen by this spy=${sigints.length} (handler0=${handlerSrc(sigints[0]?.[1])}) lastFrameWAVE=true`,
    );
  });

  it("T2 should handle SIGINT and exit directly if no changes in worktree", async () => {
    const onExit = vi.fn();

    vi.mocked(hasUncommittedChanges).mockReturnValue(false);
    vi.mocked(hasNewCommits).mockReturnValue(false);
    vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");

    render(<App onExit={onExit} worktreeSession={worktreeSession} />);

    const sigintCalls = processOnSpy.mock.calls.filter(
      (c) => c[0] === "SIGINT",
    );
    const allSigs = processOnSpy.mock.calls.map((c) => c[0]).join(",");
    const found = sigintCalls[0]?.[1] as (() => Promise<void>) | undefined;
    D(
      `T2 found handler=${handlerSrc(found)} totalRegs=${processOnSpy.mock.calls.length} sigs=[${allSigs}]`,
    );
    if (found) {
      await found();
    }
    D(
      `T2 after invoke: onExit=${onExit.mock.calls.length} hasU=${vi.mocked(hasUncommittedChanges).mock.calls.length} hasN=${vi.mocked(hasNewCommits).mock.calls.length} gdrb=${vi.mocked(getDefaultRemoteBranch).mock.calls.length}`,
    );
    expect(onExit).toHaveBeenCalledWith(true);
  });

  it("T3 should show exit prompt on SIGINT if there are changes in worktree", async () => {
    const onExit = vi.fn();

    vi.mocked(hasUncommittedChanges).mockReturnValue(true);
    vi.mocked(hasNewCommits).mockReturnValue(false);
    vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");

    const { lastFrame } = render(
      <App onExit={onExit} worktreeSession={worktreeSession} />,
    );

    const sigintCalls = processOnSpy.mock.calls.filter(
      (c) => c[0] === "SIGINT",
    );
    const found = sigintCalls[0]?.[1] as (() => Promise<void>) | undefined;
    D(
      `T3 found handler=${handlerSrc(found)} sigintRegs=${sigintCalls.length} totalRegs=${processOnSpy.mock.calls.length}`,
    );
    if (found) {
      await found();
    }
    await new Promise((r) => setTimeout(r, 300));
    D(
      `T3 after handler+300ms: onExit=${onExit.mock.calls.length} hasU=${vi.mocked(hasUncommittedChanges).mock.calls.length} hasN=${vi.mocked(hasNewCommits).mock.calls.length} gdrb=${vi.mocked(getDefaultRemoteBranch).mock.calls.length}`,
    );
    D(`T3 lastFrame=[${JSON.stringify(stripAnsiColors(lastFrame() || ""))}]`);

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain(
        "Exiting worktree session",
      );
    });

    expect(onExit).not.toHaveBeenCalled();
    D("T3 PASS");
  });
});

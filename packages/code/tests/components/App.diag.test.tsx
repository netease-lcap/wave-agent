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

describe("App Component DIAG", () => {
  let processOnSpy: MockInstance<typeof process.on>;
  let processOffSpy: MockInstance<typeof process.off>;
  const log = (msg: string) => {
    process.stderr.write(`[DIAG] ${msg}\n`);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    processOnSpy = vi.spyOn(process, "on").mockImplementation(() => process);
    processOffSpy = vi.spyOn(process, "off").mockImplementation(() => process);
  });

  afterEach(() => {
    processOnSpy.mockRestore();
    processOffSpy.mockRestore();
  });

  it("DIAG: trace exit prompt flow", async () => {
    log(`platform=${process.platform} cwd=${process.cwd()}`);
    const onExit = vi.fn();
    const worktreeSession = {
      name: "test-feat",
      path: "/repo/test-feat",
      branch: "worktree-test-feat",
      repoRoot: "/repo",
      hasUncommittedChanges: false,
      hasNewCommits: false,
      isNew: false,
    };

    vi.mocked(hasUncommittedChanges).mockReturnValue(true);
    vi.mocked(hasNewCommits).mockReturnValue(false);
    vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");

    // Restore real process.on/off so uncaughtException handlers actually register
    processOnSpy.mockRestore();
    processOffSpy.mockRestore();
    const errs: unknown[] = [];
    const onErr = (e: unknown) => {
      errs.push(e);
      log(
        `UNCAUGHT: ${String(e)}\n${e instanceof Error ? (e.stack ?? "") : ""}`,
      );
    };
    process.on("uncaughtException", onErr);
    process.on("unhandledRejection", onErr);
    processOnSpy = vi.spyOn(process, "on").mockImplementation(() => process);
    processOffSpy = vi.spyOn(process, "off").mockImplementation(() => process);

    const { lastFrame, frames } = render(
      <App onExit={onExit} worktreeSession={worktreeSession} />,
    );

    await new Promise((r) => setTimeout(r, 200));
    log(
      `initial: hasUncommittedChanges.calls=${vi.mocked(hasUncommittedChanges).mock.calls.length} lastFrame=${JSON.stringify(lastFrame())}`,
    );

    const sigintCalls = processOnSpy.mock.calls.filter(
      (c) => c[0] === "SIGINT",
    );
    log(`SIGINT registrations: ${sigintCalls.length}`);
    sigintCalls.forEach((c, i) => {
      log(`  handler#${i}: ${String(c[1]).slice(0, 100)}`);
    });

    const handler = sigintCalls[0][1] as () => Promise<void>;
    log(`onExit.calls before handler: ${onExit.mock.calls.length}`);
    await handler();
    log(
      `after handler: onExit.calls=${onExit.mock.calls.length} hasUncommittedChanges.calls=${vi.mocked(hasUncommittedChanges).mock.calls.length} hasNewCommits.calls=${vi.mocked(hasNewCommits).mock.calls.length} getDefaultRemoteBranch.calls=${vi.mocked(getDefaultRemoteBranch).mock.calls.length}`,
    );
    log(
      `lastFrame after handler: ${JSON.stringify(stripAnsiColors(lastFrame() ?? ""))}`,
    );

    await new Promise((r) => setTimeout(r, 500));
    log(
      `after 500ms: lastFrame=${JSON.stringify(stripAnsiColors(lastFrame() ?? ""))}`,
    );
    log(
      `frames=${JSON.stringify(frames.map((f) => stripAnsiColors(f ?? "").slice(0, 60)))}`,
    );

    let asserted = false;
    try {
      await vi.waitFor(() => {
        const f = stripAnsiColors(lastFrame() || "");
        if (!f.includes("Exiting worktree session")) {
          throw new Error(`frame=${JSON.stringify(f.slice(0, 100))}`);
        }
      });
      asserted = true;
    } finally {
      log(
        `waitFor ok=${asserted} errs=${errs.map((e) => String(e).slice(0, 200)).join(" | ")}`,
      );
      process.off("uncaughtException", onErr);
      process.off("unhandledRejection", onErr);
    }

    expect(asserted).toBe(true);
  });
});

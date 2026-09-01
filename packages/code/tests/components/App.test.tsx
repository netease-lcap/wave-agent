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
        displayMessages: [],
        isLoading: false,
        isCommandRunning: false,
        isCompacting: false,
        workingDirectory: process.cwd(),
        getPermissionMode: vi.fn().mockReturnValue("default"),
        getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
        getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
        getMcpServers: vi.fn().mockReturnValue([]),
        getSlashCommands: vi.fn().mockReturnValue([]),
        getHooksByScope: vi.fn().mockReturnValue(Promise.resolve({})),
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

describe("App Component", () => {
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

  it("should render the main interface with file count", async () => {
    const { lastFrame } = render(<App onExit={vi.fn()} />);

    // Wait for the component to initialize and render
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("WAVE");
    });
  });

  it("should handle SIGINT and exit directly if no changes in worktree", async () => {
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

    vi.mocked(hasUncommittedChanges).mockReturnValue(false);
    vi.mocked(hasNewCommits).mockReturnValue(false);
    vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");

    render(<App onExit={onExit} worktreeSession={worktreeSession} />);

    // Simulate SIGINT. ChatWithExitPrompt registers its handler in a useEffect,
    // and signal-exit (loaded by Ink on construction) registers its own internal
    // listener first — so the component handler is always the LAST SIGINT
    // registration. Wait for it instead of racing the effect, and pick the last
    // one to avoid invoking signal-exit's internal no-op listener (which would
    // leave the state mocks uncalled and produce an empty frame on CI).
    const handleSignal = await vi.waitFor(() => {
      const sigintCalls = processOnSpy.mock.calls.filter(
        (call) => call[0] === "SIGINT",
      );
      const handler = sigintCalls[sigintCalls.length - 1]?.[1];
      expect(handler).toBeDefined();
      return handler as () => Promise<void>;
    });
    await handleSignal();

    expect(onExit).toHaveBeenCalledWith(true);
  });

  it("should show exit prompt on SIGINT if there are changes in worktree", async () => {
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

    const { lastFrame } = render(
      <App onExit={onExit} worktreeSession={worktreeSession} />,
    );

    // Simulate SIGINT. Same handler lookup as the previous test: the component's
    // handler is the LAST SIGINT registration (signal-exit registers first).
    const handleSignal = await vi.waitFor(() => {
      const sigintCalls = processOnSpy.mock.calls.filter(
        (call) => call[0] === "SIGINT",
      );
      const handler = sigintCalls[sigintCalls.length - 1]?.[1];
      expect(handler).toBeDefined();
      return handler as () => Promise<void>;
    });
    await handleSignal();

    await vi.waitFor(
      () => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "Exiting worktree session",
        );
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "You have uncommitted changes",
        );
      },
      // Loaded CI runners can be slow; give the prompt render headroom.
      { timeout: 5000 },
    );

    expect(onExit).not.toHaveBeenCalled();
  });
});

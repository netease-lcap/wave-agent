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

    // Simulate SIGINT
    const handleSignal = processOnSpy.mock.calls.find(
      (call) => call[0] === "SIGINT",
    )![1] as () => Promise<void>;
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

    // Simulate SIGINT
    const handleSignal = processOnSpy.mock.calls.find(
      (call) => call[0] === "SIGINT",
    )![1] as () => Promise<void>;
    await handleSignal();

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain(
        "Exiting worktree session",
      );
      expect(stripAnsiColors(lastFrame() || "")).toContain(
        "You have uncommitted changes",
      );
    });

    expect(onExit).not.toHaveBeenCalled();
  });
});

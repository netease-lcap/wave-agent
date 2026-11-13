import React from "react";
import { cleanup, render } from "../helpers/inkHarness.js";
import { afterEach, describe, it, expect, vi } from "vitest";
import type { Message, ToolBlock } from "wave-agent-sdk";
import { DiffManager } from "../../src/components/DiffManager.js";
import { getWorkspaceDiff } from "../../src/utils/workspaceDiff.js";
import type { WorkspaceDiffResult } from "../../src/utils/workspaceDiff.js";

vi.mock("../../src/utils/workspaceDiff.ts", () => ({
  getWorkspaceDiff: vi.fn(),
}));

const DOWN = "\u001B[B";
const UP = "\u001B[A";
const RIGHT = "\u001B[C";
const LEFT = "\u001B[D";
const ENTER = "\r";
const ESC = "\u001B";
const PAGE_DOWN = "\u001B[6~";
const PAGE_UP = "\u001B[5~";

const WORKSPACE_ROOT = "C:\\repo";

const workspaceResult: WorkspaceDiffResult = {
  kind: "ok",
  base: { label: "HEAD", sha: "abc", kind: "head", ref: null },
  scope: { kind: "uncommitted" },
  commits: [],
  files: [
    {
      path: "src/a.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
      hunks: [
        "@@ -1,2 +1,3 @@",
        " context",
        "-old line",
        "+new line",
        "+extra",
      ].join("\n"),
      truncated: false,
      binary: false,
    },
    {
      path: "src/b.ts",
      status: "untracked",
      additions: 1,
      deletions: 0,
      hunks: "+only line",
      truncated: false,
      binary: false,
    },
  ],
};

const editBlock = (
  filePath: string,
  oldString: string,
  newString: string,
): ToolBlock => ({
  type: "tool",
  name: "Edit",
  parameters: JSON.stringify({
    file_path: filePath,
    old_string: oldString,
    new_string: newString,
  }),
  stage: "end",
  success: true,
  startLineNumber: 1,
});

const turnMessages = (
  prompt: string,
  filePath: string,
  oldString: string,
  newString: string,
): Message[] => [
  {
    id: "u1",
    role: "user",
    timestamp: new Date().toISOString(),
    blocks: [{ type: "text", content: prompt, stage: "end" }],
  },
  {
    id: "a1",
    role: "assistant",
    timestamp: new Date().toISOString(),
    blocks: [editBlock(filePath, oldString, newString)],
  },
];

const renderDiff = (messages: Message[] = []) => {
  const onCancel = vi.fn();
  const harness = render(
    <DiffManager
      workspaceRoot={WORKSPACE_ROOT}
      messages={messages}
      onCancel={onCancel}
      maxHeight={20}
    />,
  );
  return { ...harness, onCancel };
};

describe("DiffManager", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(getWorkspaceDiff).mockReset();
  });

  it("lists the uncommitted files with their line counts", async () => {
    vi.mocked(getWorkspaceDiff).mockResolvedValue(workspaceResult);
    const { lastFrame } = renderDiff();

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("src/a.ts");
    });
    const frame = lastFrame();
    expect(frame).toContain("Uncommitted changes");
    expect(frame).toContain("2 files changed +3 -1");
    expect(frame).toContain("src/b.ts");
    expect(getWorkspaceDiff).toHaveBeenCalledWith(WORKSPACE_ROOT, {
      uncommitted: true,
    });
  });

  it("opens the selected file's hunks and goes back with Escape", async () => {
    vi.mocked(getWorkspaceDiff).mockResolvedValue(workspaceResult);
    const { lastFrame, stdin, settle } = renderDiff();
    await vi.waitFor(() => expect(lastFrame()).toContain("src/a.ts"));

    stdin.write(ENTER);
    await settle();
    let frame = lastFrame();
    expect(frame).toContain("@@ -1,2 +1,3 @@");
    expect(frame).toContain("-old line");
    expect(frame).toContain("+new line");
    expect(frame).toContain("Esc back");

    // A lone ESC is held by ink's pending-escape timer before it dispatches,
    // so this one has to be waited for rather than settled.
    stdin.write(ESC);
    await vi.waitFor(() => expect(lastFrame()).not.toContain("@@"));
    frame = lastFrame();
    expect(frame).toContain("Uncommitted changes");
    expect(frame).toContain("▶ src/a.ts");
  });

  it("walks the file list with the arrow keys", async () => {
    vi.mocked(getWorkspaceDiff).mockResolvedValue(workspaceResult);
    const { lastFrame, stdin, settle } = renderDiff();
    await vi.waitFor(() => expect(lastFrame()).toContain("src/a.ts"));

    expect(lastFrame()).toContain("▶ src/a.ts");
    stdin.write(DOWN);
    await settle();
    expect(lastFrame()).toContain("▶ src/b.ts");

    stdin.write(ENTER);
    await settle();
    expect(lastFrame()).toContain("+only line");

    stdin.write(ESC);
    await vi.waitFor(() => expect(lastFrame()).not.toContain("+only line"));
    stdin.write(UP);
    await settle();
    expect(lastFrame()).toContain("▶ src/a.ts");
  });

  it("closes the overlay on Escape from the list", async () => {
    vi.mocked(getWorkspaceDiff).mockResolvedValue(workspaceResult);
    const { lastFrame, stdin, onCancel } = renderDiff();
    await vi.waitFor(() => expect(lastFrame()).toContain("src/a.ts"));

    stdin.write(ESC);
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
  });

  it("switches to a turn's own changes with the right arrow", async () => {
    vi.mocked(getWorkspaceDiff).mockResolvedValue(workspaceResult);
    const { lastFrame, stdin, settle } = renderDiff(
      turnMessages("fix the greeting", "src/turn.ts", "hello", "hi"),
    );
    await vi.waitFor(() => expect(lastFrame()).toContain("src/a.ts"));

    stdin.write(RIGHT);
    await settle();
    let frame = lastFrame();
    expect(frame).toContain("Turn 1");
    expect(frame).toContain('"fix the greeting"');
    expect(frame).toContain("src/turn.ts");

    stdin.write(ENTER);
    await settle();
    frame = lastFrame();
    expect(frame).toContain("-hello");
    expect(frame).toContain("+hi");

    // Left goes back to the uncommitted range.
    stdin.write(ESC);
    await vi.waitFor(() => expect(lastFrame()).not.toContain("@@"));
    stdin.write(LEFT);
    await vi.waitFor(() =>
      expect(lastFrame()).toContain("Uncommitted changes"),
    );
  });

  it("scrolls a hunk that is taller than the detail viewport", async () => {
    const lines = Array.from({ length: 60 }, (_, i) => `+line ${i}`);
    vi.mocked(getWorkspaceDiff).mockResolvedValue({
      ...workspaceResult,
      files: [
        {
          path: "src/big.ts",
          status: "modified",
          additions: 60,
          deletions: 0,
          hunks: ["@@ -0,0 +1,60 @@", ...lines].join("\n"),
          truncated: false,
          binary: false,
        },
      ],
    });
    const { lastFrame, stdin, settle } = renderDiff();
    await vi.waitFor(() => expect(lastFrame()).toContain("src/big.ts"));

    stdin.write(ENTER);
    await settle();
    expect(lastFrame()).toContain("line 0");
    expect(lastFrame()).not.toContain("line 59");

    // One page per press, so a single keypress already moves the viewport off
    // the top. Press-per-frame loops pay for a full render per keystroke
    // (~120ms on the Windows runner) and can spend the whole test timeout.
    //
    // Yield one macrotask before the key: the detail frame is painted from the
    // commit where the row count is still 0 (nothing to scroll), and the
    // measured count only lands in the *next* commit — which React schedules as
    // its own macrotask, after `settle()`'s stdout barrier (a microtask) is
    // already done. A page key written in that window is handled by a viewport
    // that still believes there is nothing to scroll and is swallowed: this
    // file failed on every local run this way while passing on CI runners
    // (2026-11-13, #2918), where the second commit happens to be in before the
    // key. Yielding once puts the measured commit first.
    await new Promise((resolve) => setImmediate(resolve));
    stdin.write(PAGE_DOWN);
    await vi.waitFor(() => expect(lastFrame()).toContain("↑"));
    expect(lastFrame()).not.toContain("line 0");
    expect(lastFrame()).toContain("Esc back");

    stdin.write(PAGE_UP);
    await vi.waitFor(() => expect(lastFrame()).toContain("line 0"));
  });

  it("explains why there is nothing to show outside a git repository", async () => {
    vi.mocked(getWorkspaceDiff).mockResolvedValue({ kind: "not-a-repo" });
    const { lastFrame } = renderDiff();

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Not a git repository");
    });
  });

  it("refuses to present a half-finished merge as the user's diff", async () => {
    vi.mocked(getWorkspaceDiff).mockResolvedValue({
      kind: "transient",
      operation: "rebase",
    });
    const { lastFrame } = renderDiff();

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("A rebase is in progress");
    });
  });
});

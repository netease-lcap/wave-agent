import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(() => true) };
});

vi.mock("wave-agent-sdk", () => ({
  PathEncoder: vi.fn().mockImplementation(function () {
    return {
      encode: vi.fn().mockImplementation(async (p: string) => p),
      encodeSync: vi.fn().mockImplementation((p: string) => p),
    };
  }),
  listSessions: vi.fn().mockResolvedValue([]),
  listAllSessions: vi.fn().mockResolvedValue([]),
  truncateContent: vi.fn().mockImplementation((s: string) => s),
}));

vi.mock("../../src/utils/worktree.js", () => ({
  listWorktrees: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/utils/clipboard.js", () => ({
  setClipboardText: vi.fn().mockResolvedValue(true),
}));

import { ResumeCommand } from "../../src/components/ResumeCommand.js";
import * as sdk from "wave-agent-sdk";
import { listWorktrees } from "../../src/utils/worktree.js";
import { setClipboardText } from "../../src/utils/clipboard.js";

const NEWER_ID = "87654321-4321-1234-5678-210987654321";
const OLDER_ID = "12345678-1234-4321-8765-123456789012";

// Keypress-driven assertions have to wait for an Ink re-render after the key
// is written. The default 1s waitFor is tight when the whole monorepo suite
// runs in parallel, and the waitFor budget must stay below the test timeout.
const KEYPRESS_TIMEOUT = { timeout: 10_000, interval: 25 } as const;
const TEST_TIMEOUT = 20_000;

/**
 * Press a key until the component reacts to it.
 *
 * Ink hands input to `useInput` through a subscription that the component
 * registers in a passive effect. This picker is mounted from an async session
 * load, so the list is already on screen while that subscription is still
 * pending — a key written in that window is dropped without a trace. Writing it
 * again inside `waitFor` closes the window; the assertion that follows is what
 * actually pins the behavior. The key keeps being re-sent after it took effect
 * (the picker then unmounts or ignores it), which the assertions below tolerate.
 */
const pressKey = async (
  stdin: { write: (data: string) => void },
  key: string,
  reaction: () => void,
) => {
  await vi.waitFor(() => {
    stdin.write(key);
    reaction();
  }, KEYPRESS_TIMEOUT);
};

const session = (id: string, workdir: string) => ({
  id,
  createdAt: new Date("2023-01-01T10:00:00Z"),
  lastActiveAt: new Date("2023-01-01T10:00:00Z"),
  latestTotalTokens: 100,
  firstMessage: `message for ${id.slice(0, 8)}`,
  sessionType: "main" as const,
  workdir,
});

const renderCommand = async (
  props: Partial<React.ComponentProps<typeof ResumeCommand>> = {},
) => {
  const onSelect = vi.fn();
  const onCancel = vi.fn();
  const result = render(
    <ResumeCommand
      workdir="/mock/workdir"
      isBusy={false}
      onSelect={onSelect}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { ...result, onSelect, onCancel };
};

describe("ResumeCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listWorktrees).mockResolvedValue([]);
    vi.mocked(sdk.listSessions).mockResolvedValue([
      session(OLDER_ID, "/mock/workdir"),
    ]);
  });

  it("refuses while the agent is running, without loading the session list", async () => {
    const { lastFrame, stdin, onSelect, onCancel } = await renderCommand({
      isBusy: true,
    });

    expect(lastFrame()).toContain(
      "Cannot resume a conversation while the agent is running.",
    );
    expect(lastFrame()).not.toContain("Select a session to resume");
    expect(listWorktrees).not.toHaveBeenCalled();
    expect(sdk.listSessions).not.toHaveBeenCalled();

    stdin.write("\u001b");
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalled());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders the picker with the same scopes and hints as `wave -r`", async () => {
    vi.mocked(listWorktrees).mockResolvedValue([
      "/mock/workdir",
      "/mock/other-wt",
    ]);

    const { lastFrame } = await renderCommand();

    await vi.waitFor(() =>
      expect(lastFrame()).toContain("Select a session to resume"),
    );
    expect(lastFrame()).toContain("Ctrl+A all projects");
    expect(lastFrame()).toContain("Ctrl+W all worktrees");
    expect(lastFrame()).toContain("↑↓ select");
    expect(lastFrame()).toContain("Enter confirm");
    expect(lastFrame()).toContain("Esc cancel");
  });

  it("cancels without side effects on Esc", async () => {
    const { stdin, onSelect, onCancel } = await renderCommand();

    await vi.waitFor(() => expect(sdk.listSessions).toHaveBeenCalled());

    await pressKey(stdin, "\u001b", () => expect(onCancel).toHaveBeenCalled());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it(
    "resumes a sibling worktree session with its directory",
    async () => {
      vi.mocked(listWorktrees).mockResolvedValue([
        "/mock/workdir",
        "/mock/other-wt",
      ]);
      vi.mocked(sdk.listSessions).mockResolvedValue([
        session(NEWER_ID, "/mock/other-wt"),
      ]);

      const { lastFrame, stdin, onSelect } = await renderCommand();

      await vi.waitFor(
        () => expect(lastFrame()).toContain("Select a session to resume"),
        KEYPRESS_TIMEOUT,
      );

      await pressKey(stdin, "\r", () =>
        expect(onSelect).toHaveBeenCalledWith(NEWER_ID, "/mock/other-wt"),
      );
    },
    TEST_TIMEOUT,
  );

  it(
    "shows a dismissible cd notice for cross-project sessions without exiting",
    async () => {
      vi.mocked(sdk.listSessions).mockResolvedValue([
        session(NEWER_ID, "/other/project"),
      ]);

      const { lastFrame, stdin, onSelect, onCancel } = await renderCommand();

      await vi.waitFor(
        () => expect(lastFrame()).toContain("Select a session to resume"),
        KEYPRESS_TIMEOUT,
      );

      await pressKey(stdin, "\r", () =>
        expect(lastFrame()).toContain("This conversation is from a different"),
      );
      expect(lastFrame()).toContain(
        `cd '/other/project' && wave --restore ${NEWER_ID}`,
      );
      expect(setClipboardText).toHaveBeenCalledWith(
        `cd '/other/project' && wave --restore ${NEWER_ID}`,
      );
      expect(onSelect).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();

      // Esc dismisses the notice and returns to the picker — the caller's
      // conversation must survive. The picker is remounted here, so its input
      // subscription has to come up again before Esc lands.
      await pressKey(stdin, "\u001b", () =>
        expect(lastFrame()).toContain("Select a session to resume"),
      );
      expect(onCancel).not.toHaveBeenCalled();
    },
    TEST_TIMEOUT,
  );
});

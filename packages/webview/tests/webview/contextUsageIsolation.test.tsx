import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "@testing-library/react";
import { renderChatApp, screen, sendHostMessage, fixtures } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

/** A minimal SessionMetadata for conversation-switch tests. */
function session(id: string) {
  return {
    id,
    sessionType: "main" as const,
    workdir: "/tmp/test",
    createdAt: new Date(),
    lastActiveAt: new Date(),
    latestTotalTokens: 0,
  };
}

/** A non-welcome conversation (has messages) so the indicator renders. */
function conversationState(id: string) {
  return {
    session: session(id),
    messages: [MockDataGenerator.createUserMessage("hello", `msg-${id}`)],
  };
}

describe("context usage indicator conversation isolation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("switching conversations drops the previous session's percentage", () => {
    renderChatApp();
    // Establish conversation A and receive its usage push.
    sendHostMessage(fixtures.setInitialState(conversationState("session-a")));
    sendHostMessage(fixtures.contextUsage(45));
    expect(screen.getByText("45%")).toBeInTheDocument();

    // Switch to conversation B: the percentage is conversation-scoped and
    // must not carry A's number over. Desktop panes key ChatApp by paneId
    // (not sessionId), so this component stays mounted — only the session-id
    // change in setInitialState can clear the local contextUsage state.
    sendHostMessage(fixtures.setInitialState(conversationState("session-b")));
    expect(screen.queryByText("45%")).not.toBeInTheDocument();
    // Back to the empty ring (spec 场景 4: no usage info yet → no number).
    expect(
      document.querySelector(".compress-context-button")?.getAttribute("title"),
    ).toBe("");

    // B's own usage arrives only after the next turn/restore push.
    sendHostMessage(fixtures.contextUsage(12));
    expect(screen.getByText("12%")).toBeInTheDocument();
  });

  it("keeps the percentage when the host re-pushes the SAME conversation (state refresh)", () => {
    renderChatApp();
    sendHostMessage(fixtures.setInitialState(conversationState("session-a")));
    sendHostMessage(fixtures.contextUsage(45));
    expect(screen.getByText("45%")).toBeInTheDocument();

    // A host re-push with the same session id (e.g. a pane state refresh)
    // must not clear the usage — only a real conversation switch does.
    sendHostMessage(fixtures.setInitialState(conversationState("session-a")));
    expect(screen.getByText("45%")).toBeInTheDocument();
  });

  it("shows the usage pushed right after a session switch (host back-to-back replay race)", async () => {
    renderChatApp();
    sendHostMessage(fixtures.setInitialState(conversationState("session-a")));
    sendHostMessage(fixtures.contextUsage(45));
    expect(screen.getByText("45%")).toBeInTheDocument();

    // Real-desktop back-to-back replay: activateAgentInPane posts
    // setInitialState and the cached usage replay as two consecutive IPC
    // messages with no await between them (desktopHost activateAgentInPane).
    // In Electron they land as separate message events, so the
    // conversation-switch clear must run synchronously inside the message
    // handler — a passive useEffect flushing after the usage push would wipe
    // the number just posted and the ring stays empty until the next turn.
    // The test dispatches without act() so React batches both updates ahead of
    // its passive-effect flush, reproducing that ordering (test-utils'
    // sendHostMessage wraps every message in act(), which flushes effects
    // synchronously and hides the race). Leaving the act environment for these
    // two raw dispatches keeps React from warning about the unwrapped updates
    // while preserving the non-act scheduling they are meant to simulate.
    const prevActEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
    window.dispatchEvent(
      new MessageEvent("message", {
        data: fixtures.setInitialState(conversationState("session-b")),
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: fixtures.contextUsage(12),
      }),
    );
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByText("12%")).toBeInTheDocument();
  });
});

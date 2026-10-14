import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  act,
  sendCommand,
  fireEvent,
} from "./test-utils";

/**
 * Pulling the list further up is the phone page's own gesture: the local hosts
 * (IDE, desktop) already hold every message, so nothing there may ever ask for
 * an earlier page. The pull is only reachable from real input — handleScroll
 * runs it past the gesture gate — so these tests drive a gesture rather than
 * calling anything.
 */

const assistant = (id: string, content: string) => ({
  id,
  role: "assistant" as const,
  timestamp: "2025-01-01T00:00:00.000Z",
  blocks: [{ type: "text", content }],
});

const twelveMessages = Array.from({ length: 12 }, (_, i) =>
  assistant(`m${String(i)}`, `第 ${String(i)} 条`),
);

/** jsdom does no layout, so scrollTop/scrollHeight/clientHeight are all 0. */
function fakeGeometry(
  scrollTop: number,
  scrollHeight: number,
  clientHeight = 400,
) {
  const container = screen.getByTestId("messages-container");
  const props = { scrollTop, scrollHeight, clientHeight };
  for (const key of Object.keys(props) as (keyof typeof props)[]) {
    Object.defineProperty(container, key, {
      value: props[key],
      configurable: true,
      writable: true,
    });
  }
  return container;
}

interface PostMessage {
  mock: { calls: unknown[][] };
}

const loadOlderRequests = (postMessage: PostMessage) =>
  postMessage.mock.calls
    .map(
      ([message]) =>
        message as { command?: string; before?: string; requestId?: number },
    )
    .filter((message) => message.command === "loadOlderMessages");

async function openList() {
  const { vscode } = renderChatApp();
  act(() => {
    sendCommand("updateMessages", { messages: twelveMessages });
  });
  await waitFor(() => {
    expect(screen.getByText("第 0 条")).toBeInTheDocument();
  });
  return vscode.postMessage as unknown as PostMessage;
}

/**
 * Reach scrollTop 0 the one way that does NOT latch the "user scrolled up"
 * opt-out: a scrollbar-thumb drag stamps user input (handleMouseDown) without
 * opting out, so what happens to the viewport afterwards is decided by the
 * follow judgement alone.
 */
async function pullUpToTheTop() {
  const container = fakeGeometry(0, 2000);
  Object.defineProperty(container, "offsetWidth", {
    value: 500,
    configurable: true,
  });
  Object.defineProperty(container, "clientWidth", {
    value: 484,
    configurable: true,
  });
  container.getBoundingClientRect = () => ({ right: 500 }) as DOMRect;
  act(() => {
    fireEvent.mouseDown(container, { clientX: 495 });
  });
  act(() => {
    fireEvent.scroll(container);
  });
  return container;
}

const replyWith = (
  requestId: number,
  messages: unknown[],
  hasMore: boolean,
) => {
  act(() => {
    sendCommand("olderMessages", { requestId, messages, hasMore });
  });
};

describe("pulling up for older messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks the host for the page above the top row, once a pull reaches the top", async () => {
    window.waveRemotePage = true;
    try {
      const postMessage = await openList();
      await pullUpToTheTop();

      // `before` is the message the reader is sitting on: the host returns what
      // is older than it, so that row is never re-sent.
      expect(loadOlderRequests(postMessage)[0]).toMatchObject({ before: "m0" });
      expect(typeof loadOlderRequests(postMessage)[0]?.requestId).toBe(
        "number",
      );
    } finally {
      delete window.waveRemotePage;
    }
  });

  it("prepends the older page and keeps the row the reader was on in place", async () => {
    window.waveRemotePage = true;
    try {
      const postMessage = await openList();
      const container = await pullUpToTheTop();
      const { requestId } = loadOlderRequests(postMessage)[0] ?? {};

      replyWith(
        requestId as number,
        [assistant("m-2", "更早的两条"), assistant("m-1", "更早的一条")],
        true,
      );

      expect(screen.getByText("更早的一条")).toBeInTheDocument();
      // Two rows were inserted above the reading position, so the viewport must
      // have moved down by their height to hold the same row under the reader...
      expect(container.scrollTop).toBeGreaterThan(0);
      // ...and NOT to the bottom. Nothing new arrived at the tail, so a prepend
      // may never be read as "a new message came in" and re-pin: that would yank
      // the reader off the very row they pulled up to read.
      expect(container.scrollTop).toBeLessThan(2000 - 400);
      // Pulling again is allowed: there is still more above.
      expect(screen.queryByTestId("history-start-hint")).toBeNull();
    } finally {
      delete window.waveRemotePage;
    }
  });

  it("stops asking and says so once the host reports the beginning of history", async () => {
    window.waveRemotePage = true;
    try {
      const postMessage = await openList();
      const container = await pullUpToTheTop();
      const { requestId } = loadOlderRequests(postMessage)[0] ?? {};

      replyWith(requestId as number, [], false);

      await waitFor(() => {
        expect(screen.getByTestId("history-start-hint")).toBeInTheDocument();
      });

      // A further pull at the top asks nothing: the host has already said there
      // is nothing before this.
      act(() => {
        fireEvent.scroll(container);
      });
      expect(loadOlderRequests(postMessage)).toHaveLength(1);
    } finally {
      delete window.waveRemotePage;
    }
  });

  it("drops a page that only lands after the reader switched sessions", async () => {
    window.waveRemotePage = true;
    try {
      const postMessage = await openList();
      await pullUpToTheTop();
      const { requestId } = loadOlderRequests(postMessage)[0] ?? {};

      act(() => {
        sendCommand("updateCurrentSession", {
          session: { id: "s2", firstMessage: "另一个会话" },
        });
      });
      replyWith(
        requestId as number,
        [assistant("m-2", "上一个会话的更早的一条")],
        true,
      );

      // A page is an answer about one conversation; prepending it into whatever
      // conversation happens to be on screen would insert a stranger's history.
      expect(screen.queryByText("上一个会话的更早的一条")).toBeNull();
    } finally {
      delete window.waveRemotePage;
    }
  });

  it("never asks on a local host — there is no host to ask", async () => {
    const postMessage = await openList();
    await pullUpToTheTop();

    // The pull-up ran; the command is gated on the page being the phone page
    // (window.waveRemotePage), not on waveHostType, which the IDE hosts also
    // leave unset.
    expect(loadOlderRequests(postMessage)).toHaveLength(0);
  });
});

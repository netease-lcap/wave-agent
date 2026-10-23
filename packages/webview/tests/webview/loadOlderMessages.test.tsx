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
 * Pulling the list further up is how a reader reaches history the host did not
 * ship on the first screen. Since 2026-10 every host pushes one page only
 * (spec ui/message-rendering-system.md「首屏只进一页」), so the pull is a normal gesture on all
 * four surfaces — but it is gated on the host SAYING it can answer
 * (`supportsMessagePaging`), because the page is loaded remotely and an older
 * host must not receive a command it does not know.
 *
 * The pull is only reachable from real input — handleScroll runs it past the
 * gesture gate — so these tests drive a gesture rather than calling anything.
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

async function openList(opts?: { declarePaging?: boolean }) {
  const { vscode } = renderChatApp();
  act(() => {
    if (opts?.declarePaging) {
      // The three local hosts' first screen: a window plus the capability bit
      // (spec ui/message-rendering-system.md「首屏只进一页」).
      sendCommand("setInitialState", {
        messages: twelveMessages,
        historyExhausted: false,
        supportsMessagePaging: true,
        sessions: [],
        isStreaming: false,
      });
    } else {
      sendCommand("updateMessages", { messages: twelveMessages });
    }
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
      // Pulling again is allowed: there is still more above. The list renders no
      // "beginning of history" line at any point (spec
      // ui/message-rendering-system.md 场景 3).
      expect(screen.queryByTestId("history-start-hint")).toBeNull();
    } finally {
      delete window.waveRemotePage;
    }
  });

  it("stops asking once the host reports the beginning of history", async () => {
    window.waveRemotePage = true;
    try {
      const postMessage = await openList();
      const container = await pullUpToTheTop();
      const { requestId } = loadOlderRequests(postMessage)[0] ?? {};

      replyWith(requestId as number, [], false);

      // Reaching the beginning is a silent boundary: nothing is rendered at the
      // top, not even a hint — a line parked there would land on top of the first
      // message of a list too short to scroll (spec
      // ui/message-rendering-system.md 场景 3).
      await waitFor(() => {
        expect(loadOlderRequests(postMessage)).toHaveLength(1);
      });
      expect(screen.queryByTestId("history-start-hint")).toBeNull();

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

  it("keeps a page the session already owned when it lands", async () => {
    // 回包按「发起时是哪条会话」判归属：这条会话自己的请求照常落地（首屏那次
    // setInitialState 带会话 + 消息，列表可能当场自己补页——spec 场景 5）。
    const postMessage = await openList({ declarePaging: true });
    act(() => {
      sendCommand("updateCurrentSession", {
        session: { id: "s2", firstMessage: "刚绑定" },
      });
    });
    await pullUpToTheTop();
    const { requestId } = loadOlderRequests(postMessage)[0] ?? {};

    replyWith(requestId as number, [assistant("m-2", "更早的一条")], true);

    expect(screen.getByText("更早的一条")).toBeInTheDocument();
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

  it("never asks a host that does not declare the capability", async () => {
    const postMessage = await openList();
    await pullUpToTheTop();

    // 老宿主：不认识 `loadOlderMessages`，也不推 `supportsMessagePaging`。门禁必须
    // 是宿主说的能力位，不是「页面猜宿主的种类」—— 猜错就是把一条它不认识的命令
    // 发过去，静默失败。
    expect(loadOlderRequests(postMessage)).toHaveLength(0);
  });

  it("asks a local host that declares the paging capability", async () => {
    const postMessage = await openList({ declarePaging: true });
    await pullUpToTheTop();

    // 三端首屏只推一页，所以「翻更早」在桌面端 / IDE 上也是常规手势。
    expect(loadOlderRequests(postMessage)[0]).toMatchObject({ before: "m0" });
  });

  it("pulls the next page by itself when the first page does not fill the pane", async () => {
    // A window narrower than the viewport offers no scroll gesture at all: scrollTop
    // stays 0, no 'scroll' event ever fires, and the reader can never reach the
    // history above. The list has to keep paging until it overflows (or the host
    // says there is nothing more) — the same fix opencode makes with `fill()`.
    const postMessage = await openList({ declarePaging: true });
    // jsdom does no layout, and the fill deliberately skips a container that has
    // not been laid out (`scrollHeight === 0`), so the geometry has to be brought
    // in explicitly: 300px of content inside a 400px pane.
    fakeGeometry(0, 300, 400);

    // Any window that re-enters with the pane still not full re-runs the check
    // (a fresh array is a fresh window — the reducer replaces the list by
    // reference, and the re-check rides on that change).
    act(() => {
      sendCommand("updateMessages", {
        messages: [...twelveMessages],
        hasMore: true,
      });
    });

    await waitFor(() => {
      expect(loadOlderRequests(postMessage)).toHaveLength(1);
    });

    // ... and it stops as soon as the host reports the beginning of history.
    const { requestId } = loadOlderRequests(postMessage)[0] ?? {};
    replyWith(requestId as number, [], false);
    act(() => {
      sendCommand("updateMessages", {
        messages: [...twelveMessages],
        hasMore: false,
      });
    });
    // Nothing appears in the DOM once the host says this is the beginning: the
    // hint was removed on purpose (this list is too short to scroll, so a line
    // parked at the top would sit on the first message). Flush the effects and
    // assert it stays at one request.
    await act(async () => {});
    expect(loadOlderRequests(postMessage)).toHaveLength(1);
    expect(screen.queryByTestId("history-start-hint")).toBeNull();
  });
});

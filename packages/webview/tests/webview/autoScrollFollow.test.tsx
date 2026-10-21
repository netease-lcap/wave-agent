import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  act,
  sendCommand,
  fireEvent,
} from "./test-utils";

const userMsg = (content: string, id: string) => ({
  id,
  role: "user" as const,
  timestamp: "2025-01-01T00:00:00.000Z",
  blocks: [{ type: "text", content }],
});

const assistantMsg = (content: string, id: string) => ({
  id,
  role: "assistant" as const,
  timestamp: "2025-01-01T00:00:00.000Z",
  blocks: [{ type: "text", content }],
});

/**
 * An injected (`isMeta: true`) user message: the task reminder, a triggered
 * `.wave/rules` rule, hook additionalContext, the changed-files notice, a plan
 * mode reminder. The SDK appends these at the TAIL between model requests, and
 * the list hides them — the reader sees nothing happen.
 */
const metaUserMsg = (content: string, id: string) => ({
  id,
  role: "user" as const,
  isMeta: true,
  timestamp: "2025-01-01T00:00:00.000Z",
  blocks: [{ type: "text", content }],
});

/**
 * jsdom does not do layout, so scrollTop/clientHeight/scrollHeight are all 0.
 * Fake the geometry by redefining those properties on the container, then
 * dispatch a scroll event so MessageList's scroll handler records the position.
 */
function setGeometryAndScroll(
  scrollTop: number,
  scrollHeight: number,
  clientHeight = 400,
) {
  const container = screen.getByTestId("messages-container");
  Object.defineProperty(container, "scrollTop", {
    value: scrollTop,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(container, "clientHeight", {
    value: clientHeight,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(container, "scrollHeight", {
    value: scrollHeight,
    configurable: true,
    writable: true,
  });
  act(() => {
    fireEvent.scroll(container);
  });
}

describe("auto-scroll follow during streaming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps following when content above the viewport shrinks (e.g. reasoning collapse) without a user scroll-up", async () => {
    // Programmatic scrolls go through the virtualizer → Element.scrollTo
    // (polyfilled in tests/setup.ts); spy on it to observe auto-follow.
    const scrollTo = vi.fn();
    window.Element.prototype.scrollTo = scrollTo;

    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [userMsg("问题", "u1"), assistantMsg("正在回答", "a1")],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );

    // Begin streaming so streamingMessageIndex is set and the effect follows content.
    act(() => {
      sendCommand("startStreaming");
    });
    // Let the programmatic-scroll flag (reset via requestAnimationFrame in
    // doScrollToBottom) clear so the subsequent manual scroll events are evaluated
    // as user/layout intent rather than ignored as our own scroll.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Park the viewport at the bottom: scrollTop 1600 + clientHeight 400 = scrollHeight 2000.
    setGeometryAndScroll(1600, 2000);
    scrollTo.mockClear();

    // Simulate content above the viewport shrinking (reasoning block auto-collapse,
    // streaming-end reflow, image load reflow, etc.): scrollHeight drops and the
    // browser clamps scrollTop downward to keep it within bounds. This is NOT a user
    // scroll-up gesture, yet the raw scrollTop decreases.
    setGeometryAndScroll(800, 1200);
    scrollTo.mockClear();

    // A subsequent streaming chunk arrives (messages change → effect runs). The user
    // never scrolled up, so auto-scroll-to-bottom must still fire.
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("问题", "u1"),
          assistantMsg("正在回答……更多内容追加", "a1"),
        ],
      });
    });

    expect(scrollTo).toHaveBeenCalled();
  });

  it("keeps following when the viewport grows (e.g. confirmation dialog closes) without a user scroll-up", async () => {
    const scrollTo = vi.fn();
    window.Element.prototype.scrollTo = scrollTo;

    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [userMsg("问题", "u1"), assistantMsg("正在回答", "a1")],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );

    act(() => {
      sendCommand("startStreaming");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Park the viewport at the bottom: scrollTop 1600 + clientHeight 400 = scrollHeight 2000.
    setGeometryAndScroll(1600, 2000);
    scrollTo.mockClear();

    // Simulate the confirmation dialog closing: the input area comes back shorter
    // than the dialog, so the container's clientHeight grows 400 → 700 and the
    // browser clamps scrollTop down to the new maximum (2000 - 700 = 1300) with
    // scrollHeight UNCHANGED. This is NOT a user scroll-up gesture.
    setGeometryAndScroll(1300, 2000, 700);
    scrollTo.mockClear();

    // A subsequent streaming chunk must still auto-scroll to bottom.
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("问题", "u1"),
          assistantMsg("正在回答……更多内容追加", "a1"),
        ],
      });
    });

    expect(scrollTo).toHaveBeenCalled();
  });

  it("stops following after a genuine user scroll-up (geometry unchanged)", async () => {
    const scrollTo = vi.fn();
    window.Element.prototype.scrollTo = scrollTo;

    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [userMsg("问题", "u1"), assistantMsg("正在回答", "a1")],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );

    act(() => {
      sendCommand("startStreaming");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Park the viewport at the bottom. (This also renders the sticky user
    // message — let it settle before the upward gesture below so that gesture
    // is read as user intent.)
    setGeometryAndScroll(1600, 2000);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    scrollTo.mockClear();

    // Genuine user scroll-up: scrollTop decreases while scrollHeight AND
    // clientHeight stay the same — no layout clamp involved. A real gesture
    // ships an input event alongside the scroll, and the list gates on that
    // input (a bare 'scroll' event with no input behind it is our own pin or a
    // virtualizer compensation), so dispatch the wheel the browser would.
    fireEvent.wheel(screen.getByTestId("messages-container"), {
      deltaY: -100,
      ctrlKey: false,
    });
    setGeometryAndScroll(1500, 2000);
    scrollTo.mockClear();

    // The next streaming chunk must NOT yank the user back to the bottom.
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("问题", "u1"),
          assistantMsg("正在回答……更多内容追加", "a1"),
        ],
      });
    });

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("stops following at the wheel input itself during streaming, before the synthesized scroll event lands", async () => {
    const scrollTo = vi.fn();
    window.Element.prototype.scrollTo = scrollTo;

    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [userMsg("问题", "u1"), assistantMsg("正在回答", "a1")],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );

    act(() => {
      sendCommand("startStreaming");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Park the viewport at the bottom.
    setGeometryAndScroll(1600, 2000);
    scrollTo.mockClear();

    // The user wheels up. Browsers synthesize the 'scroll' event only on a
    // later rendering frame, so here NO scroll event is dispatched yet — a
    // streaming chunk can arrive (and programmatically re-pin) inside that
    // window. The opt-out must be latched at the wheel input itself, or the
    // chunk yanks the viewport back to the bottom before the intent is ever
    // recorded (the intermittent "I scroll up and it keeps pulling me back"
    // during reasoning streams).
    fireEvent.wheel(screen.getByTestId("messages-container"), {
      deltaY: -120,
    });
    scrollTo.mockClear();

    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("问题", "u1"),
          assistantMsg("正在回答……更多内容追加", "a1"),
        ],
      });
    });

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does not opt out when the wheel scrolls down while pinning (no upward intent)", async () => {
    const scrollTo = vi.fn();
    window.Element.prototype.scrollTo = scrollTo;

    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [userMsg("问题", "u1"), assistantMsg("正在回答", "a1")],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );

    act(() => {
      sendCommand("startStreaming");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    setGeometryAndScroll(1600, 2000);
    scrollTo.mockClear();

    // A downward wheel must not suspend following — the next chunk still pins.
    fireEvent.wheel(screen.getByTestId("messages-container"), {
      deltaY: 120,
    });
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("问题", "u1"),
          assistantMsg("正在回答……更多内容追加", "a1"),
        ],
      });
    });

    expect(scrollTo).toHaveBeenCalled();
  });

  /**
   * Regions that scroll on their own inside the list (tool output, reasoning,
   * diff, write preview, capped user content). They are recognized from layout
   * — a max-height + overflow-y that really overflows — so jsdom needs the
   * geometry faked the same way the container's is.
   */
  function addNestedScroller(scrollTop: number, scrollHeight = 800) {
    const container = screen.getByTestId("messages-container");
    const inner = document.createElement("div");
    inner.style.overflowY = "auto";
    Object.defineProperty(inner, "scrollTop", {
      value: scrollTop,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(inner, "clientHeight", {
      value: 200,
      configurable: true,
    });
    Object.defineProperty(inner, "scrollHeight", {
      value: scrollHeight,
      configurable: true,
    });
    const child = document.createElement("span");
    inner.appendChild(child);
    container.appendChild(inner);
    return child;
  }

  async function renderStreamingAtBottom() {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [userMsg("问题", "u1"), assistantMsg("正在回答", "a1")],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );
    act(() => {
      sendCommand("startStreaming");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    setGeometryAndScroll(1600, 2000);
  }

  function pushChunk() {
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("问题", "u1"),
          assistantMsg("正在回答……更多内容追加", "a1"),
        ],
      });
    });
  }

  it("keeps following when a nested scroller consumes the wheel", async () => {
    const scrollTo = vi.fn();
    window.Element.prototype.scrollTo = scrollTo;
    await renderStreamingAtBottom();

    // The wheel belongs to the reasoning/tool-output region: it is not a
    // request to leave the bottom, so following must survive it.
    const child = addNestedScroller(300);
    scrollTo.mockClear();
    fireEvent.wheel(child, { deltaY: -120 });
    pushChunk();

    expect(scrollTo).toHaveBeenCalled();
  });

  it("still opts out when the wheel is over a nested scroller but scrolls the list", async () => {
    const scrollTo = vi.fn();
    window.Element.prototype.scrollTo = scrollTo;
    await renderStreamingAtBottom();

    // The nested region is already at its own top, so this upward wheel is
    // scrolled by the list instead. The intent must be recorded: if the input
    // handler returns before marking the gesture, the list's scroll event
    // finds the gate closed and the next chunk's pin drags the reader back
    // down — the very bug the nested-region exclusion must not reintroduce.
    const child = addNestedScroller(0);
    fireEvent.wheel(child, { deltaY: -120 });
    setGeometryAndScroll(1480, 2000);
    scrollTo.mockClear();
    pushChunk();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  /**
   * The counterpart: a message the user actually sends still re-arms following.
   * Both angles are needed because they are the same judgement — "is the tail a
   * user message?" — read on the same list; the meta case below must not be able
   * to pass by making that judgement unreachable.
   */
  it("re-arms following when the user really sends a message", async () => {
    const scrollTo = vi.fn();
    window.Element.prototype.scrollTo = scrollTo;
    await renderStreamingAtBottom();

    fireEvent.wheel(screen.getByTestId("messages-container"), { deltaY: -120 });
    setGeometryAndScroll(1480, 2000);
    scrollTo.mockClear();

    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("问题", "u1"),
          assistantMsg("正在回答", "a1"),
          userMsg("新问题", "u2"),
        ],
      });
    });

    expect(scrollTo).toHaveBeenCalled();
  });

  /**
   * The tail-role test that decides "the user just sent a message" — the ONE
   * reason allowed to lift the opt-out — reads the tail of the RAW list, where
   * injected meta user messages also live. Every model request appends some
   * (task reminder, triggered rule, hook context, changed-files notice, plan
   * mode reminder), so mid-turn, while the reader is in the history, the tail
   * becomes a `role: "user"` message the reader cannot even see: following was
   * silently re-armed and the viewport pinned — the intermittent "reading
   * history, suddenly yanked to the bottom" with no gesture behind it.
   */
  it("does not re-arm following when an injected meta user message lands at the tail", async () => {
    const scrollTo = vi.fn();
    window.Element.prototype.scrollTo = scrollTo;
    await renderStreamingAtBottom();

    // The reader wheels up mid-stream: following is suspended.
    fireEvent.wheel(screen.getByTestId("messages-container"), { deltaY: -120 });
    setGeometryAndScroll(1480, 2000);
    scrollTo.mockClear();

    // The agent's next request appends an invisible meta user message.
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("问题", "u1"),
          assistantMsg("正在回答……更多内容追加", "a1"),
          metaUserMsg("<system-reminder>tasks 提醒</system-reminder>", "meta1"),
        ],
      });
    });
    expect(scrollTo).not.toHaveBeenCalled();

    // … and following must stay off for the rest of the turn, not just for the
    // one update: with the opt-out lifted, every later chunk chases the reader.
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("问题", "u1"),
          assistantMsg("正在回答……更多内容追加……", "a1"),
          metaUserMsg("<system-reminder>tasks 提醒</system-reminder>", "meta1"),
        ],
      });
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

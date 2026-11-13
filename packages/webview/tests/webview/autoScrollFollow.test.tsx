import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ASK_USER_QUESTION_TOOL_NAME,
  BASH_TOOL_NAME,
} from "wave-agent-sdk/constants";
import {
  renderChatApp,
  screen,
  waitFor,
  act,
  sendCommand,
  fireEvent,
  pinScrollBoxHeight,
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
 * The pin/follow judgement reads the scroll box's real numbers (scrollTop /
 * clientHeight / scrollHeight) and classifies every `scroll` event as its own
 * write, a browser clamp, or a foreign gesture. These specs assert that
 * judgement, so the geometry here is REAL: `.messages-container` gets a real
 * 400px viewport that is really too short for the content, positions are real
 * scrollTop values the browser itself clamps, and the only stand-in is the
 * observed `Element.scrollTo` call (instance-level spy, it still scrolls).
 */

/**
 * Body text that really overflows: one paragraph per line (markdown renders the
 * blank-line separated lines as separate paragraphs), so the virtual spacer —
 * which is what supplies `scrollHeight` — grows to several times the viewport.
 */
const tallText = (lines: number) =>
  Array.from(
    { length: lines },
    (_, i) => `第 ${i + 1} 行：一段用来撑出真实溢出的正文。`,
  ).join("\n\n");

const VIEWPORT = 400;
/** How much shorter than the content the viewport must be for these cases. */
const MIN_OVERFLOW = 700;
const BASE_LINES = 50;

const streamedMessages = (lines = BASE_LINES) => [
  userMsg("问题", "u1"),
  assistantMsg(tallText(lines), "a1"),
];

let restoreLayout: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  // The container's height comes from the chat shell around it, which does not
  // exist in a unit render — pin a real 400px scroll viewport with real overflow.
  // It must be in place before mount: the list scrolls to the bottom in its
  // mount effect, and mounting first would measure a 0-height box.
  restoreLayout = pinScrollBoxHeight(".messages-container", VIEWPORT);
});

afterEach(() => {
  restoreLayout();
});

const scrollBox = () => screen.getByTestId("messages-container");

/** Distance between the viewport bottom and the content bottom, in real px. */
function gap() {
  const c = scrollBox();
  return c.scrollHeight - c.scrollTop - c.clientHeight;
}

/** Wait until the column really overflows and the mount effect parked us at the bottom. */
async function waitForBottom() {
  await waitFor(() => expect(scrollBox()).toBeInTheDocument());
  const c = scrollBox();
  await waitFor(() => {
    expect(c.scrollHeight - c.clientHeight).toBeGreaterThan(MIN_OVERFLOW);
    expect(gap()).toBeLessThanOrEqual(1);
  });
  return c;
}

/** A real upward scroll of the list itself (scrollHeight/clientHeight unchanged). */
function scrollUpBy(px: number) {
  const c = scrollBox();
  expect(c.scrollTop).toBeGreaterThan(px);
  act(() => {
    c.scrollTop -= px;
    fireEvent.scroll(c);
  });
  expect(gap()).toBeGreaterThan(px - 1);
}

/** A further streaming chunk: the last assistant message grows in place. */
function pushChunk(lines = BASE_LINES + 6) {
  act(() => {
    sendCommand("updateMessages", { messages: streamedMessages(lines) });
  });
}

/** Render a conversation that overflows the viewport and stream it, at the bottom. */
async function renderStreamingAtBottom() {
  renderChatApp();
  act(() => {
    sendCommand("updateMessages", { messages: streamedMessages() });
  });
  act(() => {
    sendCommand("startStreaming");
  });
  return waitForBottom();
}

describe("auto-scroll follow during streaming", () => {
  it("keeps following when content above the viewport shrinks (e.g. reasoning collapse) without a user scroll-up", async () => {
    const container = await renderStreamingAtBottom();
    // Programmatic scrolls go through the virtualizer → Element.scrollTo.
    const scrollTo = vi.spyOn(container, "scrollTo");

    // Content above the viewport really shrinks (a reasoning block collapsed by
    // the reader, streaming-end reflow, image load reflow…): the column gets
    // shorter and the browser clamps scrollTop downward to keep it in bounds.
    // That raw decrease is NOT a user scroll-up gesture.
    act(() => {
      sendCommand("updateMessages", { messages: streamedMessages(10) });
    });
    await waitFor(() =>
      expect(container.scrollHeight - container.clientHeight).toBeLessThan(600),
    );
    scrollTo.mockClear();

    // A subsequent streaming chunk arrives (messages change → effect runs). The user
    // never scrolled up, so auto-scroll-to-bottom must still fire.
    pushChunk();

    expect(scrollTo).toHaveBeenCalled();
  });

  it("keeps following when the viewport grows (e.g. confirmation dialog closes) without a user scroll-up", async () => {
    const container = await renderStreamingAtBottom();
    const scrollTo = vi.spyOn(container, "scrollTo");

    // The confirmation dialog closes: the input area comes back shorter than the
    // dialog, so the container's clientHeight really grows 400 → 700 while
    // scrollHeight stays put, and the browser clamps scrollTop to the new maximum.
    // That is not a user scroll-up gesture either.
    act(() => {
      container.style.setProperty("height", "700px", "important");
    });
    await waitFor(() => expect(container.clientHeight).toBeGreaterThan(600));
    scrollTo.mockClear();

    // A subsequent streaming chunk must still auto-scroll to bottom.
    pushChunk();

    expect(scrollTo).toHaveBeenCalled();
  });

  it("stops following after a genuine user scroll-up (geometry unchanged)", async () => {
    const container = await renderStreamingAtBottom();
    const scrollTo = vi.spyOn(container, "scrollTo");

    // Genuine user scroll-up: scrollTop decreases while scrollHeight AND
    // clientHeight stay the same — no layout clamp involved. A real gesture ships
    // an input event alongside the scroll, and the list gates on that input (a
    // bare 'scroll' event with no input behind it is our own pin or a virtualizer
    // compensation), so dispatch the wheel the browser would.
    fireEvent.wheel(container, { deltaY: -100, ctrlKey: false });
    scrollUpBy(120);
    scrollTo.mockClear();

    // The next streaming chunk must NOT yank the user back to the bottom.
    pushChunk();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("stops following at the wheel input itself during streaming, before the synthesized scroll event lands", async () => {
    const container = await renderStreamingAtBottom();
    const scrollTo = vi.spyOn(container, "scrollTo");
    expect(gap()).toBeLessThanOrEqual(1);

    // The user wheels up. Browsers synthesize the 'scroll' event only on a later
    // rendering frame (an untrusted synthesized wheel does not scroll at all), so
    // here NO scroll event is dispatched yet — a streaming chunk can arrive (and
    // programmatically re-pin) inside that window. The opt-out must be latched at
    // the wheel input itself, or the chunk yanks the viewport back to the bottom
    // before the intent is ever recorded (the intermittent "I scroll up and it
    // keeps pulling me back" during reasoning streams).
    fireEvent.wheel(container, { deltaY: -120 });
    scrollTo.mockClear();

    pushChunk();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does not opt out when the wheel scrolls down while pinning (no upward intent)", async () => {
    const container = await renderStreamingAtBottom();
    const scrollTo = vi.spyOn(container, "scrollTo");

    // A downward wheel must not suspend following — the next chunk still pins.
    fireEvent.wheel(container, { deltaY: 120 });
    scrollTo.mockClear();

    pushChunk();

    expect(scrollTo).toHaveBeenCalled();
  });

  /**
   * Regions that scroll on their own inside the list (tool output, reasoning,
   * diff, write preview, capped user content). They are recognized from real
   * layout — a computed `overflow-y: auto|scroll` box whose `scrollHeight`
   * really exceeds its `clientHeight` — so the region here is a real one: max
   * height + real overflowing content, scrolled to a real offset.
   */
  function addNestedScroller(atTop: boolean) {
    const container = scrollBox();
    const inner = document.createElement("div");
    inner.style.overflowY = "auto";
    inner.style.maxHeight = "200px";
    inner.style.flex = "none";
    const content = document.createElement("div");
    content.style.height = "800px";
    inner.appendChild(content);
    container.appendChild(inner);
    if (!atTop) inner.scrollTop = 300;
    return content;
  }

  it("keeps following when a nested scroller consumes the wheel", async () => {
    const container = await renderStreamingAtBottom();
    const scrollTo = vi.spyOn(container, "scrollTo");

    // The wheel belongs to the reasoning/tool-output region: it is not a request
    // to leave the bottom, so following must survive it.
    const child = addNestedScroller(false);
    scrollTo.mockClear();
    fireEvent.wheel(child, { deltaY: -120 });
    pushChunk();

    expect(scrollTo).toHaveBeenCalled();
  });

  it("still opts out when the wheel is over a nested scroller but scrolls the list", async () => {
    const container = await renderStreamingAtBottom();
    const scrollTo = vi.spyOn(container, "scrollTo");

    // The nested region is already at its own top, so this upward wheel is scrolled
    // by the list instead — the list really moves up, which is a foreign scroll.
    // The intent must be recorded: if the input handler returns before marking the
    // gesture, the list's scroll event finds the gate closed and the next chunk's
    // pin drags the reader back down — the very bug the nested-region exclusion
    // must not reintroduce.
    const child = addNestedScroller(true);
    fireEvent.wheel(child, { deltaY: -120 });
    scrollTo.mockClear();
    scrollUpBy(20);
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
    const container = await renderStreamingAtBottom();
    const scrollTo = vi.spyOn(container, "scrollTo");

    fireEvent.wheel(container, { deltaY: -120 });
    scrollUpBy(120);
    scrollTo.mockClear();

    act(() => {
      sendCommand("updateMessages", {
        messages: [...streamedMessages(), userMsg("新问题", "u2")],
      });
    });

    expect(scrollTo).toHaveBeenCalled();
  });

  /**
   * 恢复跟随的第三条途径（spec ui/message-rendering-system.md 场景 6）：在确认
   * 弹窗里作答。作答与「自己发消息」同属用户主动把对话推下去——上滚读历史后答完，
   * 视口必须回到真实底部并继续跟随，否则答案落进下方工具块，用户在屏幕上看不到
   * 就等于白答。
   */
  it("re-arms following when the user answers an AskUserQuestion dialog", async () => {
    const container = await renderStreamingAtBottom();
    const scrollTo = vi.spyOn(container, "scrollTo");

    fireEvent.wheel(container, { deltaY: -120 });
    scrollUpBy(300);
    expect(gap()).toBeGreaterThan(200);

    act(() => {
      sendCommand("showConfirmation", {
        confirmationId: "auq-1",
        toolName: ASK_USER_QUESTION_TOOL_NAME,
        confirmationType: "需要确认",
        toolInput: {
          questions: [
            {
              question: "这次改动要不要一起带上文档？",
              options: [{ label: "带上" }, { label: "先不带" }],
              multiSelect: false,
            },
          ],
        },
      });
    });
    await waitFor(() =>
      expect(
        document.querySelector(".confirmation-dialog"),
      ).toBeInTheDocument(),
    );

    // 只选了选项还不算作答：提交按钮此刻才可用。
    await act(async () => {
      fireEvent.click(screen.getByText("带上"));
    });
    scrollTo.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /提交回答/ }));
    });

    await waitFor(() => expect(scrollTo).toHaveBeenCalled(), {
      timeout: 3000,
    });
    await waitFor(() => expect(gap()).toBeLessThanOrEqual(2), {
      timeout: 3000,
    });

    // 而且真的重新钉上了：后续 chunk 继续把视口带到底部。
    pushChunk(BASE_LINES + 12);
    await waitFor(() => expect(gap()).toBeLessThanOrEqual(2));
  });

  it("re-arms following when the user rejects a permission dialog", async () => {
    const container = await renderStreamingAtBottom();
    const scrollTo = vi.spyOn(container, "scrollTo");

    fireEvent.wheel(container, { deltaY: -120 });
    scrollUpBy(300);
    expect(gap()).toBeGreaterThan(200);

    act(() => {
      sendCommand("showConfirmation", {
        confirmationId: "bash-1",
        toolName: BASH_TOOL_NAME,
        confirmationType: "Bash 命令执行确认",
        toolInput: { command: "npm run dev" },
      });
    });
    await waitFor(() =>
      expect(
        document.querySelector(".confirmation-dialog"),
      ).toBeInTheDocument(),
    );

    scrollTo.mockClear();
    await act(async () => {
      fireEvent.click(document.querySelector(".confirmation-close-btn")!);
    });

    await waitFor(() => expect(scrollTo).toHaveBeenCalled(), {
      timeout: 3000,
    });
    await waitFor(() => expect(gap()).toBeLessThanOrEqual(2), {
      timeout: 3000,
    });
  });

  /**
   * 同一对判据的另一面：宿主下发的「置底请求」仍旧只是一个请求。它与「作答」
   * 走的是两个入口（`scrollToBottom` / `pinToBottom`），把作答接成强制置底时
   * 不能顺手把请求那个入口也松掉——那会把读者的阅读位置一起交出去。
   */
  it("still ignores a host scrollToBottom request after the user scrolled up", async () => {
    const container = await renderStreamingAtBottom();
    const scrollTo = vi.spyOn(container, "scrollTo");

    fireEvent.wheel(container, { deltaY: -120 });
    scrollUpBy(300);
    const parked = gap();
    scrollTo.mockClear();

    act(() => {
      sendCommand("scrollToBottom", {});
    });

    expect(scrollTo).not.toHaveBeenCalled();
    expect(gap()).toBeGreaterThan(parked - 2);
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
    const container = await renderStreamingAtBottom();
    const scrollTo = vi.spyOn(container, "scrollTo");

    // The reader wheels up mid-stream: following is suspended.
    fireEvent.wheel(container, { deltaY: -120 });
    scrollUpBy(120);
    scrollTo.mockClear();

    // The agent's next request appends an invisible meta user message.
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          ...streamedMessages(BASE_LINES + 6),
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
          ...streamedMessages(BASE_LINES + 12),
          metaUserMsg("<system-reminder>tasks 提醒</system-reminder>", "meta1"),
        ],
      });
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

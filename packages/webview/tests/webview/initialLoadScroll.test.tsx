import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  act,
  sendCommand,
  fireEvent,
  pinScrollBoxHeight,
  scrollRowAboveFold,
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
 * Body text that really overflows: one paragraph per line (markdown renders the
 * blank-line separated lines as separate paragraphs), so the column — and with
 * it `scrollHeight`, which the virtual spacer supplies — is really taller than
 * the viewport. "Is the viewport at the bottom?" is then a real question.
 */
const tallText = (lines: number) =>
  Array.from(
    { length: lines },
    (_, i) => `第 ${i + 1} 行：一段用来撑出真实溢出的正文。`,
  ).join("\n\n");

const VIEWPORT = 400;
const MIN_OVERFLOW = 400;

let restoreLayout: () => void;
/**
 * Observes "the list moved its own viewport". `vi.spyOn` keeps the real
 * implementation, so every scroll below actually happens; the record is read
 * instead of the settled position so that "behavior: auto" (an instant pin, not
 * an animation) stays assertable.
 *
 * It has to sit on `Element.prototype` because the initial-load write happens in
 * MessageList's mount effect and MessageList only mounts once messages arrive —
 * there is no instance to spy on before it. (A replacement — `vi.fn()` for the
 * method — is exactly what this spec used to do and must not come back: it takes
 * the real scroll with it and leaves the geometry artificial.)
 */
let scrollToSpy: MockInstance;

beforeEach(() => {
  vi.clearAllMocks();
  restoreLayout = pinScrollBoxHeight(".messages-container", VIEWPORT);
  scrollToSpy = vi.spyOn(Element.prototype, "scrollTo");
});

afterEach(() => {
  scrollToSpy.mockRestore();
  restoreLayout();
  // Remove the document.fonts mock injected by the fonts test (if any).
  delete (document as unknown as { fonts?: unknown }).fonts;
});

const scrollBox = () => screen.getByTestId("messages-container");

const autoCalls = () =>
  scrollToSpy.mock.calls.filter(
    ([options]) =>
      (options as ScrollToOptions | undefined)?.behavior === "auto",
  );

/** Wait until the column really overflows and the mount effect parked us at the bottom. */
async function waitForBottom() {
  await waitFor(() => expect(scrollBox()).toBeInTheDocument());
  const c = scrollBox();
  await waitFor(() => {
    expect(c.scrollHeight - c.clientHeight).toBeGreaterThan(MIN_OVERFLOW);
    expect(c.scrollHeight - c.scrollTop - c.clientHeight).toBeLessThanOrEqual(
      1,
    );
  });
  return c;
}

/** A real upward scroll of the list itself. */
function scrollUpBy(px: number) {
  const c = scrollBox();
  expect(c.scrollTop).toBeGreaterThan(px);
  act(() => {
    c.scrollTop -= px;
    fireEvent.scroll(c);
  });
  expect(c.scrollHeight - c.scrollTop - c.clientHeight).toBeGreaterThan(px - 1);
}

const initialMessages = () => [
  userMsg("问题", "u1"),
  assistantMsg(tallText(30), "a1"),
];

const twoRounds = () => [
  userMsg("早期问题", "u1"),
  assistantMsg(tallText(20), "a1"),
  userMsg("最新问题", "u2"),
  assistantMsg(tallText(20), "a2"),
];

/**
 * Initial-load scrolling + async-content re-pin. The geometry is real
 * (`.messages-container` gets a real 400px viewport that the content really
 * overflows); what these cases assert is where that viewport ends up and whether
 * an async reflow is allowed to move it.
 */
describe("initial load scroll + async-content re-pin", () => {
  it("initial load force-scrolls instantly with behavior auto", async () => {
    renderChatApp();
    act(() => {
      sendCommand("setInitialState", {
        messages: initialMessages(),
        isStreaming: false,
      });
    });
    await waitForBottom();

    // The mount effect IS the initial load: MessageList only renders once
    // messages exist, so the first scroll must be an instant 'auto' pin — not a
    // smooth animation that lands the reader somewhere arbitrary.
    expect(autoCalls().length).toBeGreaterThan(0);

    // …and it really landed on the content bottom.
    const c = scrollBox();
    expect(c.scrollHeight - c.scrollTop - c.clientHeight).toBeLessThanOrEqual(
      1,
    );
  });

  it("re-pins to the bottom when an image finishes loading", async () => {
    renderChatApp();
    act(() => {
      sendCommand("setInitialState", {
        messages: initialMessages(),
        isStreaming: false,
      });
    });
    const c = await waitForBottom();
    scrollToSpy.mockClear();

    // 'load' does not bubble — the container listens in capture phase, so
    // dispatching a non-bubbling load still reaches it.
    fireEvent.load(c);

    expect(autoCalls().length).toBeGreaterThan(0);
  });

  it("does NOT re-pin on image load after the user scrolled up", async () => {
    renderChatApp();
    act(() => {
      sendCommand("setInitialState", {
        messages: initialMessages(),
        isStreaming: false,
      });
    });
    const c = await waitForBottom();

    // Genuine user scroll-up: scrollTop decreases with the geometry unchanged.
    // A real gesture ships an input event alongside the scroll — the list gates
    // on that input, not on the bare 'scroll' event alone — so dispatch the wheel
    // the browser would, and really move the viewport.
    fireEvent.wheel(c, { deltaY: -100, ctrlKey: false });
    scrollUpBy(120);
    scrollToSpy.mockClear();

    fireEvent.load(c);

    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it("re-pins once web fonts are ready", async () => {
    // Must be set BEFORE mount: the re-pin effect registers the fonts.ready
    // callback when MessageList mounts. An unresolved promise keeps the re-pin
    // pending so we can resolve it after clearing the initial-scroll call.
    let resolveFonts: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      resolveFonts = resolve;
    });
    Object.defineProperty(document, "fonts", {
      value: { ready },
      configurable: true,
    });

    renderChatApp();
    act(() => {
      sendCommand("setInitialState", {
        messages: initialMessages(),
        isStreaming: false,
      });
    });
    await waitForBottom();
    scrollToSpy.mockClear();

    // Resolve the fonts.ready promise → the re-pin callback fires.
    await act(async () => {
      resolveFonts();
    });

    expect(autoCalls().length).toBeGreaterThan(0);
  });

  it("does not scroll when the sticky user message appears (it's an overlay, no flow space)", async () => {
    renderChatApp();
    act(() => {
      sendCommand("setInitialState", {
        messages: twoRounds(),
        isStreaming: false,
      });
    });
    const c = await waitForBottom();

    // The sticky user message appears once the viewport has scrolled past it: park
    // the real viewport so u2's row top sits just above the fold, and let the list
    // recompute the candidate from that position.
    await scrollRowAboveFold(c, "u2");
    await waitFor(() =>
      expect(screen.getByTestId("sticky-user-message")).toBeInTheDocument(),
    );
    scrollToSpy.mockClear();

    // The bar is absolutely positioned — an overlay that takes no flow space — so
    // `scrollHeight` is untouched and the parked viewport stays where the reader
    // left it. No re-pin scroll may fire (regression guard for the removed
    // in-flow sticky bar, which used to grow scrollHeight ~30-70px).
    const heightWithBar = c.scrollHeight;
    const topWithBar = c.scrollTop;
    await act(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    expect(c.scrollHeight).toBe(heightWithBar);
    expect(c.scrollTop).toBe(topWithBar);
    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});

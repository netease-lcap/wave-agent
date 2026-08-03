import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderChatApp, screen, waitFor, act, sendCommand, fireEvent } from './test-utils';

const userMsg = (content: string, id: string) => ({
  id,
  role: 'user' as const,
  timestamp: '2025-01-01T00:00:00.000Z',
  blocks: [{ type: 'text', content }]
});

const assistantMsg = (content: string, id: string) => ({
  id,
  role: 'assistant' as const,
  timestamp: '2025-01-01T00:00:00.000Z',
  blocks: [{ type: 'text', content }]
});

function setGeometryAndScroll(scrollTop: number, scrollHeight: number, clientHeight = 400) {
  const container = screen.getByTestId('messages-container');
  Object.defineProperty(container, 'scrollTop', { value: scrollTop, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: clientHeight, configurable: true });
  Object.defineProperty(container, 'scrollHeight', { value: scrollHeight, configurable: true });
  act(() => {
    fireEvent.scroll(container);
  });
}

/**
 * Initial-load scrolling + async-content re-pin.
 * jsdom does no layout (scrollTop/clientHeight/scrollHeight are 0), so the
 * "near bottom" check is always true there; these tests assert the parts that
 * are deterministic regardless: the initial forced 'auto' scroll, and the
 * re-pin triggered by async content loads.
 */
describe('initial load scroll + async-content re-pin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Remove the document.fonts mock injected by the fonts test (if any).
    delete (document as unknown as { fonts?: unknown }).fonts;
  });

  it('initial load force-scrolls instantly with behavior auto', async () => {
    const scrollIntoView = vi.fn();
    window.Element.prototype.scrollIntoView = scrollIntoView;

    renderChatApp();
    act(() => {
      sendCommand('setInitialState', {
        messages: [userMsg('问题', 'u1'), assistantMsg('回答', 'a1')],
        isStreaming: false
      });
    });
    await waitFor(() => expect(screen.getByTestId('messages-container')).toBeInTheDocument());

    // The mount effect IS the initial load: MessageList only renders once
    // messages exist, so the first scroll must be an instant 'auto' pin.
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto' });
  });

  it('re-pins to the bottom when an image finishes loading', async () => {
    const scrollIntoView = vi.fn();
    window.Element.prototype.scrollIntoView = scrollIntoView;

    renderChatApp();
    act(() => {
      sendCommand('setInitialState', {
        messages: [userMsg('问题', 'u1'), assistantMsg('回答', 'a1')],
        isStreaming: false
      });
    });
    await waitFor(() => expect(screen.getByTestId('messages-container')).toBeInTheDocument());
    scrollIntoView.mockClear();

    // 'load' does not bubble — the container listens in capture phase, so
    // dispatching a non-bubbling load still reaches it.
    fireEvent.load(screen.getByTestId('messages-container'));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto' });
  });

  it('does NOT re-pin on image load after the user scrolled up', async () => {
    const scrollIntoView = vi.fn();
    window.Element.prototype.scrollIntoView = scrollIntoView;

    renderChatApp();
    act(() => {
      sendCommand('setInitialState', {
        messages: [userMsg('问题', 'u1'), assistantMsg('回答', 'a1')],
        isStreaming: false
      });
    });
    await waitFor(() => expect(screen.getByTestId('messages-container')).toBeInTheDocument());
    // Let the programmatic-scroll flag (reset via requestAnimationFrame) clear.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Genuine user scroll-up: scrollTop decreases with geometry unchanged.
    setGeometryAndScroll(1600, 2000);
    setGeometryAndScroll(1500, 2000);
    scrollIntoView.mockClear();

    fireEvent.load(screen.getByTestId('messages-container'));

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('re-pins once web fonts are ready', async () => {
    const scrollIntoView = vi.fn();
    window.Element.prototype.scrollIntoView = scrollIntoView;
    // Must be set BEFORE mount: the re-pin effect registers the fonts.ready
    // callback when MessageList mounts. An unresolved promise keeps the re-pin
    // pending so we can resolve it after clearing the initial-scroll call.
    let resolveFonts: () => void = () => {};
    const ready = new Promise<void>((resolve) => { resolveFonts = resolve; });
    Object.defineProperty(document, 'fonts', {
      value: { ready },
      configurable: true
    });

    renderChatApp();
    act(() => {
      sendCommand('setInitialState', {
        messages: [userMsg('问题', 'u1'), assistantMsg('回答', 'a1')],
        isStreaming: false
      });
    });
    await waitFor(() => expect(screen.getByTestId('messages-container')).toBeInTheDocument());
    scrollIntoView.mockClear();

    // Resolve the fonts.ready promise → the re-pin callback fires.
    await act(async () => { resolveFonts(); });

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto' });
  });
});

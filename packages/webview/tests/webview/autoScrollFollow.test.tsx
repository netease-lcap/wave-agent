import { describe, it, expect, vi, beforeEach } from 'vitest';
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

/**
 * jsdom does not do layout, so offsetTop/scrollTop/clientHeight/scrollHeight are all 0.
 * Fake the geometry by redefining those properties on the container, then dispatch a
 * scroll event so MessageList's scroll handler records the position.
 */
function setGeometryAndScroll(scrollTop: number, scrollHeight: number, clientHeight = 400) {
  const container = screen.getByTestId('messages-container');
  Object.defineProperty(container, 'scrollTop', { value: scrollTop, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: clientHeight, configurable: true });
  Object.defineProperty(container, 'scrollHeight', { value: scrollHeight, configurable: true });
  act(() => {
    fireEvent.scroll(container);
  });
}

describe('auto-scroll follow during streaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps following when content above the viewport shrinks (e.g. reasoning collapse) without a user scroll-up', async () => {
    const scrollIntoView = vi.fn();
    // jsdom doesn't implement Element.scrollIntoView
    window.Element.prototype.scrollIntoView = scrollIntoView;

    renderChatApp();
    act(() => {
      sendCommand('updateMessages', {
        messages: [userMsg('问题', 'u1'), assistantMsg('正在回答', 'a1')]
      });
    });
    await waitFor(() => expect(screen.getByTestId('messages-container')).toBeInTheDocument());

    // Begin streaming so streamingMessageIndex is set and the effect follows content.
    act(() => {
      sendCommand('startStreaming');
    });
    // Let the programmatic-scroll flag (reset via requestAnimationFrame in
    // doScrollToBottom) clear so the subsequent manual scroll events are evaluated
    // as user/layout intent rather than ignored as our own scroll.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Park the viewport at the bottom: scrollTop 1600 + clientHeight 400 = scrollHeight 2000.
    setGeometryAndScroll(1600, 2000);
    scrollIntoView.mockClear();

    // Simulate content above the viewport shrinking (reasoning block auto-collapse,
    // streaming-end reflow, image load reflow, etc.): scrollHeight drops and the
    // browser clamps scrollTop downward to keep it within bounds. This is NOT a user
    // scroll-up gesture, yet the raw scrollTop decreases.
    setGeometryAndScroll(800, 1200);
    scrollIntoView.mockClear();

    // A subsequent streaming chunk arrives (messages change → effect runs). The user
    // never scrolled up, so auto-scroll-to-bottom must still fire.
    act(() => {
      sendCommand('updateMessages', {
        messages: [userMsg('问题', 'u1'), assistantMsg('正在回答……更多内容追加', 'a1')]
      });
    });

    expect(scrollIntoView).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, screen, waitFor, act, sendCommand, fireEvent } from './test-utils';

const userMsg = (content: string, id: string) => ({
  id,
  role: 'user' as const,
  timestamp: '2025-01-01T00:00:00.000Z',
  blocks: [{ type: 'text', content }]
});

/**
 * jsdom does not do layout, so offsetTop/scrollTop/clientHeight are all 0.
 * Fake the geometry: assign an increasing offsetTop to each user message node,
 * set the container scrollTop past the first message, then dispatch a scroll event.
 */
function fakeGeometryAndScroll(scrollTop: number) {
  const container = screen.getByTestId('messages-container');
  Object.defineProperty(container, 'scrollTop', { value: scrollTop, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
  Object.defineProperty(container, 'scrollHeight', { value: 2000, configurable: true });
  const nodes = container.querySelectorAll<HTMLElement>('[data-role="user"][data-message-id]');
  nodes.forEach((node, i) => {
    Object.defineProperty(node, 'offsetTop', { value: i * 500, configurable: true });
  });
  act(() => {
    fireEvent.scroll(container);
  });
}

describe('sticky user message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has no sticky header before scrolling', async () => {
    renderChatApp();
    act(() => {
      sendCommand('updateMessages', { messages: [userMsg('第一条问题', 'u1')] });
    });
    await waitFor(() => expect(screen.getByTestId('messages-container')).toBeInTheDocument());
    expect(screen.queryByTestId('sticky-user-message')).not.toBeInTheDocument();
  });

  it('pins the most recent user message scrolled above the viewport top', async () => {
    renderChatApp();
    act(() => {
      sendCommand('updateMessages', {
        messages: [
          userMsg('第一条问题', 'u1'),
          userMsg('第二条问题', 'u2'),
          userMsg('第三条问题', 'u3')
        ]
      });
    });
    await waitFor(() => expect(screen.getByTestId('messages-container')).toBeInTheDocument());

    // scrollTop 1200 → u1(0) and u2(500) and u3(1000) are all above; last one is u3
    fakeGeometryAndScroll(1200);

    await waitFor(() => {
      expect(screen.getByTestId('sticky-user-message')).toBeInTheDocument();
    });
    expect(screen.getByTestId('sticky-user-message')).toHaveTextContent('第三条问题');
  });

  it('switches the pinned message as scroll position changes', async () => {
    renderChatApp();
    act(() => {
      sendCommand('updateMessages', {
        messages: [
          userMsg('第一条问题', 'u1'),
          userMsg('第二条问题', 'u2'),
          userMsg('第三条问题', 'u3')
        ]
      });
    });
    await waitFor(() => expect(screen.getByTestId('messages-container')).toBeInTheDocument());

    // scrollTop 600 → only u1(0) is above u2(500)? u2 offsetTop 500 < 600 too → last above is u2
    fakeGeometryAndScroll(600);
    await waitFor(() => {
      expect(screen.getByTestId('sticky-user-message')).toHaveTextContent('第二条问题');
    });
  });

  it('clicking the sticky header scrolls the original message to the viewport center', async () => {
    renderChatApp();
    act(() => {
      sendCommand('updateMessages', {
        messages: [userMsg('第一条问题', 'u1'), userMsg('第二条问题', 'u2')]
      });
    });
    await waitFor(() => expect(screen.getByTestId('messages-container')).toBeInTheDocument());
    fakeGeometryAndScroll(700);
    await waitFor(() => expect(screen.getByTestId('sticky-user-message')).toBeInTheDocument());

    const target = screen.getByTestId('messages-container').querySelector('[data-message-id="u2"]') as HTMLElement;
    const spy = vi.spyOn(target, 'scrollIntoView').mockImplementation(() => {});
    act(() => {
      fireEvent.click(screen.getByTestId('sticky-user-message'));
    });
    expect(spy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  });

  it('renders sticky content with the 3-line clamp class', async () => {
    renderChatApp();
    act(() => {
      sendCommand('updateMessages', {
        messages: [userMsg('第一条问题', 'u1'), userMsg('第二条问题', 'u2')]
      });
    });
    await waitFor(() => expect(screen.getByTestId('messages-container')).toBeInTheDocument());
    fakeGeometryAndScroll(700);
    await waitFor(() => expect(screen.getByTestId('sticky-user-message')).toBeInTheDocument());
    expect(document.querySelector('.sticky-user-content')).toBeInTheDocument();
  });
});

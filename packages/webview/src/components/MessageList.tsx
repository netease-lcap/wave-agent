import React, { useEffect, useRef, useImperativeHandle, forwardRef, useMemo, useCallback, useState } from 'react';
import { Message } from './Message';
import type { MessageListProps } from '../types';
import type { Message as MessageType } from 'wave-agent-sdk';
import '../styles/MessageList.css';

// Count the blocks in an assistant message that Message.tsx wraps in a `.timeline-row`
// (i.e. that carry a timeline dot): non-empty text/compact, tool, and reasoning blocks.
// Mirrors the `wrap` logic in Message.renderBlock so the group can decide whether it has
// a single lone dot (no connecting line) or multiple dots (draw the line).
function countTimelineBlocks(message: MessageType): number {
  if (!message.blocks) return 0;
  let count = 0;
  for (const block of message.blocks) {
    switch (block.type) {
      case 'text':
      case 'compact':
        if (block.content && block.content.trim()) count++;
        break;
      case 'tool':
      case 'reasoning':
        count++;
        break;
    }
  }
  return count;
}

export const MessageList = forwardRef<{ scrollToBottom: (behavior?: ScrollBehavior) => void }, MessageListProps>(function MessageList({ messages, queuedMessages, isStreaming, vscode, onRewindToMessage, workdir }, ref) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const prevMessagesLengthRef = useRef(messages.length);
  const prevQueuedLengthRef = useRef(queuedMessages?.length || 0);
  // True when the user has scrolled up away from the bottom. While set,
  // auto-scroll-to-bottom is suspended so the user can read history undisturbed
  // during streaming. Set by ANY upward scroll (even a few px) — detected by
  // comparing scrollTop direction in the scroll handler — so a light upward
  // nudge is respected instead of being overridden because the user is still
  // "within the bottom threshold". Cleared only when the user scrolls back down
  // to the bottom region.
  const userScrolledUpRef = useRef(false);
  // Briefly true around our own scrollIntoView calls so the scroll handler can
  // ignore those as user intent. Streaming uses 'auto' (instant, single fire),
  // so a one-frame reset via requestAnimationFrame is sufficient.
  const isProgrammaticScrollRef = useRef(false);
  // Last seen scrollTop, used to detect scroll direction (up vs down).
  const prevScrollTopRef = useRef(0);
  // Last seen scrollHeight, used to tell a content-shrink clamp apart from a
  // genuine user scroll-up. When content above the viewport shrinks (reasoning
  // auto-collapse, streaming-end reflow, image load, etc.) the browser clamps
  // scrollTop downward to keep it within bounds, which otherwise looks identical
  // to an upward user gesture and would wrongly suspend auto-follow.
  const prevScrollHeightRef = useRef(0);

  // The most-recent user message that has scrolled above the viewport top; pinned
  // at the top of the list as a context hint (设计稿 2236-3792).
  const [stickyMessage, setStickyMessage] = useState<{ id: string; text: string } | null>(null);

  const computeSticky = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      setStickyMessage(null);
      return;
    }
    const scrollTop = container.scrollTop;
    const nodes = container.querySelectorAll<HTMLElement>('[data-role="user"][data-message-id]');
    let candidate: HTMLElement | null = null;
    // Find the last user message whose top edge has scrolled above the viewport top.
    for (const node of nodes) {
      if (node.offsetTop < scrollTop) {
        candidate = node;
      } else {
        break;
      }
    }
    if (!candidate) {
      setStickyMessage(null);
      return;
    }
    const id = candidate.getAttribute('data-message-id') || '';
    const text = candidate.querySelector('.user-content')?.textContent?.trim() || '';
    if (!id || !text) {
      setStickyMessage(null);
      return;
    }
    setStickyMessage(prev => (prev && prev.id === id && prev.text === text ? prev : { id, text }));
  }, []);

  const scrollToMessage = useCallback((id: string) => {
    const container = containerRef.current;
    const node = container?.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // Perform a programmatic scroll-to-bottom, guarding it with the
  // isProgrammaticScroll flag so the scroll handler treats the resulting
  // 'scroll' event as ours (not the user's) and leaves userScrolledUp alone.
  const doScrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const messagesEnd = messagesEndRef.current;
    if (!messagesEnd) return;
    isProgrammaticScrollRef.current = true;
    messagesEnd.scrollIntoView({ behavior });
    // 'auto' is instant (single 'scroll' fire); reset on the next frame.
    requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
    });
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth', force = false) => {
    const container = containerRef.current;
    const messagesEnd = messagesEndRef.current;
    if (!container || !messagesEnd) return;

    const isNearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 300;

    const isUserMessage = messages.length > 0 && messages[messages.length - 1].role === 'user';
    // Force scroll if it's a new message AND (it's from user OR user is already at bottom)
    const shouldForce = force && (isUserMessage || !userScrolledUpRef.current);

    // Always scroll if:
    // 1. It's a brand new message that should be forced
    // 2. We are currently streaming content AND user hasn't scrolled up
    // 3. The user is already near the bottom AND hasn't scrolled up
    if (shouldForce || ((isStreaming || isNearBottom) && !userScrolledUpRef.current)) {
      // A new user message means the user wants to follow the upcoming reply:
      // clear any prior opt-out so streaming auto-scrolls into view.
      if (shouldForce && isUserMessage) {
        userScrolledUpRef.current = false;
      }
      doScrollToBottom(behavior);
    }
  }, [messages, isStreaming, doScrollToBottom]);

  // Expose scrollToBottom method to parent component
  useImperativeHandle(ref, () => ({
    scrollToBottom: (behavior: ScrollBehavior = 'smooth') => {
      doScrollToBottom(behavior);
    }
  }));

  // Auto-scroll to bottom when messages change, streaming updates, or subagent messages update
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isNewMessage = messages.length > prevMessagesLengthRef.current || (queuedMessages?.length || 0) > prevQueuedLengthRef.current;
    prevMessagesLengthRef.current = messages.length;
    prevQueuedLengthRef.current = queuedMessages?.length || 0;

    // The scroll event fires for user scrolling (wheel, trackpad, keyboard,
    // scrollbar drag) AND our own programmatic scrollIntoView. We distinguish
    // them with isProgrammaticScroll: ignore 'scroll' events we caused, so they
    // can't reset userScrolledUp and yank the user back to the bottom. For real
    // user scrolling, we use DIRECTION to decide intent — any upward scroll
    // (even a few px) suspends following, so a light nudge up is respected
    // instead of being overridden by the bottom-threshold check. Only scrolling
    // back down to the bottom region resumes following.
    const handleScroll = () => {
      if (!isProgrammaticScrollRef.current) {
        const isNearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 300;
        const scrolledUp = container.scrollTop < prevScrollTopRef.current;
        // A clamp from a content-shrink reflow (scrollHeight decreased) moves
        // scrollTop downward but is NOT user intent — ignore it so auto-follow
        // survives reasoning collapse / streaming-end reflow / image load.
        const contentShrank = container.scrollHeight < prevScrollHeightRef.current;
        // An upward gesture always opts out of following (covers the "slight
        // nudge up then stop" case that the distance threshold alone missed).
        // A downward gesture to the bottom region opts back in.
        if (scrolledUp && !contentShrank) {
          userScrolledUpRef.current = true;
        } else if (isNearBottom) {
          userScrolledUpRef.current = false;
        }
      }
      prevScrollTopRef.current = container.scrollTop;
      prevScrollHeightRef.current = container.scrollHeight;
      computeSticky();
    };

    container.addEventListener('scroll', handleScroll);

    // Use ResizeObserver to recompute sticky state on content height changes
    // (images, diffs, etc.). Auto-scroll itself is driven by the messages
    // dependency below, not by the observer.
    const resizeObserver = new ResizeObserver(() => {
      computeSticky();
    });

    resizeObserver.observe(container);

    // Follow new content: scroll on every messages change (incl. streaming text
    // chunks so streamed text stays visible), gated by userScrolledUp inside
    // scrollToBottom. A brand-new message forces the scroll.
    scrollToBottom(isStreaming ? 'auto' : 'smooth', isNewMessage);
    computeSticky();

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('scroll', handleScroll);
    };
  }, [messages, queuedMessages, isStreaming, scrollToBottom, computeSticky]);

  return (
    <div 
      ref={containerRef}
      id="messagesContainer" 
      className={`messages-container${isStreaming ? ' streaming' : ''}`}
      data-testid="messages-container"
    >
      {stickyMessage && (
        <div className="sticky-user-wrapper">
          <div className="sticky-user-cap" />
          <div
            className="sticky-user-message"
            data-testid="sticky-user-message"
            onClick={() => scrollToMessage(stickyMessage.id)}
          >
            <div className="sticky-user-content">{stickyMessage.text}</div>
          </div>
          <div className="sticky-user-scrim" />
        </div>
      )}
      {/* Chat messages - filter out user meta messages */}
      {useMemo(() => {
        // Filter out user messages with isMeta (hidden from the list)
        const visibleMessages: MessageType[] = [];
        for (const msg of messages) {
          if (msg.role === 'user' && msg.isMeta) continue;
          visibleMessages.push(msg);
        }

        const renderMessage = (message: MessageType) => {
          return (
            <Message
              key={message.id}
              message={message}
              vscode={vscode}
              onRewindToMessage={onRewindToMessage}
              workdir={workdir}
            />
          );
        };

        // Group consecutive assistant messages into a single .assistant-group wrapper so
        // the timeline vertical line runs continuously through all their dots. User
        // messages break the timeline (rendered as bare bubbles outside any group).
        const rendered: React.ReactNode[] = [];
        let group: { message: MessageType }[] = [];

        const flushGroup = () => {
          if (group.length === 0) return;
          const dotCount = group.reduce((sum, g) => sum + countTimelineBlocks(g.message), 0);
          const single = dotCount <= 1;
          rendered.push(
            <div
              key={group[0].message.id}
              className={`assistant-group${single ? ' assistant-group--single' : ''}`}
            >
              {group.map(g => renderMessage(g.message))}
            </div>
          );
          group = [];
        };

        visibleMessages.forEach((message) => {
          if (message.role === 'assistant') {
            group.push({ message });
          } else {
            flushGroup();
            rendered.push(renderMessage(message));
          }
        });
        flushGroup();

        return rendered;
      }, [messages, vscode, onRewindToMessage])}
      
      {/* Invisible div to scroll to */}
      <div ref={messagesEndRef} />
    </div>
  );
});
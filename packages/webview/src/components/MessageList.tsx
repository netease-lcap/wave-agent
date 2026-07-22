import React, { useEffect, useRef, useImperativeHandle, forwardRef, useMemo, useCallback, useState } from 'react';
import { Message } from './Message';
import type { MessageListProps } from '../types';
import type { Message as MessageType, ToolBlock } from 'wave-agent-sdk';
import { TASK_UPDATE_TOOL_NAME } from 'wave-agent-sdk/dist/constants/tools.js';
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

export const MessageList = forwardRef<{ scrollToBottom: (behavior?: ScrollBehavior) => void }, MessageListProps>(function MessageList({ messages, queuedMessages, streamingMessageIndex, vscode, onRewindToMessage, tasks, isTaskListCollapsed, onToggleTaskListCollapse }, ref) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const prevMessagesLengthRef = useRef(messages.length);
  const prevQueuedLengthRef = useRef(queuedMessages?.length || 0);
  const userScrolledUpRef = useRef(false);

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
    if (shouldForce || ((streamingMessageIndex !== undefined || isNearBottom) && !userScrolledUpRef.current)) {
      messagesEnd.scrollIntoView({ behavior });
    }
  }, [messages, streamingMessageIndex]);

  // Expose scrollToBottom method to parent component
  useImperativeHandle(ref, () => ({
    scrollToBottom: (behavior: ScrollBehavior = 'smooth') => {
      const messagesEnd = messagesEndRef.current;
      if (messagesEnd) {
        messagesEnd.scrollIntoView({ behavior });
      }
    }
  }));

  // Auto-scroll to bottom when messages change, streaming updates, or subagent messages update
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isNewMessage = messages.length > prevMessagesLengthRef.current || (queuedMessages?.length || 0) > prevQueuedLengthRef.current;
    prevMessagesLengthRef.current = messages.length;
    prevQueuedLengthRef.current = queuedMessages?.length || 0;

    const handleScroll = () => {
      const threshold = 300;
      const isNearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - threshold;
      if (isNearBottom) {
        userScrolledUpRef.current = false;
      } else {
        userScrolledUpRef.current = true;
      }
      computeSticky();
    };

    container.addEventListener('scroll', handleScroll);

    // Use ResizeObserver to handle content height changes (images, diffs, etc.)
    const resizeObserver = new ResizeObserver(() => {
      // Use 'auto' for resize events to keep up with content growth without jitter
      scrollToBottom(streamingMessageIndex !== undefined ? 'auto' : 'smooth');
      computeSticky();
    });

    resizeObserver.observe(container);
    
    // Initial scroll for the dependency change
    // If it's a new message, we force the scroll
    scrollToBottom(streamingMessageIndex !== undefined ? 'auto' : 'smooth', isNewMessage);
    computeSticky();

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('scroll', handleScroll);
    };
  }, [messages, queuedMessages, streamingMessageIndex, scrollToBottom, computeSticky]);

  // Find the globally-last TaskUpdate(status=completed) tool block; the task list
  // card is rendered at that block's position.
  const taskListTarget = useMemo<{ messageId: string; blockIndex: number } | null>(() => {
    let target: { messageId: string; blockIndex: number } | null = null;
    for (const msg of messages) {
      if (!msg.blocks) continue;
      msg.blocks.forEach((block, blockIndex) => {
        if (block.type !== 'tool') return;
        const toolBlock = block as ToolBlock;
        if (toolBlock.name !== TASK_UPDATE_TOOL_NAME || !toolBlock.parameters) return;
        try {
          if (JSON.parse(toolBlock.parameters).status === 'completed') {
            target = { messageId: msg.id, blockIndex };
          }
        } catch {
          // ignore malformed parameters
        }
      });
    }
    return target;
  }, [messages]);

  return (
    <div 
      ref={containerRef}
      id="messagesContainer" 
      className="messages-container" 
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
        // Filter out user messages with isMeta, and build index mapping for streaming detection
        const visibleMessages: MessageType[] = [];
        const originalIndexMap: number[] = [];
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          if (msg.role === 'user' && msg.isMeta) continue;
          visibleMessages.push(msg);
          originalIndexMap.push(i);
        }

        const renderMessage = (message: MessageType, idx: number) => {
          const isStreaming = streamingMessageIndex !== undefined && originalIndexMap[idx] === streamingMessageIndex;
          return (
            <Message
              key={message.id}
              message={message}
              isStreaming={isStreaming}
              vscode={vscode}
              onRewindToMessage={onRewindToMessage}
              tasks={tasks}
              taskListTargetBlockIndex={taskListTarget?.messageId === message.id ? taskListTarget.blockIndex : undefined}
              isTaskListCollapsed={isTaskListCollapsed}
              onToggleTaskListCollapse={onToggleTaskListCollapse}
            />
          );
        };

        // Group consecutive assistant messages into a single .assistant-group wrapper so
        // the timeline vertical line runs continuously through all their dots. User
        // messages break the timeline (rendered as bare bubbles outside any group).
        const rendered: React.ReactNode[] = [];
        let group: { message: MessageType; idx: number }[] = [];

        const flushGroup = () => {
          if (group.length === 0) return;
          const dotCount = group.reduce((sum, g) => sum + countTimelineBlocks(g.message), 0);
          const single = dotCount <= 1;
          rendered.push(
            <div
              key={group[0].message.id}
              className={`assistant-group${single ? ' assistant-group--single' : ''}`}
            >
              {group.map(g => renderMessage(g.message, g.idx))}
            </div>
          );
          group = [];
        };

        visibleMessages.forEach((message, idx) => {
          if (message.role === 'assistant') {
            group.push({ message, idx });
          } else {
            flushGroup();
            rendered.push(renderMessage(message, idx));
          }
        });
        flushGroup();

        return rendered;
      }, [messages, streamingMessageIndex, vscode, onRewindToMessage, tasks, taskListTarget, isTaskListCollapsed, onToggleTaskListCollapse])}
      
      {/* Invisible div to scroll to */}
      <div ref={messagesEndRef} />
    </div>
  );
});
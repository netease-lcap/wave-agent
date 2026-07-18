import React, { useEffect, useRef, useImperativeHandle, forwardRef, useMemo, useCallback } from 'react';
import { Message } from './Message';
import type { MessageListProps } from '../types';
import type { Message as MessageType } from 'wave-agent-sdk';
import '../styles/MessageList.css';

const welcomeMessage = {
  id: 'welcome-message',
  role: 'assistant' as const,
  timestamp: new Date().toISOString(),
  blocks: [{ 
    type: 'text' as const, 
    content: '您好！我是您的 AI 助手。我可以帮助您处理当前项目、编写代码和修改文件。今天我能为您做些什么吗？'
  }]
};

export const MessageList = forwardRef<{ scrollToBottom: (behavior?: ScrollBehavior) => void }, MessageListProps>(function MessageList({ messages, queuedMessages, streamingMessageIndex, vscode, onRewindToMessage }, ref) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const prevMessagesLengthRef = useRef(messages.length);
  const prevQueuedLengthRef = useRef(queuedMessages?.length || 0);
  const userScrolledUpRef = useRef(false);

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
    };

    container.addEventListener('scroll', handleScroll);

    // Use ResizeObserver to handle content height changes (images, diffs, etc.)
    const resizeObserver = new ResizeObserver(() => {
      // Use 'auto' for resize events to keep up with content growth without jitter
      scrollToBottom(streamingMessageIndex !== undefined ? 'auto' : 'smooth');
    });

    resizeObserver.observe(container);
    
    // Initial scroll for the dependency change
    // If it's a new message, we force the scroll
    scrollToBottom(streamingMessageIndex !== undefined ? 'auto' : 'smooth', isNewMessage);

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('scroll', handleScroll);
    };
  }, [messages, queuedMessages, streamingMessageIndex, scrollToBottom]);

  return (
    <div 
      ref={containerRef}
      id="messagesContainer" 
      className="messages-container" 
      data-testid="messages-container"
    >
      {/* Welcome message - always show */}
      <Message
        message={welcomeMessage}
        isStreaming={false}
        vscode={vscode}
      />
      
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

        return visibleMessages.map((message, idx) => {
          const isStreaming = streamingMessageIndex !== undefined && originalIndexMap[idx] === streamingMessageIndex;

          return (
            <Message
              key={message.id}
              message={message}
              isStreaming={isStreaming}
              vscode={vscode}
              onRewindToMessage={onRewindToMessage}
            />
          );
        });
      }, [messages, streamingMessageIndex, vscode, onRewindToMessage])}
      
      {/* Invisible div to scroll to */}
      <div ref={messagesEndRef} />
    </div>
  );
});
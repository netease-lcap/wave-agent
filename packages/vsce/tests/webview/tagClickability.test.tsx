import { renderChatApp, sendCommand } from './test-utils';
import { describe, it, expect, beforeEach } from 'vitest';

describe('Tag Clickability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not have clickable class for regular file and directory tags in messages', () => {
    renderChatApp();

    const messages = [{
      id: 'msg1',
      role: 'user' as const,
      timestamp: '2024-01-01T00:00:00.000Z',
      blocks: [
        {
          type: 'text' as const,
          content: 'Check this file [@file:/workspace/src/main.ts] and this directory [@file:/workspace/src/].'
        }
      ]
    }];

    sendCommand('updateMessages', { messages });

    const userMessage = document.querySelector('.message.user');
    expect(userMessage).toBeInTheDocument();

    const contextTags = userMessage!.querySelectorAll('.context-tag');
    expect(contextTags.length).toBe(2);

    // File tag should not be clickable
    const fileTag = Array.from(contextTags).find(tag => tag.textContent?.includes('main.ts'));
    expect(fileTag).toBeDefined();
    expect(fileTag!.className).not.toMatch(/clickable/);

    // Directory tag should not be clickable
    const dirTag = Array.from(contextTags).find(tag => tag.textContent?.includes('src'));
    expect(dirTag).toBeDefined();
    expect(dirTag!.className).not.toMatch(/clickable/);
  });

  it('should have clickable class for image tags in messages', () => {
    renderChatApp();

    const messages = [{
      id: 'msg2',
      role: 'user' as const,
      timestamp: '2024-01-01T00:00:00.000Z',
      blocks: [
        {
          type: 'text' as const,
          content: 'Check this image [@file:/workspace/images/logo.png].'
        }
      ]
    }];

    sendCommand('updateMessages', { messages });

    const userMessage = document.querySelector('.message.user');
    expect(userMessage).toBeInTheDocument();

    const imageTag = userMessage!.querySelector('.context-tag.is-image');
    expect(imageTag).toBeInTheDocument();
    expect(imageTag!.className).toMatch(/clickable/);
  });

  it('should have clickable class for code selection tags in messages', () => {
    renderChatApp();

    const messages = [{
      id: 'msg3',
      role: 'user' as const,
      timestamp: '2024-01-01T00:00:00.000Z',
      blocks: [
        {
          type: 'text' as const,
          content: 'Check this selection [Selection: /workspace/src/main.ts|main.ts#10-20].'
        }
      ]
    }];

    sendCommand('updateMessages', { messages });

    const userMessage = document.querySelector('.message.user');
    expect(userMessage).toBeInTheDocument();

    const selectionTag = Array.from(userMessage!.querySelectorAll('.context-tag'))
      .find(tag => tag.textContent?.includes('main.ts#10-20'));
    expect(selectionTag).toBeDefined();
    expect(selectionTag!.className).toMatch(/clickable/);
  });

  it('should have clickable class for inline image tags (pasted images)', () => {
    renderChatApp();

    const messages = [{
      id: 'msg4',
      role: 'user' as const,
      timestamp: '2024-01-01T00:00:00.000Z',
      blocks: [
        {
          type: 'text' as const,
          content: 'Check this pasted image [image1].'
        },
        {
          type: 'image' as const,
          imageUrls: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==']
        }
      ]
    }];

    sendCommand('updateMessages', { messages });

    const userMessage = document.querySelector('.message.user');
    expect(userMessage).toBeInTheDocument();

    const inlineImageTag = userMessage!.querySelector('.context-tag.is-image');
    expect(inlineImageTag).toBeInTheDocument();
    expect(inlineImageTag!.className).toMatch(/clickable/);
  });
});

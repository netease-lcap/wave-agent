import { renderChatApp, sendCommand } from './test-utils';
import { MockDataGenerator } from '../fixtures/mockData';
import { describe, it, expect, beforeEach } from 'vitest';

describe('Directory Mention Display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should correctly display directory with trailing slash in message list', () => {
    renderChatApp();

    const messages = [
      MockDataGenerator.createUserMessage('Check this directory: [@file:.git/]')
    ];

    sendCommand('updateMessages', { messages });

    // Verify the message is displayed
    const userMessages = document.querySelectorAll('.message.user');
    expect(userMessages.length).toBe(1);

    // Check if the ContextTag is rendered correctly
    const contextTag = userMessages[0].querySelector('.context-tag');
    expect(contextTag).toBeInTheDocument();

    // The name should be '.git' (trailing slash removed by our fix)
    const tagName = contextTag!.querySelector('.tag-name');
    expect(tagName).toHaveTextContent('.git');

    // Verify the data-path attribute still has the trailing slash
    expect(contextTag!.getAttribute('data-path')).toBe('.git/');
  });

  it('should correctly display nested directory with trailing slash', () => {
    renderChatApp();

    const messages = [
      MockDataGenerator.createUserMessage('Nested dir: [@file:src/components/]')
    ];

    sendCommand('updateMessages', { messages });

    const userMessages = document.querySelectorAll('.message.user');
    expect(userMessages.length).toBe(1);

    const contextTag = userMessages[0].querySelector('.context-tag');
    expect(contextTag).toBeInTheDocument();

    // The name should be 'components'
    const tagName = contextTag!.querySelector('.tag-name');
    expect(tagName).toHaveTextContent('components');

    expect(contextTag!.getAttribute('data-path')).toBe('src/components/');
  });
});

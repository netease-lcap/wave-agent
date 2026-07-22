import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderChatApp, screen, sendCommand } from './test-utils';
import { MockDataGenerator } from '../fixtures/mockData';

/**
 * Timeline vertical-line grouping (设计稿: assistant 时间线竖线跨消息贯穿).
 *
 * MessageList groups consecutive role==='assistant' messages into a single
 * `.assistant-group` wrapper so the timeline line runs continuously through all
 * their dots. User messages break the timeline. A group whose messages
 * contribute only a single timeline dot gets `.assistant-group--single`.
 */
describe('Timeline assistant grouping', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function getContainer() {
        return screen.getByTestId('messages-container');
    }

    it('groups consecutive assistant messages and isolates the post-user one', () => {
        renderChatApp();

        const messages = [
            MockDataGenerator.createAssistantMessage('first assistant', 'a1'),
            MockDataGenerator.createAssistantMessage('second assistant', 'a2'),
            MockDataGenerator.createUserMessage('a user question', 'u1'),
            MockDataGenerator.createAssistantMessage('third assistant', 'a3'),
        ];
        sendCommand('updateMessages', { messages });

        const container = getContainer();
        const groups = container.querySelectorAll('.assistant-group');

        // Two assistant runs → two groups (the user message breaks the run).
        expect(groups.length).toBe(2);

        // First group: the two consecutive assistant messages.
        const firstGroup = groups[0];
        const firstGroupAssistants = firstGroup.querySelectorAll('.message.assistant');
        expect(firstGroupAssistants.length).toBe(2);
        // Two single-block assistant messages → 2 dots → NOT single, line drawn.
        expect(firstGroup.classList.contains('assistant-group--single')).toBe(false);

        // Second group: the lone post-user assistant, single dot → --single.
        const secondGroup = groups[1];
        const secondGroupAssistants = secondGroup.querySelectorAll('.message.assistant');
        expect(secondGroupAssistants.length).toBe(1);
        expect(secondGroup.classList.contains('assistant-group--single')).toBe(true);
    });

    it('does not wrap the user message inside any assistant-group', () => {
        renderChatApp();

        const messages = [
            MockDataGenerator.createAssistantMessage('first assistant', 'a1'),
            MockDataGenerator.createAssistantMessage('second assistant', 'a2'),
            MockDataGenerator.createUserMessage('a user question', 'u1'),
            MockDataGenerator.createAssistantMessage('third assistant', 'a3'),
        ];
        sendCommand('updateMessages', { messages });

        const container = getContainer();
        const userMessage = container.querySelector('[data-role="user"]');
        expect(userMessage).not.toBeNull();
        // The user message must be a direct child of the container, outside any group.
        expect(userMessage?.closest('.assistant-group')).toBeNull();
    });
});

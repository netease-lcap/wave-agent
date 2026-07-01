import { describe, it, expect, beforeEach } from 'vitest';
import { renderChatApp, screen, waitFor, fireEvent, sendCommand, fireInput } from './test-utils';
import { MockDataGenerator } from '../fixtures/mockData';

/**
 * Helper: set contenteditable text and fire input event
 */
async function typeMessage(text: string) {
    const input = screen.getByTestId('message-input');
    input.textContent = text;
    await fireInput(input, { inputType: 'insertText' });
}

/**
 * Helper: get all message elements from the messages container
 */
function getMessages(): HTMLElement[] {
    const container = screen.getByTestId('messages-container');
    return Array.from(container.querySelectorAll('.message'));
}

describe('Basic Message Flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should send and display messages correctly', async () => {
        const { vscode } = renderChatApp();

        // Verify initial state - should have welcome message
        expect(getMessages()).toHaveLength(1);
        expect(getMessages()[0]).toHaveTextContent('您好！我是您的 AI 助手');

        // Clear message log
        vscode.postMessage.mockClear();

        // Type and send a message
        await typeMessage('Hello, can you help me?');
        fireEvent.click(screen.getByTestId('send-btn'));

        // Verify message was sent to extension
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        const sendMessage = sentMessages.find((m: Record<string, unknown>) => m.command === 'sendMessage');
        expect(sendMessage).toBeDefined();
        expect(sendMessage).toEqual({
            command: 'sendMessage',
            text: 'Hello, can you help me?',
            images: undefined,
            force: false
        });

        // Verify input field is cleared but enabled (can send more messages while streaming)
        const input = screen.getByTestId('message-input');
        expect(input.textContent).toBe('');
        expect(input).not.toHaveAttribute('contenteditable', 'false');

        // Simulate assistant response
        const messages = [
            MockDataGenerator.createUserMessage('Hello, can you help me?'),
            MockDataGenerator.createAssistantMessage('Yes, I can help you with your project!')
        ];

        sendCommand('updateMessages', { messages });

        // End streaming to restore UI state (simulates agent.sendMessage() completion)
        sendCommand('endStreaming');

        // Verify both messages are displayed
        await waitFor(() => {
            expect(getMessages()).toHaveLength(3); // Welcome + user + assistant
        });
        expect(getMessages()[1]).toHaveTextContent('Hello, can you help me?');
        expect(getMessages()[2]).toHaveTextContent(/Yes, I can help you/);

        // Verify message roles
        expect(getMessages()[1].classList.contains('user')).toBe(true);
        expect(getMessages()[2].classList.contains('user')).toBe(false);

        // After response, input should be re-enabled
        expect(input.textContent).toBe('');
    });

    it('should handle multiple message exchanges', () => {
        renderChatApp();

        // Simulate a conversation
        const conversation = MockDataGenerator.createSampleConversation();
        sendCommand('updateMessages', { messages: conversation });

        // Verify all messages are displayed
        expect(getMessages()).toHaveLength(5); // Welcome + 4 conversation messages

        // Verify the conversation flow
        expect(getMessages()[1]).toHaveTextContent(/Hello, can you help me/);
        expect(getMessages()[2]).toHaveTextContent(/I'd be happy to help/);
        expect(getMessages()[3]).toHaveTextContent(/Can you read the package.json/);
        expect(getMessages()[4]).toHaveTextContent(/I'll read the package.json/);
    });

    it('should maintain input functionality after messages', async () => {
        const { vscode } = renderChatApp();

        // Send initial message
        await typeMessage('First message');
        fireEvent.click(screen.getByTestId('send-btn'));

        // Simulate response
        const messages = [
            MockDataGenerator.createUserMessage('First message'),
            MockDataGenerator.createAssistantMessage('Response to first message')
        ];
        sendCommand('updateMessages', { messages });

        // End streaming to restore UI state
        sendCommand('endStreaming');

        // Verify input is still functional
        const input = screen.getByTestId('message-input');
        await waitFor(() => {
            expect(input.textContent).toBe('');
        });
        expect(screen.getByTestId('send-btn')).toBeInTheDocument();

        // Send another message
        vscode.postMessage.mockClear();
        await typeMessage('Second message');
        fireEvent.click(screen.getByTestId('send-btn'));

        // Verify second message was sent
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        const sendMessage = sentMessages.find((m: Record<string, unknown>) => m.command === 'sendMessage');
        expect(sendMessage).toBeDefined();
        expect(sendMessage.text).toBe('Second message');
    });
});

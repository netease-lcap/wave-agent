import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, screen, waitFor, fireEvent, act, sendCommand } from './test-utils';
import { MockDataGenerator } from '../fixtures/mockData';

describe('Rewind Feature', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should send rewindToMessage command only after confirming the dialog', async () => {
        const { vscode } = renderChatApp();

        const messages = [
            MockDataGenerator.createUserMessage('Message 1', 'msg-1'),
            MockDataGenerator.createAssistantMessage('Response 1', 'msg-2'),
            MockDataGenerator.createUserMessage('Message 2', 'msg-3'),
            MockDataGenerator.createAssistantMessage('Response 2', 'msg-4')
        ];

        act(() => {
            sendCommand('updateMessages', { messages });
        });

        // Verify messages are displayed
        await waitFor(() => {
            expect(screen.getByText('Message 1')).toBeInTheDocument();
        });

        // Clear message log to track new commands
        vscode.postMessage.mockClear();

        // Click rewind on the first user message (Message 1)
        const rewindButtons = document.querySelectorAll('.message-action-btn');
        expect(rewindButtons.length).toBeGreaterThanOrEqual(1);

        await act(async () => {
            fireEvent.click(rewindButtons[0] as HTMLElement);
        });

        // Clicking rewind only opens the confirmation dialog — no command yet
        expect(screen.getByTestId('confirm-dialog-overlay')).toBeInTheDocument();
        expect(screen.getByText('确定要回滚到此消息吗？')).toBeInTheDocument();
        let sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        expect(sentMessages.find(m => m.command === 'rewindToMessage')).toBeUndefined();

        // Confirm the dialog
        await act(async () => {
            fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
        });

        // Dialog closes and the command is sent to the extension
        expect(screen.queryByTestId('confirm-dialog-overlay')).not.toBeInTheDocument();
        sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        const rewindCommand = sentMessages.find(m => m.command === 'rewindToMessage');
        expect(rewindCommand).toBeDefined();
        expect(rewindCommand).toEqual({
            command: 'rewindToMessage',
            messageId: 'msg-1'
        });
    });

    it('should not send rewindToMessage when the dialog is cancelled', async () => {
        const { vscode } = renderChatApp();

        const messages = [
            MockDataGenerator.createUserMessage('Message 1', 'msg-1'),
            MockDataGenerator.createAssistantMessage('Response 1', 'msg-2')
        ];

        act(() => {
            sendCommand('updateMessages', { messages });
        });

        await waitFor(() => {
            expect(screen.getByText('Message 1')).toBeInTheDocument();
        });

        vscode.postMessage.mockClear();

        const rewindButtons = document.querySelectorAll('.message-action-btn');
        await act(async () => {
            fireEvent.click(rewindButtons[0] as HTMLElement);
        });

        expect(screen.getByTestId('confirm-dialog-overlay')).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));
        });

        expect(screen.queryByTestId('confirm-dialog-overlay')).not.toBeInTheDocument();
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        expect(sentMessages.find(m => m.command === 'rewindToMessage')).toBeUndefined();
    });

    it('should remove selected message and put its content back to input after rewind', async () => {
        renderChatApp();

        const messages = [
            MockDataGenerator.createUserMessage('Message 1', 'msg-1'),
            MockDataGenerator.createAssistantMessage('Response 1', 'msg-2'),
            MockDataGenerator.createUserMessage('Message 2', 'msg-3'),
            MockDataGenerator.createAssistantMessage('Response 2', 'msg-4')
        ];

        act(() => {
            sendCommand('updateMessages', { messages });
        });

        await waitFor(() => {
            expect(screen.getByText('Message 1')).toBeInTheDocument();
        });

        // Click rewind on the second user message (Message 2)
        const rewindButtons = document.querySelectorAll('.message-action-btn');
        expect(rewindButtons.length).toBeGreaterThanOrEqual(2);

        await act(async () => {
            fireEvent.click(rewindButtons[1] as HTMLElement);
        });

        // Confirm the dialog so the command is dispatched
        await act(async () => {
            fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
        });

        // Simulate backend response after rewind — setInitialState with truncated messages + inputContent
        const updatedMessages = [messages[0], messages[1]];
        act(() => {
            sendCommand('setInitialState', {
                messages: updatedMessages,
                inputContent: 'Message 2',
                tasks: [],
                isStreaming: false,
                sessions: [],
                configurationData: {
                    apiKey: '',
                    baseURL: '',
                    model: '',
                    fastModel: '',
                    language: 'zh-CN',
                    permissionMode: 'ask'
                }
            });
        });

        // Verify Message 2 and Response 2 are removed from the messages list
        // (queryByText must be scoped to messages-container because the input box
        //  now contains 'Message 2' via inputContent)
        const messagesContainer = document.querySelector('.messages-container')!;
        await waitFor(() => {
            expect(screen.getByText('Message 1')).toBeInTheDocument();
            expect(messagesContainer.textContent).not.toContain('Message 2');
            expect(messagesContainer.textContent).not.toContain('Response 2');
        });

        // Verify input box has 'Message 2'
        const input = screen.getByTestId('message-input');
        expect(input.textContent).toContain('Message 2');
    });

    it('should not show rewind button on assistant messages', async () => {
        renderChatApp();

        const messages = [
            MockDataGenerator.createUserMessage('User message'),
            MockDataGenerator.createAssistantMessage('Assistant message')
        ];

        act(() => {
            sendCommand('updateMessages', { messages });
        });

        await waitFor(() => {
            expect(screen.getByText('User message')).toBeInTheDocument();
        });

        // Rewind buttons should only appear on user messages
        const rewindButtons = document.querySelectorAll('.message-action-btn');
        // Only 1 user message (non-bang) should have a rewind button
        expect(rewindButtons).toHaveLength(1);
    });
});

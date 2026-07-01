import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, screen, waitFor, fireEvent, act, sendCommand, setInputText } from './test-utils';
import { MockDataGenerator } from '../fixtures/mockData';
import type { Message } from 'wave-agent-sdk';

describe('Error Message Display', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should display error messages', async () => {
        renderChatApp();

        const errorMessage = 'Connection failed: Unable to reach the server';
        act(() => {
            sendCommand('updateMessages', {
                messages: [{
                    id: 'msg_err_1',
                    role: 'assistant',
                    timestamp: '2024-01-01T00:00:00.000Z',
                    blocks: [{ type: 'error', content: errorMessage }]
                }]
            });
        });

        await waitFor(() => {
            expect(screen.getByText(errorMessage)).toBeInTheDocument();
        });

        // Verify interface remains functional
        const input = screen.getByTestId('message-input');
        expect(input).toBeInTheDocument();
        expect(screen.getByTestId('send-btn')).toBeInTheDocument();
    });

    it('should handle error messages in conversation context', async () => {
        renderChatApp();

        const messages = [
            MockDataGenerator.createUserMessage('Hello'),
            MockDataGenerator.createAssistantMessage('Hi there!')
        ];

        act(() => {
            sendCommand('updateMessages', { messages });
        });

        await waitFor(() => {
            expect(screen.getByText('Hello')).toBeInTheDocument();
        });

        // Now show an error
        act(() => {
            sendCommand('updateMessages', {
                messages: [...messages, {
                    id: 'msg_err_2',
                    role: 'assistant',
                    timestamp: '2024-01-01T00:00:00.000Z',
                    blocks: [{ type: 'error', content: 'An error occurred while processing your request' }]
                }]
            });
        });

        // Verify error is displayed and previous messages remain
        await waitFor(() => {
            expect(screen.getByText('An error occurred while processing your request')).toBeInTheDocument();
        });
        expect(screen.getByText('Hello')).toBeInTheDocument();
        expect(screen.getByText('Hi there!')).toBeInTheDocument();
    });

    it('should display error messages from agent', async () => {
        renderChatApp();

        const errorMessage = MockDataGenerator.createErrorMessage('Failed to read file: Permission denied');

        act(() => {
            sendCommand('updateMessages', { messages: [errorMessage] });
        });

        await waitFor(() => {
            expect(screen.getByText('Failed to read file: Permission denied')).toBeInTheDocument();
        });
    });

    it('should handle multiple error types', async () => {
        renderChatApp();

        const errors = [
            'Network timeout',
            'Invalid API key',
            'File not found',
            'Permission denied'
        ];

        const errorMessages: Message[] = errors.map((error, index) => ({
            id: `msg_err_multi_${index}`,
            role: 'assistant' as const,
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: [{ type: 'error' as const, content: error }]
        }));

        act(() => {
            sendCommand('updateMessages', { messages: errorMessages });
        });

        // Verify all errors are displayed
        await waitFor(() => {
            expect(screen.getByText('Network timeout')).toBeInTheDocument();
        });
        for (const error of errors) {
            expect(screen.getByText(error)).toBeInTheDocument();
        }

        // Verify all error elements are present
        const errorElements = document.querySelectorAll('.message-content.error');
        expect(errorElements).toHaveLength(errors.length);
    });

    it('should allow recovery after error', async () => {
        const { vscode } = renderChatApp();

        // Show error
        act(() => {
            sendCommand('updateMessages', {
                messages: [{
                    id: 'msg_err_recovery',
                    role: 'assistant',
                    timestamp: '2024-01-01T00:00:00.000Z',
                    blocks: [{ type: 'error', content: 'Something went wrong' }]
                }]
            });
        });

        await waitFor(() => {
            expect(screen.getByText('Something went wrong')).toBeInTheDocument();
        });

        // Verify user can still send messages
        vscode.postMessage.mockClear();

        const input = screen.getByTestId('message-input');
        setInputText(input, 'Can you try again?');

        await act(async () => {
            fireEvent.click(screen.getByTestId('send-btn'));
        });

        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        const sendMessage = sentMessages.find(m => m.command === 'sendMessage');
        expect(sendMessage).toBeDefined();
        expect(sendMessage.text).toBe('Can you try again?');

        // Simulate successful response after error
        const messages = [
            MockDataGenerator.createUserMessage('Can you try again?'),
            MockDataGenerator.createAssistantMessage('Sure! Let me try that again.')
        ];
        act(() => {
            sendCommand('updateMessages', { messages });
        });

        await waitFor(() => {
            expect(screen.getByText('Sure! Let me try that again.')).toBeInTheDocument();
        });
    });

    it('should handle errors during streaming', async () => {
        renderChatApp();

        // Start streaming
        act(() => {
            sendCommand('startStreaming');
        });

        // Add some streaming content
        act(() => {
            sendCommand('updateMessages', {
                messages: [{
                    id: 'msg_streaming_err',
                    role: 'assistant',
                    timestamp: '2024-01-01T00:00:00.000Z',
                    blocks: [{ type: 'text', content: 'I was working on your request when...' }]
                }]
            });
        });

        // Show error during streaming
        act(() => {
            sendCommand('updateMessages', {
                messages: [{
                    id: 'msg_streaming_err_final',
                    role: 'assistant',
                    timestamp: '2024-01-01T00:00:00.000Z',
                    blocks: [{ type: 'error', content: 'Connection lost during streaming' }]
                }]
            });
        });

        // Verify error is displayed
        await waitFor(() => {
            expect(screen.getByText('Connection lost during streaming')).toBeInTheDocument();
        });

        // End streaming to restore UI state
        act(() => {
            sendCommand('endStreaming');
        });

        // Verify abort button is not visible (display: none)
        await waitFor(() => {
            const abortBtn = screen.queryByTestId('abort-btn');
            if (abortBtn) {
                expect(abortBtn.style.display).toBe('none');
            }
        });

        // Verify interface is functional again
        const input = screen.getByTestId('message-input');
        expect(input).toBeInTheDocument();
        expect(screen.getByTestId('send-btn')).toBeInTheDocument();
    });
});

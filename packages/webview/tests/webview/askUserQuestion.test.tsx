import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, waitFor, act, sendCommand } from './test-utils';
import { ASK_USER_QUESTION_TOOL_NAME } from 'wave-agent-sdk';
import type { Message } from 'wave-agent-sdk';

describe('AskUserQuestion Newline Support', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should support newlines in question and answer', async () => {
        renderChatApp();

        const mockMessage: Message = {
            id: 'msg_ask_1',
            role: 'assistant' as const,
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: [
                {
                    type: 'tool' as const,
                    name: ASK_USER_QUESTION_TOOL_NAME,
                    stage: 'end' as const,
                    result: JSON.stringify({
                        answers: {
                            'Question with\nnewline': 'Answer with\nnewline'
                        }
                    })
                }
            ]
        };

        act(() => {
            sendCommand('updateMessages', { messages: [mockMessage] });
        });

        await waitFor(() => {
            expect(document.querySelector('.ask-user-result-q')).toBeInTheDocument();
        });

        const questionElement = document.querySelector('.ask-user-result-q')!;
        const answerElement = document.querySelector('.ask-user-result-a')!;

        // toHaveTextContent normalizes whitespace, so check textContent directly for newlines
        expect(questionElement.textContent).toBe('Question with\nnewline');
        expect(answerElement.textContent).toBe('Answer with\nnewline');

        // Verify white-space: pre-wrap is applied via inline style
        expect(questionElement.getAttribute('style')).toContain('pre-wrap');
        expect(answerElement.getAttribute('style')).toContain('pre-wrap');
    });

    it('should support automatic wrapping for long text', async () => {
        renderChatApp();

        const longText = 'This is a very long text that should wrap automatically because of pre-wrap setting. '.repeat(10);
        const mockMessage: Message = {
            id: 'msg_ask_2',
            role: 'assistant' as const,
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: [
                {
                    type: 'tool' as const,
                    name: ASK_USER_QUESTION_TOOL_NAME,
                    stage: 'end' as const,
                    result: JSON.stringify({
                        answers: {
                            'Long Question': longText
                        }
                    })
                }
            ]
        };

        act(() => {
            sendCommand('updateMessages', { messages: [mockMessage] });
        });

        await waitFor(() => {
            expect(document.querySelector('.ask-user-result-a')).toBeInTheDocument();
        });

        const answerElement = document.querySelector('.ask-user-result-a')!;
        expect(answerElement.textContent).toBe(longText);
        expect(answerElement.getAttribute('style')).toContain('pre-wrap');
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, screen, waitFor, act, sendCommand } from './test-utils';
import { MockDataGenerator } from '../fixtures/mockData';

describe('Task Notification Block Rendering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render completed task notification with proper styling', async () => {
        renderChatApp();

        const message = MockDataGenerator.createAssistantMessageWithTaskNotification(
            'Background task completed:',
            'task-1',
            'shell',
            'completed',
            'npm test passed with 42 tests',
            '/tmp/test-output.log'
        );

        act(() => {
            sendCommand('updateMessages', { messages: [message] });
        });

        await waitFor(() => {
            expect(screen.getByText('已完成')).toBeInTheDocument();
        });

        const block = document.querySelector('.task-notification-block');
        expect(block).toBeInTheDocument();
        expect(block).toHaveTextContent('已完成');
        expect(block).toHaveTextContent('npm test passed with 42 tests');
        expect(block).toHaveTextContent('输出: /tmp/test-output.log');
    });

    it('should render failed task notification with proper styling', async () => {
        renderChatApp();

        const message = MockDataGenerator.createAssistantMessageWithTaskNotification(
            '',
            'task-2',
            'agent',
            'failed',
            'Explore agent encountered an error during file analysis'
        );

        act(() => {
            sendCommand('updateMessages', { messages: [message] });
        });

        await waitFor(() => {
            expect(screen.getByText('失败')).toBeInTheDocument();
        });

        const block = document.querySelector('.task-notification-block');
        expect(block).toBeInTheDocument();
        expect(block).toHaveTextContent('失败');
        expect(block).toHaveTextContent('Explore agent encountered an error during file analysis');
    });

    it('should render killed task notification with proper styling', async () => {
        renderChatApp();

        const message = MockDataGenerator.createAssistantMessageWithTaskNotification(
            '',
            'task-3',
            'shell',
            'killed',
            'Long-running process was terminated by user'
        );

        act(() => {
            sendCommand('updateMessages', { messages: [message] });
        });

        await waitFor(() => {
            expect(screen.getByText('已终止')).toBeInTheDocument();
        });

        const block = document.querySelector('.task-notification-block');
        expect(block).toBeInTheDocument();
        expect(block).toHaveTextContent('已终止');
        expect(block).toHaveTextContent('Long-running process was terminated by user');
    });

    it('should render multiple task notifications in a single message', async () => {
        renderChatApp();

        const messages = [
            MockDataGenerator.createAssistantMessageWithTaskNotification(
                '',
                'task-completed',
                'shell',
                'completed',
                'Build succeeded'
            ),
            MockDataGenerator.createAssistantMessageWithTaskNotification(
                '',
                'task-failed',
                'agent',
                'failed',
                'Agent failed to connect'
            )
        ];

        act(() => {
            sendCommand('updateMessages', { messages });
        });

        await waitFor(() => {
            const blocks = document.querySelectorAll('.task-notification-block');
            expect(blocks).toHaveLength(2);
        });
    });

    it('should handle task notification without summary or outputFile', async () => {
        renderChatApp();

        const message = MockDataGenerator.createAssistantMessageWithTaskNotification(
            '',
            'task-minimal',
            'agent',
            'completed'
        );

        act(() => {
            sendCommand('updateMessages', { messages: [message] });
        });

        await waitFor(() => {
            expect(screen.getByText('已完成')).toBeInTheDocument();
        });

        const block = document.querySelector('.task-notification-block');
        expect(block).toBeInTheDocument();
        expect(block).toHaveTextContent('已完成');
    });
});

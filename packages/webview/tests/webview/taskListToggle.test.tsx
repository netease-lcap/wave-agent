import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, screen, waitFor, fireEvent, act, sendCommand } from './test-utils';

describe('Task List Toggle Feature', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should toggle task list visibility on Ctrl+T', async () => {
        renderChatApp();

        // 1. Simulate tasks from extension to make task list visible
        const mockTasks = [
            { id: '1', subject: 'Task 1', status: 'pending' },
            { id: '2', subject: 'Task 2', status: 'in_progress', activeForm: 'Running' }
        ];

        act(() => {
            sendCommand('updateTasks', { tasks: mockTasks });
        });

        // 2. Verify task list is visible and not collapsed initially
        await waitFor(() => {
            expect(screen.getByTestId('task-list')).toBeInTheDocument();
        });

        const taskList = screen.getByTestId('task-list');
        expect(taskList).not.toHaveClass('collapsed');

        // 3. Focus message input
        const messageInput = screen.getByTestId('message-input');
        messageInput.focus();

        // 4. Press Ctrl+T to collapse
        await act(async () => {
            fireEvent.keyDown(window, { key: 't', ctrlKey: true });
        });

        expect(screen.getByTestId('task-list')).toHaveClass('collapsed');

        // 5. Press Ctrl+T to expand
        await act(async () => {
            fireEvent.keyDown(window, { key: 't', ctrlKey: true });
        });

        expect(screen.getByTestId('task-list')).not.toHaveClass('collapsed');

        // 6. Blur message input and press Ctrl+T
        // Click on messages container to blur input
        const messagesContainer = screen.getByTestId('messages-container');
        await act(async () => {
            fireEvent.click(messagesContainer);
        });

        await act(async () => {
            fireEvent.keyDown(window, { key: 't', ctrlKey: true });
        });
        expect(screen.getByTestId('task-list')).toHaveClass('collapsed');

        await act(async () => {
            fireEvent.keyDown(window, { key: 't', ctrlKey: true });
        });
        expect(screen.getByTestId('task-list')).not.toHaveClass('collapsed');
    });
});

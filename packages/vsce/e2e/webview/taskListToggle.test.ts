import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';

test.describe('Task List Toggle Feature', () => {
  test('should toggle task list visibility on Ctrl+T', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.clearMessageLog();

    // 1. Simulate tasks from extension to make task list visible
    const mockTasks = [
      { id: '1', subject: 'Task 1', status: 'pending' },
      { id: '2', subject: 'Task 2', status: 'in_progress', activeForm: 'Running' }
    ];

    await injector.simulateExtensionMessage('updateTasks', {
      tasks: mockTasks
    });

    // 2. Verify task list is visible and not collapsed initially
    const taskList = webviewPage.getByTestId('task-list');
    await expect(taskList).toBeVisible();
    await expect(taskList).not.toHaveClass(/collapsed/);

    // 3. Focus message input
    const messageInput = webviewPage.getByTestId('message-input');
    await messageInput.focus();

    // 4. Press Ctrl+T to collapse
    await webviewPage.keyboard.press('Control+t');
    await expect(taskList).toHaveClass(/collapsed/);

    // 5. Press Ctrl+T to expand
    await webviewPage.keyboard.press('Control+t');
    await expect(taskList).not.toHaveClass(/collapsed/);

    // 6. Blur message input and press Ctrl+T
    await webviewPage.getByTestId('messages-container').click();
    await expect(messageInput).not.toBeFocused();

    await webviewPage.keyboard.press('Control+t');
    await expect(taskList).toHaveClass(/collapsed/);

    await webviewPage.keyboard.press('Control+t');
    await expect(taskList).not.toHaveClass(/collapsed/);
  });
});

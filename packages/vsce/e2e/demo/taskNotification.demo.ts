import { test } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import type { Message } from 'wave-agent-sdk';

test.describe('Task Notification Demo', () => {
  test('capture task notification screenshots', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    const mockMessages: Message[] = [
      {
        id: 'msg_notify_completed',
        role: 'assistant' as const,
        timestamp: '2024-01-01T00:00:00.000Z',
        blocks: [
          {
            type: 'text' as const,
            content: 'Background task completed:'
          },
          {
            type: 'task_notification' as const,
            taskId: 'task-1',
            taskType: 'shell',
            status: 'completed',
            summary: 'npm test passed with 42 tests',
            outputFile: '/tmp/test-output.log'
          }
        ]
      },
      {
        id: 'msg_notify_failed',
        role: 'assistant' as const,
        timestamp: '2024-01-01T00:00:00.000Z',
        blocks: [
          {
            type: 'task_notification' as const,
            taskId: 'task-2',
            taskType: 'agent',
            status: 'failed',
            summary: 'Explore agent encountered an error during file analysis'
          }
        ]
      },
      {
        id: 'msg_notify_killed',
        role: 'assistant' as const,
        timestamp: '2024-01-01T00:00:00.000Z',
        blocks: [
          {
            type: 'task_notification' as const,
            taskId: 'task-3',
            taskType: 'shell',
            status: 'killed',
            summary: 'Long-running process was terminated by user'
          }
        ]
      }
    ];

    await injector.updateMessages(mockMessages);

    // Wait for rendering
    await webviewPage.waitForSelector('.task-notification-block');

    // Take screenshot
    await webviewPage.screenshot({ path: 'docs/public/screenshots/task-notification.png' });
  });
});

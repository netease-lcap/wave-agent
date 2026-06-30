import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { MockDataGenerator } from '../fixtures/mockData.js';

/**
 * Test TaskNotificationBlock rendering functionality
 */

test.describe('Task Notification Block Rendering', () => {
  test('should render completed task notification with proper styling', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    const message = MockDataGenerator.createAssistantMessageWithTaskNotification(
      'Background task completed:',
      'task-1',
      'shell',
      'completed',
      'npm test passed with 42 tests',
      '/tmp/test-output.log'
    );

    await injector.updateMessages([message]);

    await webviewPage.waitForSelector('.task-notification-block', { timeout: 5000 });

    const notificationBlock = webviewPage.locator('.task-notification-block');
    await expect(notificationBlock).toBeVisible();
    await expect(notificationBlock).toContainText('已完成');
    await expect(notificationBlock).toContainText('npm test passed with 42 tests');
    await expect(notificationBlock).toContainText('输出: /tmp/test-output.log');
  });

  test('should render failed task notification with proper styling', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    const message = MockDataGenerator.createAssistantMessageWithTaskNotification(
      '',
      'task-2',
      'agent',
      'failed',
      'Explore agent encountered an error during file analysis'
    );

    await injector.updateMessages([message]);

    await webviewPage.waitForSelector('.task-notification-block', { timeout: 5000 });

    const notificationBlock = webviewPage.locator('.task-notification-block');
    await expect(notificationBlock).toBeVisible();
    await expect(notificationBlock).toContainText('失败');
    await expect(notificationBlock).toContainText('Explore agent encountered an error during file analysis');
  });

  test('should render killed task notification with proper styling', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    const message = MockDataGenerator.createAssistantMessageWithTaskNotification(
      '',
      'task-3',
      'shell',
      'killed',
      'Long-running process was terminated by user'
    );

    await injector.updateMessages([message]);

    await webviewPage.waitForSelector('.task-notification-block', { timeout: 5000 });

    const notificationBlock = webviewPage.locator('.task-notification-block');
    await expect(notificationBlock).toBeVisible();
    await expect(notificationBlock).toContainText('已终止');
    await expect(notificationBlock).toContainText('Long-running process was terminated by user');
  });

  test('should render multiple task notifications in a single message', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

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

    await injector.updateMessages(messages);

    await webviewPage.waitForSelector('.task-notification-block', { timeout: 5000 });

    const blocks = webviewPage.locator('.task-notification-block');
    await expect(blocks).toHaveCount(2);
  });

  test('should handle task notification without summary or outputFile', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    const message = MockDataGenerator.createAssistantMessageWithTaskNotification(
      '',
      'task-minimal',
      'agent',
      'completed'
    );

    await injector.updateMessages([message]);

    await webviewPage.waitForSelector('.task-notification-block', { timeout: 5000 });

    const notificationBlock = webviewPage.locator('.task-notification-block');
    await expect(notificationBlock).toBeVisible();
    await expect(notificationBlock).toContainText('已完成');
  });
});

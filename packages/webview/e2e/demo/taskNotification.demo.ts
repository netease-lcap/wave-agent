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
        timestamp: '2025-07-09T10:30:00.000Z',
        blocks: [
          { type: 'text' as const, content: '后台任务已完成：' },
          {
            type: 'task_notification' as const,
            taskId: 'task-build-001',
            taskType: 'shell',
            status: 'completed',
            summary: 'Docker 镜像构建成功: nebula-payment:v1.2.0 (142MB)',
            outputFile: '/tmp/docker-build-001.log'
          }
        ]
      },
      {
        id: 'msg_notify_failed',
        role: 'assistant' as const,
        timestamp: '2025-07-09T10:30:00.000Z',
        blocks: [
          {
            type: 'task_notification' as const,
            taskId: 'task-agent-002',
            taskType: 'agent',
            status: 'failed',
            summary: '代码审查子代理在分析 PaymentService.ts 时超时'
          }
        ]
      },
      {
        id: 'msg_notify_killed',
        role: 'assistant' as const,
        timestamp: '2025-07-09T10:30:00.000Z',
        blocks: [
          {
            type: 'task_notification' as const,
            taskId: 'task-deploy-003',
            taskType: 'shell',
            status: 'killed',
            summary: 'Kubernetes 部署过程被用户手动终止'
          }
        ]
      }
    ];

    await injector.updateMessages(mockMessages);

    // Wait for rendering
    await webviewPage.waitForSelector('.task-notification-block');

    // Take screenshot
    await webviewPage.screenshot({ path: '../../docs/public/screenshots/task-notification.png' });
  });
});

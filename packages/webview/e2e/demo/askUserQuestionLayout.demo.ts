import { test } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { ASK_USER_QUESTION_TOOL_NAME, Message } from 'wave-agent-sdk';

test.describe('AskUserQuestion Layout Demo', () => {
  test('capture vertical layout screenshot', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    const mockMessage: Message = {
      id: 'msg_ask_demo',
      role: 'assistant' as const,
      timestamp: '2025-07-09T10:30:00.000Z',
      blocks: [
        {
          type: 'tool' as const,
          name: ASK_USER_QUESTION_TOOL_NAME,
          stage: 'end' as const,
          result: JSON.stringify({
            answers: {
              "支付服务应该采用哪种缓存策略？": "Redis Cluster",
              "哪些模块需要优先重构？": "PaymentService, TransactionLogger, RefundHandler"
            }
          })
        }
      ]
    };

    await injector.updateMessages([mockMessage]);

    // Wait for rendering
    await webviewPage.waitForSelector('.ask-user-result-item');

    // Take screenshot
    await webviewPage.screenshot({ path: '../../docs/public/screenshots/ask-user-question-vertical.png' });
  });
});

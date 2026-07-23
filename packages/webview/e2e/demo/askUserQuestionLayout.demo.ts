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
              "客户管理系统有什么具体要求？": "需要支持客户分级、跟进记录、合同关联与数据看板，并对接现有的支付与工单系统。",
              "首期交付优先实现哪些模块？": "客户档案、跟进记录、合同管理"
            }
          })
        }
      ]
    };

    const userMessage: Message = {
      id: 'msg_user_ask',
      role: 'user' as const,
      timestamp: '2025-07-09T10:29:00.000Z',
      blocks: [
        { type: 'text' as const, content: '支付服务重构前，先帮我确认缓存策略和优先重构的模块' }
      ]
    };

    await injector.simulateExtensionMessage('setInitialState', {
      isAuthenticated: true,
      messages: [],
      isStreaming: false,
      sessions: [],
      configurationData: {
        apiKey: 'sk-ant-api03-CXB9pH2k...mH8wQz',
        baseURL: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-4-20250514',
        fastModel: 'claude-haiku-4-20250514'
      },
      permissionMode: 'default'
    });

    await injector.updateMessages([userMessage, mockMessage]);

    // Wait for rendering
    await webviewPage.waitForSelector('.ask-user-result-item');

    // Take screenshot
    await webviewPage.screenshot({ path: '../../docs/public/screenshots/ask-user-question-vertical.png' });
  });
});

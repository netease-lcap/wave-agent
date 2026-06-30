import { test } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { ASK_USER_QUESTION_TOOL_NAME, Message } from 'wave-agent-sdk';

test.describe('AskUserQuestion Layout Demo', () => {
  test('capture vertical layout screenshot', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    const mockMessage: Message = {
      id: 'msg_ask_demo',
      role: 'assistant' as const,
      timestamp: '2024-01-01T00:00:00.000Z',
      blocks: [
        {
          type: 'tool' as const,
          name: ASK_USER_QUESTION_TOOL_NAME,
          stage: 'end' as const,
          result: JSON.stringify({
            answers: {
              "Which library should we use for date formatting?": "date-fns",
              "Which features do you want to enable?": "Authentication, Database, Logging"
            }
          })
        }
      ]
    };

    await injector.updateMessages([mockMessage]);

    // Wait for rendering
    await webviewPage.waitForSelector('.ask-user-result-item');

    // Take screenshot
    await webviewPage.screenshot({ path: 'docs/public/screenshots/ask-user-question-vertical.png' });
  });
});

import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { ASK_USER_QUESTION_TOOL_NAME, Message } from 'wave-agent-sdk';

test.describe('AskUserQuestion Newline Support', () => {
  test('should support newlines in question and answer', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    // Mock a message with AskUserQuestion tool
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
              "Question with\nnewline": "Answer with\nnewline"
            }
          })
        }
      ]
    };

    await injector.updateMessages([mockMessage]);

    // Check if newlines are preserved in the rendered output
    const questionElement = webviewPage.locator('.ask-user-result-q');
    const answerElement = webviewPage.locator('.ask-user-result-a');

    await expect(questionElement).toHaveText('Question with\nnewline');
    await expect(answerElement).toHaveText('Answer with\nnewline');

    // Verify white-space: pre-wrap is applied
    const qStyle = await questionElement.evaluate(el => window.getComputedStyle(el).whiteSpace);
    const aStyle = await answerElement.evaluate(el => window.getComputedStyle(el).whiteSpace);
    expect(qStyle).toBe('pre-wrap');
    expect(aStyle).toBe('pre-wrap');
  });

  test('should support automatic wrapping for long text', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

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
              "Long Question": longText
            }
          })
        }
      ]
    };

    await injector.updateMessages([mockMessage]);

    const answerElement = webviewPage.locator('.ask-user-result-a');
    await expect(answerElement).toHaveText(longText);
    
    const aStyle = await answerElement.evaluate(el => window.getComputedStyle(el).whiteSpace);
    expect(aStyle).toBe('pre-wrap');
  });
});

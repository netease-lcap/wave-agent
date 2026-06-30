import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { UIStateVerifier } from '../utils/uiStateVerifier.js';

test.describe('Meta Message Hiding', () => {
    test('should hide user messages with isMeta=true', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Inject a mix of regular user, meta user, and assistant messages
        await injector.updateMessages([
            {
                id: 'msg_regular_user',
                role: 'user',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: 'Hello' }]
            },
            {
                id: 'msg_meta_user',
                role: 'user',
                isMeta: true,
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: 'This is a meta message' }]
            },
            {
                id: 'msg_assistant',
                role: 'assistant',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: 'Hi there!' }]
            }
        ]);

        // Should only show welcome + regular user + assistant (not the meta user message)
        await ui.verifyMessageCount(3);

        // Verify the meta message content is not visible
        await expect(webviewPage.getByTestId('messages-container')).not.toContainText('This is a meta message');

        // Verify regular messages are still visible (index 1 = first after welcome)
        await ui.verifyMessageContent(1, 'Hello');
        await ui.verifyMessageContent(2, 'Hi there!');
    });

    test('should show user messages without isMeta', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Inject a regular user message (no isMeta)
        await injector.updateMessages([
            {
                id: 'msg_user',
                role: 'user',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: 'Regular message' }]
            }
        ]);

        // Should show welcome + regular user message
        await ui.verifyMessageCount(2);
        await ui.verifyMessageContent(1, 'Regular message');
    });

    test('should handle multiple meta messages mixed with regular messages', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        await injector.updateMessages([
            {
                id: 'msg_user_1',
                role: 'user',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: 'First' }]
            },
            {
                id: 'msg_meta_1',
                role: 'user',
                isMeta: true,
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: 'Meta 1' }]
            },
            {
                id: 'msg_meta_2',
                role: 'user',
                isMeta: true,
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: 'Meta 2' }]
            },
            {
                id: 'msg_user_2',
                role: 'user',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: 'Second' }]
            }
        ]);

        // Should show welcome + 2 regular user messages (not the 2 meta messages)
        await ui.verifyMessageCount(3);

        // Verify meta messages are not visible
        await expect(webviewPage.getByTestId('messages-container')).not.toContainText('Meta 1');
        await expect(webviewPage.getByTestId('messages-container')).not.toContainText('Meta 2');

        // Verify regular messages are visible (index 1 = first after welcome)
        await ui.verifyMessageContent(1, 'First');
        await ui.verifyMessageContent(2, 'Second');
    });

    test('should always show assistant messages regardless of isMeta', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        await injector.updateMessages([
            {
                id: 'msg_assistant',
                role: 'assistant',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: 'Assistant reply' }]
            }
        ]);

        // Assistant messages should always be shown
        await ui.verifyMessageCount(2); // welcome + assistant
        await ui.verifyMessageContent(1, 'Assistant reply');
    });
});

import { test } from '../utils/webviewTestHarness.js';

test.describe('Tooltip Demo', () => {
    test('capture send button tooltip', async ({ webviewPage }) => {
        // Send button tooltip
        const sendButton = webviewPage.getByTestId('send-btn');
        await sendButton.scrollIntoViewIfNeeded();
        await sendButton.locator('..').hover();
        await sendButton.focus();
        await webviewPage.locator('.input-container').screenshot({ path: '../../docs/public/screenshots/tooltip-send.png' });

    });
});

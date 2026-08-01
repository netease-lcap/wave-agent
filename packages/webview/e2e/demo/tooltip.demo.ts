import { test } from '../utils/webviewTestHarness.js';
import { screenshotWebp, elementScreenshotWebp } from '../utils/screenshot.js';

test.describe('Tooltip Demo', () => {
    test('capture send button tooltip', async ({ webviewPage }) => {
        // Send button tooltip
        const sendButton = webviewPage.getByTestId('send-btn');
        await sendButton.scrollIntoViewIfNeeded();
        await sendButton.locator('..').hover();
        await sendButton.focus();
        await elementScreenshotWebp(webviewPage.locator('.input-container'), '../../docs/public/screenshots/tooltip-send.webp');

    });
});

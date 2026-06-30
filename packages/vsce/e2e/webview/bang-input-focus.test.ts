import { test, expect } from '../utils/webviewTestHarness.js';
import { UIStateVerifier } from '../utils/uiStateVerifier.js';

test.describe('Bang Input Focus', () => {
    test('input should regain focus after bang command completes', async ({ webviewPage }) => {
        const ui = new UIStateVerifier(webviewPage);

        // Verify input is initially focused
        await ui.messageInput.focus();
        await expect(ui.messageInput).toBeFocused();

        // Simulate bang command starting (isCommandRunning = true)
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'updateCommandRunning',
                running: true
            });
        });

        // Input should remain enabled when command is running
        await ui.verifyInputState(false, false);

        // Simulate bang command completing (isCommandRunning = false)
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'updateCommandRunning',
                running: false
            });
        });

        // Input should be enabled again
        await ui.verifyInputState(false, false);

        // Input should have regained focus
        await expect(ui.messageInput).toBeFocused();
    });

    test('input should remain focused when sending normal message', async ({ webviewPage }) => {
        const ui = new UIStateVerifier(webviewPage);

        // Focus the input
        await ui.messageInput.focus();
        await expect(ui.messageInput).toBeFocused();

        // Simulate streaming starting (normal message)
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'startStreaming'
            });
        });

        // Input should still be enabled (not disabled by streaming)
        await ui.verifyInputState(false, false);
    });
});

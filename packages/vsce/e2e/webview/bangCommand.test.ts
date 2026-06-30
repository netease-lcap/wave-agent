import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { UIStateVerifier } from '../utils/uiStateVerifier.js';
import { MockDataGenerator } from '../fixtures/mockData.js';

test.describe('Bang Command', () => {
    test('should send bang command when input starts with !', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Clear message log
        await injector.clearMessageLog();

        // Type and send a bang command
        await ui.typeMessage('!ls -la');
        await ui.clickSend();

        // Verify message was sent to extension
        const sentMessages = await injector.getMessagesSentToExtension();
        const sendMessage = sentMessages.find(m => m.command === 'sendMessage');
        expect(sendMessage).toBeDefined();
        expect(sendMessage.text).toBe('!ls -la');
    });

    test('should display bang block correctly', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Simulate a bang command message
        const messages = [
            MockDataGenerator.createBangMessage('ls -la', 'total 0\ndrwxr-xr-x  2 user  group  64 Mar 30 10:00 .', false, 0)
        ];
        await injector.updateMessages(messages);

        // Verify bang block is displayed using bash-command-unified class
        const bangBlock = webviewPage.locator('.bash-command-unified');
        await expect(bangBlock).toBeVisible();
        await expect(bangBlock.locator('.bash-command')).toHaveText('ls -la');
        await expect(bangBlock.locator('.bash-command-output')).toContainText('total 0');
    });

    test('should handle long output with scrolling', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Create 20 lines of output
        const longOutput = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
        
        // Simulate a bang command message with long output
        const messages = [
            MockDataGenerator.createBangMessage('seq 1 20', longOutput, false, 0)
        ];
        await injector.updateMessages(messages);

        const bangBlock = webviewPage.locator('.bash-command-unified');
        const output = bangBlock.locator('.bash-command-output');

        // Verify output is displayed (it will scroll due to CSS max-height)
        await expect(output).toBeVisible();
        const displayedText = await output.innerText();
        expect(displayedText).toContain('line 1');
        expect(displayedText).toContain('line 20');
    });

    test('should show running state with loading icon', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Simulate a running bang command
        const messages = [
            MockDataGenerator.createBangMessage('sleep 10', '', true, null)
        ];
        await injector.updateMessages(messages);

        const bangBlock = webviewPage.locator('.bash-command-unified');
        await expect(bangBlock.locator('.codicon-loading')).toBeVisible();
    });

    test('should show failure state with exit code', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Simulate a failed bang command
        const messages = [
            MockDataGenerator.createBangMessage('false', '', false, 1)
        ];
        await injector.updateMessages(messages);

        const bangBlock = webviewPage.locator('.bash-command-unified');
        await expect(bangBlock.locator('.bash-command-output')).toHaveText(/退出代码: 1/);
    });

    test('should show success exit code when no output', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Simulate a successful bang command with no output
        const messages = [
            MockDataGenerator.createBangMessage('mkdir test-dir', '', false, 0)
        ];
        await injector.updateMessages(messages);

        const bangBlock = webviewPage.locator('.bash-command-unified');
        await expect(bangBlock.locator('.bash-command-output')).toHaveText(/退出代码: 0/);
    });
});

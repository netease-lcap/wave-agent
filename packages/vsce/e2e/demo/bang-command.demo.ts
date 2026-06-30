import { test } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { MockDataGenerator } from '../fixtures/mockData.js';

test.describe('Bang Command Demo', () => {
    test('should demonstrate bang command execution and output', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // 1. Show a running command
        await injector.updateMessages([
            MockDataGenerator.createBangMessage('sleep 5', '', true, null)
        ]);
        await webviewPage.screenshot({ path: 'docs/public/screenshots/bang-command-running.png' });

        // 2. Show a successful command with output
        await injector.updateMessages([
            MockDataGenerator.createBangMessage('ls -la', 'total 8\ndrwxr-xr-x  10 user  group  320 Mar 30 10:00 .\ndrwxr-xr-x   4 user  group  128 Mar 30 09:00 ..\n-rw-r--r--   1 user  group  1024 Mar 30 10:00 package.json', false, 0)
        ]);
        await webviewPage.screenshot({ path: 'docs/public/screenshots/bang-command-success.png' });

        // 3. Show a long output
        const longOutput = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
        await injector.updateMessages([
            MockDataGenerator.createBangMessage('seq 1 20', longOutput, false, 0)
        ]);
        await webviewPage.screenshot({ path: 'docs/public/screenshots/bang-command-long-output.png' });

        // 4. Show a successful command with no output
        await injector.updateMessages([
            MockDataGenerator.createBangMessage('mkdir test-dir', '', false, 0)
        ]);
        await webviewPage.screenshot({ path: 'docs/public/screenshots/bang-command-no-output.png' });

        // 5. Show a failed command
        await injector.updateMessages([
            MockDataGenerator.createBangMessage('nonexistent', 'sh: nonexistent: command not found', false, 127)
        ]);
        await webviewPage.screenshot({ path: 'docs/public/screenshots/bang-command-failure.png' });
    });
});

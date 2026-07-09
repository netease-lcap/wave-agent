import { test } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { MockDataGenerator } from '../fixtures/mockData.js';

test.describe('Bang Command Demo', () => {
    test('should demonstrate bang command execution and output', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // 1. Show a running command
        await injector.updateMessages([
            MockDataGenerator.createBangMessage('docker build -t nebula-payment .', '', true, null)
        ]);
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/bang-command-running.png' });

        // 2. Show a successful command with output
        await injector.updateMessages([
            MockDataGenerator.createBangMessage('kubectl get pods -n payment', 'NAME                            READY   STATUS    RESTARTS   AGE\npayment-service-7f4d           1/1     Running   0          2d\npayment-worker-9c2a            1/1     Running   0          2d\npayment-scheduler-5x8b         1/1     Running   0          5h', false, 0)
        ]);
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/bang-command-success.png' });

        // 3. Show a long output
        const longOutput = Array.from({ length: 20 }, (_, i) => `Test suite ${i + 1} passed`).join('\n');
        await injector.updateMessages([
            MockDataGenerator.createBangMessage('pnpm test', longOutput, false, 0)
        ]);
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/bang-command-long-output.png' });

        // 4. Show a successful command with no output
        await injector.updateMessages([
            MockDataGenerator.createBangMessage('git tag v1.2.0', '', false, 0)
        ]);
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/bang-command-no-output.png' });

        // 5. Show a failed command
        await injector.updateMessages([
            MockDataGenerator.createBangMessage('docker push registry.nebula-tech.com/payment', 'denied: access forbidden to repository payment', false, 1)
        ]);
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/bang-command-failure.png' });
    });
});

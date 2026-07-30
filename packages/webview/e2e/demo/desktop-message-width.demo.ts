import { test, expect } from '../utils/desktopTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { MockDataGenerator } from '../fixtures/mockData.js';

const WORKDIR = '/Users/dev/projects/wave-agent';

const initialState = {
    messages: [],
    isStreaming: false,
    sessions: [],
    isAuthenticated: true,
    configurationData: {
        baseURL: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-4-20250514',
        fastModel: 'claude-haiku-4-20250514'
    },
    permissionMode: 'default'
};

// Demonstrates that the conversation column is capped at 800px and centered,
// lining up with the input box — instead of messages spanning the full pane
// width on a wide window. A wide viewport makes the side gutters obvious.
test.describe('Desktop message column width', () => {
    test('messages are centered and aligned with the input', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Wide window so the 800px cap leaves visible gutters on both sides.
        await webviewPage.setViewportSize({ width: 1280, height: 800 });

        await injector.simulateExtensionMessage('setInitialState', initialState);
        await injector.simulateExtensionMessage('desktopWorkdirState', {
            workdir: WORKDIR,
            recentWorkdirs: [WORKDIR]
        });

        // Wait for the desktop layout to mount ChatApp and attach its message
        // listener before pushing messages — otherwise updateMessages lands in
        // the gap before workdirState triggers the mount and is dropped.
        await expect(webviewPage.getByTestId('desktop-workdir')).toBeVisible();

        await injector.updateMessages([
            MockDataGenerator.createUserMessage(
                '帮我把消息列表加一个最大宽度并居中，跟输入框保持一致，否则消息太宽不好看。',
                'msg-u1'
            ),
            MockDataGenerator.createAssistantMessage(
                '好的，我给 .messages-container 加了 max-width: 800px 和 margin: 0 auto，与 .input-wrapper 的约束方式一致。这样消息内容会居中显示在 800px 的列里，两侧留出与输入框对齐的留白，窗口越宽效果越明显。',
                'msg-a1'
            )
        ]);

        await expect(webviewPage.locator('.message.user')).toBeVisible();
        await expect(webviewPage.locator('.message.assistant')).toBeVisible();

        // The conversation column is capped (narrower than the chat area) and
        // centered, and its content edges line up with the input box. Content
        // edge = container edge + 10px padding (content-box), matching the
        // input-wrapper's own 800px column.
        const geom = await webviewPage.evaluate(() => {
            const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
            const cs = (sel: string) => getComputedStyle(document.querySelector(sel)!).backgroundColor;
            const msg = r('.messages-container');
            const input = r('.input-wrapper');
            const main = r('.desktop-chat-main');
            return {
                msgCapped: msg.width < main.width,
                centered: Math.abs((msg.left - main.left) - (main.right - msg.right)) < 1,
                contentAlignsInput: Math.abs((msg.left + 10) - input.left) < 1 && Math.abs((msg.right - 10) - input.right) < 1,
                // The gutter (chat-area background showing through the transparent
                // wrappers around the message column) must match the message list's
                // own background, not the host's editor-background body.
                gutterBg: cs('.chat-container'),
                msgBg: cs('.messages-container'),
            };
        });
        expect(geom.msgCapped).toBeTruthy();
        expect(geom.centered).toBeTruthy();
        expect(geom.contentAlignsInput).toBeTruthy();
        expect(geom.gutterBg).toBe(geom.msgBg);

        await webviewPage.screenshot({ path: '../../docs/public/screenshots/desktop-chat-centered.png' });
    });
});

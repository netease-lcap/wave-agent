import { test, expect } from '../utils/desktopTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { MockDataGenerator } from '../fixtures/mockData.js';

const DIR_A = '/Users/dev/projects/wave-agent';
const DIR_B = '/Users/dev/projects/shop-server';
const DIR_C = '/Users/dev/projects/notes-app';

const session = (id: string, workdir: string, firstMessage: string, lastActiveAt: string) => ({
    id,
    sessionType: 'main',
    workdir,
    createdAt: lastActiveAt,
    lastActiveAt,
    latestTotalTokens: 12000,
    firstMessage
});

const treeSession = (sessionId: string, title: string, lastActiveAt: string) => ({
    sessionId,
    title,
    lastActiveAt: new Date(lastActiveAt).getTime(),
    hasWorktree: false
});

const treeGroups = [
    {
        workdir: DIR_A,
        sessions: [
            treeSession('sess-a1', '帮我修复登录页的样式问题', '2026-07-27T10:12:00Z'),
            treeSession('sess-a2', '给 bashTool 增加超时参数', '2026-07-26T09:40:00Z'),
            treeSession('sess-a3', '解释一下 listSessions 的实现', '2026-07-25T15:02:00Z')
        ]
    },
    {
        workdir: DIR_B,
        sessions: [
            treeSession('sess-b1', '订单接口偶发 500 排查', '2026-07-27T08:30:00Z'),
            treeSession('sess-b2', '给购物车加单元测试', '2026-07-24T11:20:00Z')
        ]
    },
    {
        workdir: DIR_C,
        sessions: [
            treeSession('sess-c1', '支持 Markdown 导出', '2026-07-23T14:00:00Z')
        ]
    }
];

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

test.describe('Desktop App Screenshots', () => {
    test('capture desktop-specific features', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        await webviewPage.setViewportSize({ width: 960, height: 640 });

        // ── 1. First launch: no workdir selected ─────────────────────
        // Sidebar renders with collapsed recent-directory groups; the input
        // area (including +/slash/permission/send buttons) is disabled until
        // the user picks a directory.
        await injector.simulateExtensionMessage('setInitialState', initialState);
        await injector.simulateExtensionMessage('desktopWorkdirState', {
            recentWorkdirs: [DIR_A, DIR_B, DIR_C]
        });
        await injector.simulateExtensionMessage('desktopSessionTree', { groups: treeGroups });

        await expect(webviewPage.getByTestId('desktop-sidebar')).toBeVisible();
        await expect(webviewPage.getByTestId('desktop-workdir')).toContainText('选择工作目录');
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/desktop-first-launch.png' });

        // ── 2. Session tree: workdir selected, current group expanded ─
        // The current directory's group is expanded by default; the active
        // session shows a running dot while streaming.
        await injector.simulateExtensionMessage('desktopWorkdirState', {
            workdir: DIR_A,
            recentWorkdirs: [DIR_A, DIR_B, DIR_C]
        });
        await injector.simulateExtensionMessage('setInitialState', {
            ...initialState,
            session: session('sess-a1', DIR_A, '帮我修复登录页的样式问题', '2026-07-27T10:12:00Z')
        });
        await injector.simulateExtensionMessage('startStreaming');

        await expect(webviewPage.getByTestId('desktop-session-item-sess-a1')).toBeVisible();
        await expect(webviewPage.locator('.desktop-session-dot--running')).toBeVisible();
        // Other groups stay collapsed by default
        await expect(webviewPage.getByTestId('desktop-session-item-sess-b1')).toBeHidden();
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/desktop-session-tree.png' });

        // Expand a second group to show collapse/expand interactivity
        await webviewPage.getByText('shop-server').click();
        await expect(webviewPage.getByTestId('desktop-session-item-sess-b1')).toBeVisible();
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/desktop-session-tree-expanded.png' });

        // ── 3. Workdir dropdown in the input area ─────────────────────
        await injector.simulateExtensionMessage('endStreaming');
        await webviewPage.getByTestId('desktop-workdir').click();
        await expect(webviewPage.getByTestId('desktop-workdir-menu')).toBeVisible();
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/desktop-workdir-dropdown.png' });
        await webviewPage.keyboard.press('Escape');

        // ── 4. Core chat interaction (same as IDE plugins) ────────────
        await injector.updateMessages([
            MockDataGenerator.createUserMessage('帮我修复登录页的样式问题', 'msg-u1'),
            MockDataGenerator.createAssistantMessage(
                '我先看一下登录页组件的样式文件，找出对齐问题的原因。',
                'msg-a1'
            )
        ]);
        // Note: the workdir selector in the input only renders for a fresh
        // session (no messages yet) — by design (ChatApp.tsx).
        await expect(webviewPage.locator('.message.user')).toBeVisible();
        await expect(webviewPage.locator('.message.assistant')).toBeVisible();
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/desktop-chat.png' });
    });
});

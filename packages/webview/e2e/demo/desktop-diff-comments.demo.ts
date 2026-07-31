import { test, expect } from '../utils/desktopTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { MockDataGenerator } from '../fixtures/mockData.js';

/**
 * Desktop workspace-diff pane + inline line-comment screenshots.
 *
 * Mirrors the real DiffPane → MessageInput path: the pane mounts and requests
 * `desktopGetWorkspaceDiff`; the test injects a mock `desktopWorkspaceDiff`
 * response, then exercises the GitHub/GitLab-style "+" comment button on a
 * diff line. Submitting the comment box appends a formatted diff comment to the
 * chat input (via the real ChatApp handleAddComment handler) — nothing is sent
 * to the agent, so several comments can be batched.
 */
const DIR_A = '/Users/dev/projects/wave-agent';

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

/** Professional mock diff: a login form refactor + auth endpoint rename. */
const DIFF_FILES = [
    {
        path: 'src/components/LoginForm.tsx',
        status: 'modified',
        additions: 4,
        deletions: 2,
        truncated: false,
        binary: false,
        hunks: [
            '@@ -12,7 +12,9 @@ export function LoginForm() {',
            '   const [email, setEmail] = useState("");',
            '   const [password, setPassword] = useState("");',
            '-  const handleSubmit = (e) => {',
            '-    e.preventDefault();',
            '+  const handleSubmit = (e: React.FormEvent) => {',
            '+    e.preventDefault();',
            '+    if (!email || !password) return;',
            '+    setLoading(true);',
            '     api.login(email, password);',
            '   };'
        ].join('\n')
    },
    {
        path: 'src/hooks/useAuth.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        truncated: false,
        binary: false,
        hunks: [
            '@@ -5,6 +5,6 @@ export function useAuth() {',
            '   const [user, setUser] = useState(null);',
            '   const login = async (email, password) => {',
            '     try {',
            '-      const res = await api.post("/login", { email, password });',
            '+      const res = await api.post("/auth/login", { email, password });',
            '       setUser(res.data);',
            '       return res.data;'
        ].join('\n')
    }
];

test.describe('Desktop Diff Pane Screenshots', () => {
    test('capture workspace diff pane + line comments', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        await webviewPage.setViewportSize({ width: 1100, height: 680 });

        await injector.simulateExtensionMessage('setInitialState', initialState);
        await injector.simulateExtensionMessage('desktopWorkdirState', {
            workdir: DIR_A,
            recentWorkdirs: [DIR_A]
        });
        await webviewPage.waitForSelector('[data-testid="chat-container"]', { timeout: 5000 });

        await injector.updateMessages([
            MockDataGenerator.createUserMessage('帮我重构登录模块，加上表单校验和 loading 状态', 'msg-u1'),
            MockDataGenerator.createAssistantMessage(
                '我重构了 `LoginForm` 的提交逻辑，给事件加了类型注解、空值校验和 loading 开关；同时把 `useAuth` 的登录端点从 `/login` 改到 `/auth/login` 与后端对齐。看一下差异面板的改动。',
                'msg-a1'
            )
        ]);

        // ── 1. Open the diff pane via the header panel toggle ─────────
        await webviewPage.getByTestId('panel-toggle-btn').click();
        await expect(webviewPage.getByTestId('panel-toggle-menu')).toBeVisible();
        await webviewPage.getByTestId('panel-toggle-item-diff').click();
        await webviewPage.keyboard.press('Escape'); // close the multi-select menu
        await expect(webviewPage.getByTestId('diff-pane')).toBeVisible();

        // DiffPane just requested desktopGetWorkspaceDiff; inject the response.
        await injector.simulateExtensionMessage('desktopWorkspaceDiff', {
            result: { kind: 'ok', files: DIFF_FILES }
        });
        await expect(webviewPage.getByText('LoginForm.tsx')).toBeVisible();
        await expect(webviewPage.getByText('useAuth.ts')).toBeVisible();
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/desktop-diff-pane.png' });

        // ── 2. Click the "+" comment button on an added line ──────────
        // Line index 5 = `+  const handleSubmit = (e: React.FormEvent) => {`.
        // The button is hidden until hover (GitHub/GitLab style); Playwright
        // auto-hovers before click. Use the aria-label (file path + line) as
        // the unique key — the testid uses a per-file line index, so it isn't
        // unique across files.
        await webviewPage
            .getByRole('button', { name: '评论 src/components/LoginForm.tsx 第 6 行' })
            .click();
        await expect(webviewPage.getByTestId('diff-comment-box')).toBeVisible();
        await webviewPage.getByTestId('diff-comment-input').fill('表单提交前先做空值校验，空字段直接返回');
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/desktop-diff-comment.png' });

        // ── 3. Submit appends the comment to the chat input ──────────
        await webviewPage.getByTestId('diff-comment-submit').click();
        await expect(webviewPage.getByTestId('message-input')).toContainText('表单提交前先做空值校验');
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/desktop-diff-comment-input.png' });
    });
});

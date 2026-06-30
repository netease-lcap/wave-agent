import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { UIStateVerifier } from '../utils/uiStateVerifier.js';

test.describe('Tooltip Functionality', () => {
    test('should show tooltip on hover for Send button', async ({ webviewPage }) => {
        const ui = new UIStateVerifier(webviewPage);
        
        // Hover over send button
        await ui.sendButton.hover();
        
        // Verify tooltip is visible and has correct text
        const tooltip = webviewPage.locator('[role="tooltip"].visible');
        await expect(tooltip).toBeVisible();
        await expect(tooltip).toHaveText('发送');
        
        // Move mouse away
        await webviewPage.mouse.move(0, 0);
        await expect(tooltip).not.toBeVisible();
    });

    test('should show correct tooltip for Send button during streaming', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);
        
        // Start streaming
        await injector.startStreaming();
        
        // Hover over send button (which should now be "Join Queue")
        await ui.sendButton.hover();
        
        const tooltip = webviewPage.locator('[role="tooltip"].visible');
        await expect(tooltip).toBeVisible();
        await expect(tooltip).toHaveText('加入队列');
    });

    test('should show tooltip for Abort button during streaming', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);
        
        // Start streaming
        await injector.startStreaming();
        
        // Hover over abort button
        await ui.abortButton.hover();
        
        const tooltip = webviewPage.locator('[role="tooltip"].visible');
        await expect(tooltip).toBeVisible();
        await expect(tooltip).toHaveText('停止');
    });

    test('should show tooltip for Clear Chat button', async ({ webviewPage }) => {
        const ui = new UIStateVerifier(webviewPage);
        
        // Hover over clear chat button
        await ui.clearChatButton.hover();
        
        const tooltip = webviewPage.locator('[role="tooltip"].visible');
        await expect(tooltip).toBeVisible();
        await expect(tooltip).toHaveText('清除聊天');
    });

    test('should show tooltip for Permission Mode select', async ({ webviewPage }) => {
        const permissionSelect = webviewPage.locator('.permission-mode-select');
        
        // Hover over permission select
        await permissionSelect.hover();
        
        const tooltip = webviewPage.locator('[role="tooltip"].visible');
        await expect(tooltip).toBeVisible();
        await expect(tooltip).toHaveText('权限模式');
    });
});

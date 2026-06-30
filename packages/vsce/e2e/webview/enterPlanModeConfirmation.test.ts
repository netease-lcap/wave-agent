import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { ENTER_PLAN_MODE_TOOL_NAME } from 'wave-agent-sdk';

test.describe('EnterPlanMode Confirmation Dialog', () => {
    test('should show EnterPlanMode confirmation with correct buttons', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_enter_plan_mode',
            toolName: ENTER_PLAN_MODE_TOOL_NAME,
            confirmationType: '计划待确认',
            toolInput: {},
            hidePersistentOption: true
        });

        // Verify title
        await expect(webviewPage.locator('.confirmation-title')).toHaveText('计划待确认');

        // Verify "批准并继续" button exists
        const applyBtn = webviewPage.locator('.confirmation-btn-apply');
        await expect(applyBtn).toBeVisible();
        await expect(applyBtn).toHaveText('批准并继续');

        // Verify "不，现在开始实现" button exists
        const rejectBtn = webviewPage.locator('.confirmation-btn-reject');
        await expect(rejectBtn).toBeVisible();
        await expect(rejectBtn).toHaveText('不，现在开始实现');
    });

    test('should NOT show "批准并自动接受后续修改" button for EnterPlanMode', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_enter_plan_mode',
            toolName: ENTER_PLAN_MODE_TOOL_NAME,
            confirmationType: '计划待确认',
            toolInput: {},
            hidePersistentOption: true
        });

        // Verify auto-confirm button does NOT exist
        const autoBtn = webviewPage.locator('.confirmation-btn-auto');
        await expect(autoBtn).toHaveCount(0);
    });

    test('should NOT show "提供反馈" button for EnterPlanMode', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_enter_plan_mode',
            toolName: ENTER_PLAN_MODE_TOOL_NAME,
            confirmationType: '计划待确认',
            toolInput: {},
            hidePersistentOption: true
        });

        // Verify feedback button does NOT exist
        const feedbackBtn = webviewPage.locator('.confirmation-btn-feedback');
        await expect(feedbackBtn).toHaveCount(0);
    });

    test('should send plan mode permission on approve', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Clear message log before starting
        await injector.clearMessageLog();

        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_enter_plan_mode',
            toolName: ENTER_PLAN_MODE_TOOL_NAME,
            confirmationType: '计划待确认',
            toolInput: {},
            hidePersistentOption: true
        });

        // Click "批准并继续"
        await webviewPage.locator('.confirmation-btn-apply').click();

        // Verify confirmation dialog is hidden
        await expect(webviewPage.locator('.confirmation-dialog')).not.toBeVisible();

        // Verify the message was sent with correct decision
        const sentMessages = await injector.getMessagesSentToExtension();
        expect(sentMessages).toHaveLength(1);
        expect(sentMessages[0]).toEqual({
            command: 'confirmationResponse',
            confirmationId: 'test_enter_plan_mode',
            approved: true,
            decision: {
                behavior: 'allow',
                newPermissionMode: 'plan'
            }
        });
    });

    test('should send deny message with correct text on reject button click', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Clear message log before starting
        await injector.clearMessageLog();

        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_enter_plan_mode',
            toolName: ENTER_PLAN_MODE_TOOL_NAME,
            confirmationType: '计划待确认',
            toolInput: {},
            hidePersistentOption: true
        });

        // Click "不，现在开始实现"
        await webviewPage.locator('.confirmation-btn-reject').click();

        // Verify confirmation dialog is hidden
        await expect(webviewPage.locator('.confirmation-dialog')).not.toBeVisible();

        // Verify the message was sent with correct decision
        const sentMessages = await injector.getMessagesSentToExtension();
        expect(sentMessages).toHaveLength(1);
        expect(sentMessages[0]).toEqual({
            command: 'confirmationResponse',
            confirmationId: 'test_enter_plan_mode',
            approved: true,
            decision: {
                behavior: 'deny',
                message: '不，现在开始实现'
            }
        });
    });

    test('should send deny message on Escape key', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Clear message log before starting
        await injector.clearMessageLog();

        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_enter_plan_mode',
            toolName: ENTER_PLAN_MODE_TOOL_NAME,
            confirmationType: '计划待确认',
            toolInput: {},
            hidePersistentOption: true
        });

        // Wait for dialog to be visible, then press Escape
        await expect(webviewPage.locator('.confirmation-dialog')).toBeVisible();
        await webviewPage.keyboard.press('Escape');

        // Verify confirmation dialog is hidden
        await expect(webviewPage.locator('.confirmation-dialog')).not.toBeVisible();

        // Verify the message was sent with correct decision
        const sentMessages = await injector.getMessagesSentToExtension();
        expect(sentMessages).toHaveLength(1);
        expect(sentMessages[0]).toEqual({
            command: 'confirmationResponse',
            confirmationId: 'test_enter_plan_mode',
            approved: true,
            decision: {
                behavior: 'deny',
                message: '不，现在开始实现'
            }
        });
    });

    test('should NOT show plan content preview for EnterPlanMode', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_enter_plan_mode',
            toolName: ENTER_PLAN_MODE_TOOL_NAME,
            confirmationType: '计划待确认',
            toolInput: {},
            planContent: 'Some plan content that should NOT be shown',
            hidePersistentOption: true
        });

        // Verify plan content is NOT shown for EnterPlanMode
        const planContent = webviewPage.locator('.plan-content-preview');
        await expect(planContent).toHaveCount(0);
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, fireEvent, act, sendCommand } from './test-utils';
import { ENTER_PLAN_MODE_TOOL_NAME } from 'wave-agent-sdk';

describe('EnterPlanMode Confirmation Dialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should show EnterPlanMode confirmation with correct buttons', async () => {
        renderChatApp();

        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'test_enter_plan_mode',
                toolName: ENTER_PLAN_MODE_TOOL_NAME,
                confirmationType: '计划待确认',
                toolInput: {},
                hidePersistentOption: true
            });
        });

        // Verify title
        expect(document.querySelector('.confirmation-title')).toHaveTextContent('计划待确认');

        // Verify "批准并继续" button exists
        const applyBtn = document.querySelector('.confirmation-btn-apply');
        expect(applyBtn).toBeInTheDocument();
        expect(applyBtn).toHaveTextContent('批准并继续');

        // Verify "不，现在开始实现" button exists
        const rejectBtn = document.querySelector('.confirmation-btn-reject');
        expect(rejectBtn).toBeInTheDocument();
        expect(rejectBtn).toHaveTextContent('不，现在开始实现');
    });

    it('should NOT show "批准并自动接受后续修改" button for EnterPlanMode', async () => {
        renderChatApp();

        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'test_enter_plan_mode',
                toolName: ENTER_PLAN_MODE_TOOL_NAME,
                confirmationType: '计划待确认',
                toolInput: {},
                hidePersistentOption: true
            });
        });

        // Verify auto-confirm button does NOT exist
        expect(document.querySelector('.confirmation-btn-auto')).not.toBeInTheDocument();
    });

    it('should NOT show "提供反馈" button for EnterPlanMode', async () => {
        renderChatApp();

        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'test_enter_plan_mode',
                toolName: ENTER_PLAN_MODE_TOOL_NAME,
                confirmationType: '计划待确认',
                toolInput: {},
                hidePersistentOption: true
            });
        });

        // Verify feedback button does NOT exist
        expect(document.querySelector('.confirmation-btn-feedback')).not.toBeInTheDocument();
    });

    it('should send plan mode permission on approve', async () => {
        const { vscode } = renderChatApp();
        vscode.postMessage.mockClear();

        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'test_enter_plan_mode',
                toolName: ENTER_PLAN_MODE_TOOL_NAME,
                confirmationType: '计划待确认',
                toolInput: {},
                hidePersistentOption: true
            });
        });

        // Click "批准并继续"
        await act(async () => {
            fireEvent.click(document.querySelector('.confirmation-btn-apply') as HTMLElement);
        });

        // Verify confirmation dialog is hidden
        expect(document.querySelector('.confirmation-dialog')).not.toBeInTheDocument();

        // Verify the message was sent with correct decision
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
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

    it('should send deny message with correct text on reject button click', async () => {
        const { vscode } = renderChatApp();
        vscode.postMessage.mockClear();

        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'test_enter_plan_mode',
                toolName: ENTER_PLAN_MODE_TOOL_NAME,
                confirmationType: '计划待确认',
                toolInput: {},
                hidePersistentOption: true
            });
        });

        // Click "不，现在开始实现"
        await act(async () => {
            fireEvent.click(document.querySelector('.confirmation-btn-reject') as HTMLElement);
        });

        // Verify confirmation dialog is hidden
        expect(document.querySelector('.confirmation-dialog')).not.toBeInTheDocument();

        // Verify the message was sent with correct decision
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
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

    it('should send deny message on Escape key', async () => {
        const { vscode } = renderChatApp();
        vscode.postMessage.mockClear();

        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'test_enter_plan_mode',
                toolName: ENTER_PLAN_MODE_TOOL_NAME,
                confirmationType: '计划待确认',
                toolInput: {},
                hidePersistentOption: true
            });
        });

        // Wait for dialog to be visible, then press Escape
        expect(document.querySelector('.confirmation-dialog')).toBeInTheDocument();
        await act(async () => {
            fireEvent.keyDown(document.querySelector('.confirmation-dialog') || document.body, { key: 'Escape' });
        });

        // Verify confirmation dialog is hidden
        expect(document.querySelector('.confirmation-dialog')).not.toBeInTheDocument();

        // Verify the message was sent with correct decision
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
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

    it('should NOT show plan content preview for EnterPlanMode', async () => {
        renderChatApp();

        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'test_enter_plan_mode',
                toolName: ENTER_PLAN_MODE_TOOL_NAME,
                confirmationType: '计划待确认',
                toolInput: {},
                planContent: 'Some plan content that should NOT be shown',
                hidePersistentOption: true
            });
        });

        // Verify plan content is NOT shown for EnterPlanMode
        expect(document.querySelector('.plan-content-preview')).not.toBeInTheDocument();
    });
});

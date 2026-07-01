import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, screen, fireEvent, act, sendCommand } from './test-utils';
import { EDIT_TOOL_NAME, BASH_TOOL_NAME, WRITE_TOOL_NAME, EXIT_PLAN_MODE_TOOL_NAME } from 'wave-agent-sdk';

describe('Confirmation Dialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should show confirmation dialog for ExitPlanMode with planContent', async () => {
        renderChatApp();

        const planContent = '## Test Plan\n- Step 1\n- Step 2';

        // Simulate a confirmation request for ExitPlanMode tool
        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'test_plan_confirmation',
                toolName: EXIT_PLAN_MODE_TOOL_NAME,
                confirmationType: '计划待确认',
                planContent: planContent
            });
        });

        // Verify confirmation dialog is visible
        const confirmationDialog = document.querySelector('.confirmation-dialog');
        expect(confirmationDialog).toBeInTheDocument();

        // Verify plan content is rendered
        const planPreview = document.querySelector('.plan-content-preview');
        expect(planPreview).toBeInTheDocument();
        const h2 = planPreview!.querySelector('h2');
        expect(h2).toHaveTextContent('Test Plan');
        const lis = planPreview!.querySelectorAll('li');
        expect(lis).toHaveLength(2);

        // Verify buttons
        const applyBtn = document.querySelector('.confirmation-btn-apply');
        expect(applyBtn).toHaveTextContent('批准并继续');
        const autoBtn = document.querySelector('.confirmation-btn-auto');
        expect(autoBtn).toHaveTextContent('批准并自动接受后续修改');
    });

    it('should show confirmation dialog for code modification tools', async () => {
        renderChatApp();

        // Simulate a confirmation request for Edit tool
        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'test_confirmation_123',
                toolName: EDIT_TOOL_NAME,
                confirmationType: '代码修改待确认',
                toolInput: { file_path: 'test.ts', old_string: 'old', new_string: 'new' }
            });
        });

        // Verify confirmation dialog is visible
        const confirmationDialog = document.querySelector('.confirmation-dialog');
        expect(confirmationDialog).toBeInTheDocument();

        // Verify dialog content
        const title = document.querySelector('.confirmation-title');
        expect(title).toHaveTextContent('代码修改待确认');
        const details = document.querySelector('.confirmation-details');
        expect(details).toHaveTextContent(`工具: ${EDIT_TOOL_NAME}`);

        // Verify buttons are present
        const applyBtn = document.querySelector('.confirmation-btn-apply');
        expect(applyBtn).toHaveTextContent('批准并继续');
        const feedbackBtn = document.querySelector('.confirmation-btn-feedback');
        expect(feedbackBtn).toHaveTextContent('提供反馈');
        // reject button is only shown for EnterPlanMode and feedback cancel — not for Edit tool initially
        const rejectBtns = document.querySelectorAll('.confirmation-btn-reject');
        expect(rejectBtns.length).toBe(0);

        // Verify input is hidden when confirmation is showing (display:none, not removed from DOM)
        expect(screen.queryByTestId('message-input')).not.toBeVisible();
    });

    it('should show confirmation dialog for command execution tools', async () => {
        renderChatApp();

        // Simulate a confirmation request for Bash tool
        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'test_confirmation_456',
                toolName: BASH_TOOL_NAME,
                confirmationType: '命令执行待确认',
                toolInput: { command: 'rm -rf temp/' }
            });
        });

        // Verify confirmation dialog content for bash command
        const title = document.querySelector('.confirmation-title');
        expect(title).toHaveTextContent('命令执行待确认');
        const details = document.querySelector('.confirmation-details');
        expect(details).toHaveTextContent(`工具: ${BASH_TOOL_NAME}`);
    });

    it('should send approval response when clicking apply button', async () => {
        const { vscode } = renderChatApp();
        vscode.postMessage.mockClear();

        // Simulate confirmation request
        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'test_confirmation_789',
                toolName: WRITE_TOOL_NAME,
                confirmationType: '代码修改待确认',
                toolInput: { file_path: 'new_file.ts', content: 'console.log("hello");' }
            });
        });

        // Click apply button
        await act(async () => {
            fireEvent.click(document.querySelector('.confirmation-btn-apply') as HTMLElement);
        });

        // Verify confirmation dialog is hidden
        expect(document.querySelector('.confirmation-dialog')).not.toBeInTheDocument();

        // Verify input is visible again
        expect(screen.getByTestId('message-input')).toBeVisible();

        // Verify approval message was sent to extension
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        expect(sentMessages).toHaveLength(1);
        expect(sentMessages[0]).toEqual({
            command: 'confirmationResponse',
            confirmationId: 'test_confirmation_789',
            approved: true,
            decision: {
                behavior: 'allow',
                newPermissionMode: undefined
            }
        });
    });

    it('should send rejection response when clicking close button', async () => {
        const { vscode } = renderChatApp();
        vscode.postMessage.mockClear();

        // Simulate confirmation request
        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'test_confirmation_reject',
                toolName: 'SomeOtherTool',
                confirmationType: '操作待确认',
                toolInput: {}
            });
        });

        // Click close button
        await act(async () => {
            fireEvent.click(document.querySelector('.confirmation-close-btn') as HTMLElement);
        });

        // Verify confirmation dialog is hidden
        expect(document.querySelector('.confirmation-dialog')).not.toBeInTheDocument();

        // Verify input is visible again
        expect(screen.getByTestId('message-input')).toBeVisible();

        // Verify rejection message was sent to extension
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        expect(sentMessages).toHaveLength(1);
        expect(sentMessages[0]).toEqual({
            command: 'confirmationResponse',
            confirmationId: 'test_confirmation_reject',
            approved: false
        });
    });

    it('should handle multiple confirmation requests sequentially', async () => {
        const { vscode } = renderChatApp();
        vscode.postMessage.mockClear();

        // First confirmation request
        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'confirmation_1',
                toolName: EDIT_TOOL_NAME,
                confirmationType: '代码修改待确认',
                toolInput: { file_path: 'file1.ts' }
            });
        });

        // Verify first confirmation is visible
        expect(document.querySelector('.confirmation-dialog')).toBeInTheDocument();
        expect(document.querySelector('.confirmation-details')).toHaveTextContent(`工具: ${EDIT_TOOL_NAME}`);

        // Approve first confirmation
        await act(async () => {
            fireEvent.click(document.querySelector('.confirmation-btn-apply') as HTMLElement);
        });

        // Verify dialog is hidden
        expect(document.querySelector('.confirmation-dialog')).not.toBeInTheDocument();

        // Second confirmation request
        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'confirmation_2',
                toolName: 'SomeOtherTool',
                confirmationType: '操作待确认',
                toolInput: {}
            });
        });

        // Verify second confirmation is visible with correct content
        expect(document.querySelector('.confirmation-dialog')).toBeInTheDocument();
        expect(document.querySelector('.confirmation-details')).toHaveTextContent('工具: SomeOtherTool');

        // Reject second confirmation via Esc key
        await act(async () => {
            fireEvent.keyDown(document.querySelector('.confirmation-dialog') || document.body, { key: 'Escape' });
        });

        // Verify both responses were sent
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        expect(sentMessages).toHaveLength(2);
        expect(sentMessages[0]).toEqual({
            command: 'confirmationResponse',
            confirmationId: 'confirmation_1',
            approved: true,
            decision: {
                behavior: 'allow',
                newPermissionMode: undefined
            }
        });
        expect(sentMessages[1]).toEqual({
            command: 'confirmationResponse',
            confirmationId: 'confirmation_2',
            approved: false
        });
    });

    it('should handle multiple simultaneous confirmation requests in a queue', async () => {
        const { vscode } = renderChatApp();
        vscode.postMessage.mockClear();

        // Send first confirmation request
        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'conf_1',
                toolName: EDIT_TOOL_NAME,
                confirmationType: '代码修改待确认',
                toolInput: { file_path: 'file1.ts' }
            });
        });

        // Verify first confirmation is visible
        expect(document.querySelector('.confirmation-dialog')).toBeInTheDocument();
        expect(document.querySelector('.confirmation-details')).toHaveTextContent(`工具: ${EDIT_TOOL_NAME}`);

        // Send second confirmation request while first is still showing
        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'conf_2',
                toolName: BASH_TOOL_NAME,
                confirmationType: '命令执行待确认',
                toolInput: { command: 'ls' }
            });
        });

        // Still should show first confirmation
        expect(document.querySelector('.confirmation-details')).toHaveTextContent(`工具: ${EDIT_TOOL_NAME}`);

        // Approve first confirmation
        await act(async () => {
            fireEvent.click(document.querySelector('.confirmation-btn-apply') as HTMLElement);
        });

        // Verify second confirmation is now visible
        expect(document.querySelector('.confirmation-dialog')).toBeInTheDocument();
        expect(document.querySelector('.confirmation-details')).toHaveTextContent(`工具: ${BASH_TOOL_NAME}`);

        // Approve second confirmation
        await act(async () => {
            fireEvent.click(document.querySelector('.confirmation-btn-apply') as HTMLElement);
        });

        // Verify dialog is hidden and input is visible
        expect(document.querySelector('.confirmation-dialog')).not.toBeInTheDocument();
        expect(screen.getByTestId('message-input')).toBeVisible();

        // Verify both responses were sent
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        expect(sentMessages).toHaveLength(2);
        expect(sentMessages[0]).toEqual({
            command: 'confirmationResponse',
            confirmationId: 'conf_1',
            approved: true,
            decision: {
                behavior: 'allow',
                newPermissionMode: undefined
            }
        });
        expect(sentMessages[1]).toEqual({
            command: 'confirmationResponse',
            confirmationId: 'conf_2',
            approved: true,
            decision: {
                behavior: 'allow',
                newPermissionMode: undefined
            }
        });
    });

    it('should handle confirmation for different tool types correctly', async () => {
        renderChatApp();

        const toolTests = [
            { toolName: EDIT_TOOL_NAME, expectedType: '代码修改待确认' },
            { toolName: WRITE_TOOL_NAME, expectedType: '代码修改待确认' },
            { toolName: BASH_TOOL_NAME, expectedType: '命令执行待确认' },
            { toolName: 'SomeOtherTool', expectedType: '操作待确认' }
        ];

        for (const { toolName, expectedType } of toolTests) {
            // Show confirmation
            await act(async () => {
                sendCommand('showConfirmation', {
                    confirmationId: `test_${toolName}`,
                    toolName: toolName,
                    confirmationType: expectedType,
                    toolInput: {}
                });
            });

            // Verify correct confirmation type
            expect(document.querySelector('.confirmation-title')).toHaveTextContent(expectedType);
            expect(document.querySelector('.confirmation-details')).toHaveTextContent('工具: ');

            // Dismiss the dialog
            await act(async () => {
                fireEvent.click(document.querySelector('.confirmation-btn-apply') as HTMLElement);
            });
            expect(document.querySelector('.confirmation-dialog')).not.toBeInTheDocument();
        }
    });

    it('should prevent user interaction with input while confirmation is shown', async () => {
        renderChatApp();

        // Verify input is initially visible
        expect(screen.getByTestId('message-input')).toBeVisible();

        // Show confirmation
        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'test_input_hidden',
                toolName: EDIT_TOOL_NAME,
                confirmationType: '代码修改待确认',
                toolInput: {}
            });
        });

        // Verify input is hidden (display:none wrapper, not removed from DOM)
        expect(screen.queryByTestId('message-input')).not.toBeVisible();

        // Verify confirmation dialog is visible
        expect(document.querySelector('.confirmation-dialog')).toBeInTheDocument();

        // Approve confirmation
        await act(async () => {
            fireEvent.click(document.querySelector('.confirmation-btn-apply') as HTMLElement);
        });

        // Verify input becomes visible again
        expect(screen.getByTestId('message-input')).toBeVisible();
        expect(document.querySelector('.confirmation-dialog')).not.toBeInTheDocument();
    });

    it('should show auto-confirm button for MCP tools with correct text', async () => {
        const { vscode } = renderChatApp();

        // Simulate confirmation request for MCP tool
        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'test_mcp_confirmation',
                toolName: 'mcp__fetch__web_fetch',
                confirmationType: '操作待确认',
                toolInput: { url: 'https://example.com' }
            });
        });

        const confirmationDialog = document.querySelector('.confirmation-dialog');
        expect(confirmationDialog).toBeInTheDocument();

        // Verify apply button shows "批准并继续"
        expect(document.querySelector('.confirmation-btn-apply')).toHaveTextContent('批准并继续');

        // Verify auto button is visible with correct text
        const autoBtn = document.querySelector('.confirmation-btn-auto');
        expect(autoBtn).toBeInTheDocument();
        expect(autoBtn).toHaveTextContent('是，且不再询问：mcp__fetch__web_fetch');

        // Verify feedback button is visible
        expect(document.querySelector('.confirmation-btn-feedback')).toHaveTextContent('提供反馈');

        // Click auto-confirm and verify decision
        vscode.postMessage.mockClear();
        await act(async () => {
            fireEvent.click(autoBtn as HTMLElement);
        });

        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        expect(sentMessages).toHaveLength(1);
        expect(sentMessages[0]).toEqual({
            command: 'confirmationResponse',
            confirmationId: 'test_mcp_confirmation',
            approved: true,
            decision: {
                behavior: 'allow',
                newPermissionRule: 'mcp__fetch__web_fetch'
            }
        });
    });

    it('should send allow decision for MCP tools when clicking apply', async () => {
        const { vscode } = renderChatApp();
        vscode.postMessage.mockClear();

        // Simulate confirmation request for MCP tool
        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'test_mcp_apply',
                toolName: 'mcp__tavily__search',
                confirmationType: '操作待确认',
                toolInput: { query: 'test query' }
            });
        });

        // Click apply button
        await act(async () => {
            fireEvent.click(document.querySelector('.confirmation-btn-apply') as HTMLElement);
        });

        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        expect(sentMessages).toHaveLength(1);
        expect(sentMessages[0]).toEqual({
            command: 'confirmationResponse',
            confirmationId: 'test_mcp_apply',
            approved: true,
            decision: {
                behavior: 'allow'
            }
        });
    });

    it('should show file path for write and edit tool confirmations', async () => {
        renderChatApp();

        // Test Write tool
        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'test_write_file_path',
                toolName: WRITE_TOOL_NAME,
                confirmationType: '代码修改待确认',
                toolInput: { file_path: 'src/utils/helper.ts', content: 'export const x = 1;' }
            });
        });

        const confirmationDialog = document.querySelector('.confirmation-dialog');
        expect(confirmationDialog).toBeInTheDocument();
        expect(document.querySelector('.confirmation-file-path')).toHaveTextContent('src/utils/helper.ts');

        // Approve to dismiss
        await act(async () => {
            fireEvent.click(document.querySelector('.confirmation-btn-apply') as HTMLElement);
        });
        expect(confirmationDialog).not.toBeInTheDocument();

        // Test Edit tool
        await act(async () => {
            sendCommand('showConfirmation', {
                confirmationId: 'test_edit_file_path',
                toolName: EDIT_TOOL_NAME,
                confirmationType: '代码修改待确认',
                toolInput: { file_path: 'src/components/App.tsx', old_string: 'old', new_string: 'new' }
            });
        });

        expect(document.querySelector('.confirmation-dialog')).toBeInTheDocument();
        expect(document.querySelector('.confirmation-file-path')).toHaveTextContent('src/components/App.tsx');
    });
});

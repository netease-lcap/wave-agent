import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, waitFor, fireEvent, act, sendCommand } from './test-utils';
import { BASH_TOOL_NAME } from 'wave-agent-sdk';

describe('Bash Permission Fix', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should send correct permission rule without double asterisk', async () => {
        const { vscode } = renderChatApp();

        // Set initial state
        act(() => {
            sendCommand('setInitialState', {
                messages: [],
                isStreaming: false,
                sessions: [],
                configurationData: {
                    apiKey: 'test-key',
                    baseURL: 'https://api.example.com',
                    model: 'gpt-4'
                },
                permissionMode: 'default'
            });
        });

        // Show Bash confirmation with suggestedPrefix
        const suggestedPrefix = 'npm run dev';
        act(() => {
            sendCommand('showConfirmation', {
                confirmationId: 'bash-confirm-123',
                toolName: BASH_TOOL_NAME,
                confirmationType: 'Bash 命令执行确认',
                toolInput: {
                    command: 'npm run dev:watch'
                },
                suggestedPrefix: suggestedPrefix
            });
        });

        // Wait for confirmation dialog
        await waitFor(() => {
            expect(document.querySelector('.confirmation-dialog')).toBeInTheDocument();
        });

        // Click "Yes, and don't ask again" button
        const autoButton = document.querySelector('.confirmation-btn-auto') as HTMLButtonElement;
        expect(autoButton).toBeInTheDocument();
        expect(autoButton).toHaveTextContent(`不再询问：${suggestedPrefix}`);

        // Clear previous messages
        vscode.postMessage.mockClear();

        await act(async () => {
            fireEvent.click(autoButton);
        });

        // Check the message sent back to extension
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        const response = sentMessages.find(m => m.command === 'confirmationResponse');
        expect(response).toBeDefined();
        expect(response.decision.newPermissionRule).toBe(`Bash(${suggestedPrefix})`);
        // It should NOT contain ':*'
        expect(response.decision.newPermissionRule).not.toContain(':*');
    });
});

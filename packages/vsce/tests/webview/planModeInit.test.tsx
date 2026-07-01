import { describe, it, expect } from 'vitest';
import { renderChatApp, act, sendCommand } from './test-utils';

describe('Plan Mode Initialization', () => {
    it('should correctly initialize in plan mode when defaultMode is set to plan', async () => {
        renderChatApp();

        // Simulate webviewReady and extension responding with initial state where permissionMode is 'plan'
        await act(async () => {
            sendCommand('setInitialState', {
                messages: [],
                subagentMessages: {},
                inputContent: '',
                isStreaming: false,
                sessions: [],
                configurationData: {
                    baseURL: 'https://api.example.com',
                    model: 'gpt-4',
                    fastModel: 'gpt-3.5',
                    apiKey: 'test-key'
                },
                permissionMode: 'plan'
            });
        });

        // Verify the permission mode select shows plan mode
        const select = document.querySelector('.permission-mode-select') as HTMLSelectElement;
        expect(select).toBeInTheDocument();
        expect(select.value).toBe('plan');
        expect(select.className).toContain('mode-plan');

        // Verify that no error message like "plan file not set" is displayed
        const errorMessages = document.querySelectorAll('.error-message, .message.error');
        expect(errorMessages).toHaveLength(0);
    });
});

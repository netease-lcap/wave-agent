import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, screen, waitFor, fireEvent, act, sendCommand } from './test-utils';

describe('Permission Mode Cycling via Shift+Tab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should cycle forward: default -> acceptEdits -> bypassPermissions -> plan', async () => {
        const { vscode } = renderChatApp();

        await act(async () => {
            sendCommand('setInitialState', {
                messages: [],
                permissionMode: 'default',
                configurationData: {}
            });
        });

        const input = screen.getByTestId('message-input');
        const select = document.querySelector('.permission-mode-select') as HTMLSelectElement;
        expect(select.value).toBe('default');

        // default -> acceptEdits
        vscode.postMessage.mockClear();
        await act(async () => {
            fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
        });
        await waitFor(() => {
            expect(vscode.postMessage).toHaveBeenCalledWith({
                command: 'setPermissionMode',
                mode: 'acceptEdits'
            });
        });
        await act(async () => {
            sendCommand('updatePermissionMode', { mode: 'acceptEdits' });
        });
        expect(select.value).toBe('acceptEdits');

        // acceptEdits -> bypassPermissions
        vscode.postMessage.mockClear();
        await act(async () => {
            fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
        });
        await waitFor(() => {
            expect(vscode.postMessage).toHaveBeenCalledWith({
                command: 'setPermissionMode',
                mode: 'bypassPermissions'
            });
        });
        await act(async () => {
            sendCommand('updatePermissionMode', { mode: 'bypassPermissions' });
        });
        expect(select.value).toBe('bypassPermissions');

        // bypassPermissions -> plan
        vscode.postMessage.mockClear();
        await act(async () => {
            fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
        });
        await waitFor(() => {
            expect(vscode.postMessage).toHaveBeenCalledWith({
                command: 'setPermissionMode',
                mode: 'plan'
            });
        });
        await act(async () => {
            sendCommand('updatePermissionMode', { mode: 'plan' });
        });
        expect(select.value).toBe('plan');
    });

    it('should wrap around from plan back to default', async () => {
        const { vscode } = renderChatApp();

        await act(async () => {
            sendCommand('setInitialState', {
                messages: [],
                permissionMode: 'plan',
                configurationData: {}
            });
        });

        const input = screen.getByTestId('message-input');
        const select = document.querySelector('.permission-mode-select') as HTMLSelectElement;
        expect(select.value).toBe('plan');

        vscode.postMessage.mockClear();
        await act(async () => {
            fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
        });
        await waitFor(() => {
            expect(vscode.postMessage).toHaveBeenCalledWith({
                command: 'setPermissionMode',
                mode: 'default'
            });
        });
        await act(async () => {
            sendCommand('updatePermissionMode', { mode: 'default' });
        });
        expect(select.value).toBe('default');
    });

    it('should update the select visual style when mode changes via extension update', async () => {
        renderChatApp();

        await act(async () => {
            sendCommand('setInitialState', {
                messages: [],
                permissionMode: 'default',
                configurationData: {}
            });
        });

        const select = document.querySelector('.permission-mode-select') as HTMLSelectElement;
        expect(select.className).toContain('mode-default');

        // Simulate extension sending a different mode (e.g. from external change)
        await act(async () => {
            sendCommand('updatePermissionMode', { mode: 'plan' });
        });

        expect(select.value).toBe('plan');
        expect(select.className).toContain('mode-plan');
        expect(select.className).not.toContain('mode-default');
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, waitFor, fireEvent, act, sendCommand } from './test-utils';

describe('Permission Mode Select', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should select a different mode and update the UI', async () => {
        const { vscode } = renderChatApp();

        // Initial state: Default mode
        await act(async () => {
            sendCommand('setInitialState', {
                messages: [],
                permissionMode: 'default',
                configurationData: {}
            });
        });

        const select = document.querySelector('.permission-mode-select') as HTMLSelectElement;
        expect(select).toBeInTheDocument();
        expect(select.value).toBe('default');
        expect(select.className).toContain('mode-default');

        // Clear mock to focus on new messages sent after change
        vscode.postMessage.mockClear();

        // Change to acceptEdits
        await act(async () => {
            fireEvent.change(select, { target: { value: 'acceptEdits' } });
        });

        // Verify the extension is notified
        await waitFor(() => {
            expect(vscode.postMessage).toHaveBeenCalledWith({
                command: 'setPermissionMode',
                mode: 'acceptEdits'
            });
        });

        // Simulate extension confirming the mode change
        await act(async () => {
            sendCommand('updatePermissionMode', { mode: 'acceptEdits' });
        });

        expect(select.value).toBe('acceptEdits');
        expect(select.className).toContain('mode-acceptEdits');
    });

    it('should include bypassPermissions option in dropdown and support selecting it', async () => {
        const { vscode } = renderChatApp();

        await act(async () => {
            sendCommand('setInitialState', {
                messages: [],
                permissionMode: 'default',
                configurationData: {}
            });
        });

        const select = document.querySelector('.permission-mode-select') as HTMLSelectElement;
        expect(select).toBeInTheDocument();

        // Verify all options are present
        const options = Array.from(select.querySelectorAll('option'));
        const optionValues = options.map(o => o.value);
        expect(optionValues).toContain('default');
        expect(optionValues).toContain('plan');
        expect(optionValues).toContain('acceptEdits');
        expect(optionValues).toContain('bypassPermissions');

        // Select bypassPermissions
        vscode.postMessage.mockClear();
        await act(async () => {
            fireEvent.change(select, { target: { value: 'bypassPermissions' } });
        });

        await waitFor(() => {
            expect(vscode.postMessage).toHaveBeenCalledWith({
                command: 'setPermissionMode',
                mode: 'bypassPermissions'
            });
        });

        // Simulate extension confirming
        await act(async () => {
            sendCommand('updatePermissionMode', { mode: 'bypassPermissions' });
        });

        expect(select.value).toBe('bypassPermissions');
        expect(select.className).toContain('mode-bypassPermissions');
    });

    it('should cycle back to default mode from bypassPermissions', async () => {
        const { vscode } = renderChatApp();

        await act(async () => {
            sendCommand('setInitialState', {
                messages: [],
                permissionMode: 'bypassPermissions',
                configurationData: {}
            });
        });

        const select = document.querySelector('.permission-mode-select') as HTMLSelectElement;
        expect(select.value).toBe('bypassPermissions');

        vscode.postMessage.mockClear();
        await act(async () => {
            fireEvent.change(select, { target: { value: 'default' } });
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
        expect(select.className).toContain('mode-default');
    });
});

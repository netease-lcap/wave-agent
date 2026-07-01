import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, screen, waitFor, fireEvent, act, sendCommand } from './test-utils';

function typeAndSend(text: string) {
    const input = screen.getByTestId('message-input');
    input.textContent = text;
    fireEvent.input(input);
    fireEvent.keyDown(input, { key: 'Enter' });
}

describe('Model Dialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should open model dialog when /model command is sent', async () => {
        renderChatApp();

        await act(async () => {
            sendCommand('configurationResponse', {
                configurationData: {
                    model: 'gpt-4',
                    fastModel: 'gpt-4-mini'
                }
            });
            sendCommand('configuredModelsResponse', {
                models: ['gpt-4', 'gpt-3.5-turbo', 'claude-3-opus', 'gpt-4-mini'],
            });
        });

        await act(async () => {
            typeAndSend('/model');
        });

        // Dialog should be visible
        const dialog = document.querySelector('.configuration-dialog-overlay');
        expect(dialog).toBeInTheDocument();

        // Verify model select exists and has the current value
        const modelSelect = document.querySelector('#model-select') as HTMLSelectElement;
        expect(modelSelect).toBeInTheDocument();
        await waitFor(() => {
            expect(modelSelect.value).toBe('gpt-4');
        });

        // Verify fast model select exists and has the current value
        const fastModelSelect = document.querySelector('#fast-model-select') as HTMLSelectElement;
        expect(fastModelSelect).toBeInTheDocument();
        await waitFor(() => {
            expect(fastModelSelect.value).toBe('gpt-4-mini');
        });
    });

    it('should populate select options from configured models response', async () => {
        renderChatApp();

        await act(async () => {
            sendCommand('configurationResponse', {
                configurationData: {
                    model: 'gpt-4',
                    fastModel: 'gpt-4-mini'
                }
            });
            sendCommand('configuredModelsResponse', {
                models: ['gpt-4', 'gpt-3.5-turbo', 'claude-3-opus']
            });
        });

        await act(async () => {
            typeAndSend('/model');
        });

        const modelSelect = document.querySelector('#model-select') as HTMLSelectElement;
        expect(modelSelect).toBeInTheDocument();

        const modelOptions = Array.from(modelSelect.querySelectorAll('option'));
        const modelValues = modelOptions.map(o => o.value);
        expect(modelValues).toContain('gpt-4');
        expect(modelValues).toContain('gpt-3.5-turbo');
        expect(modelValues).toContain('claude-3-opus');

        const fastModelSelect = document.querySelector('#fast-model-select') as HTMLSelectElement;
        const fastOptions = Array.from(fastModelSelect.querySelectorAll('option'));
        const fastValues = fastOptions.map(o => o.value);
        expect(fastValues).toContain('gpt-4');
        expect(fastValues).toContain('gpt-3.5-turbo');
        expect(fastValues).toContain('claude-3-opus');
    });

    it('should send setModel message when save is clicked', async () => {
        const { vscode } = renderChatApp();

        await act(async () => {
            sendCommand('configurationResponse', {
                configurationData: {
                    model: 'gpt-4',
                    fastModel: 'gpt-4-mini'
                }
            });
            sendCommand('configuredModelsResponse', {
                models: ['gpt-4', 'gpt-3.5-turbo'],
                fastModels: ['gpt-4-mini', 'gpt-3.5-turbo']
            });
        });

        await act(async () => {
            typeAndSend('/model');
        });

        // Change model selection
        const modelSelect = document.querySelector('#model-select') as HTMLSelectElement;
        await act(async () => {
            fireEvent.change(modelSelect, { target: { value: 'gpt-3.5-turbo' } });
        });

        // Click save button
        const saveButton = document.querySelector('.configuration-save-btn') as HTMLButtonElement;
        vscode.postMessage.mockClear();
        await act(async () => {
            fireEvent.click(saveButton);
        });

        await waitFor(() => {
            expect(vscode.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    command: 'setModel',
                    configurationData: expect.objectContaining({
                        model: 'gpt-3.5-turbo'
                    })
                })
            );
        });
    });

    it('should close the dialog when cancel is clicked', async () => {
        renderChatApp();

        await act(async () => {
            sendCommand('configurationResponse', {
                configurationData: {
                    model: 'gpt-4',
                    fastModel: 'gpt-4-mini'
                }
            });
            sendCommand('configuredModelsResponse', {
                models: ['gpt-4'],
                fastModels: ['gpt-4-mini']
            });
        });

        await act(async () => {
            typeAndSend('/model');
        });

        expect(document.querySelector('.configuration-dialog-overlay')).toBeInTheDocument();

        const cancelButton = document.querySelector('.configuration-cancel-btn') as HTMLButtonElement;
        await act(async () => {
            fireEvent.click(cancelButton);
        });

        await waitFor(() => {
            expect(document.querySelector('.configuration-dialog-overlay')).not.toBeInTheDocument();
        });
    });
});

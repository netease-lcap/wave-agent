import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, screen, waitFor, fireEvent, act, sendCommand } from './test-utils';

function typeAndSend(text: string) {
    const input = screen.getByTestId('message-input');
    input.textContent = text;
    fireEvent.input(input);
    fireEvent.keyDown(input, { key: 'Enter' });
}

describe('Model, Status, and Login Commands', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('/model command', () => {
        it('should open model dialog via /model', async () => {
            renderChatApp();

            await act(async () => {
                sendCommand('configurationResponse', {
                    configurationData: { model: 'gpt-4', fastModel: 'gpt-4-mini' }
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
            expect(document.querySelector('#model-select')).toBeInTheDocument();
        });

        it('should send getConfiguration and getConfiguredModels when /model is typed', async () => {
            const { vscode } = renderChatApp();

            vscode.postMessage.mockClear();
            await act(async () => {
                typeAndSend('/model');
            });

            expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'getConfiguration' });
            expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'getConfiguredModels' });
        });
    });

    describe('/status command', () => {
        it('should open status dialog and show version, sessionId, and workdir', async () => {
            renderChatApp();

            await act(async () => {
                typeAndSend('/status');
            });

            // Wait for dialog to appear
            await waitFor(() => {
                expect(document.querySelector('.configuration-dialog-overlay')).toBeInTheDocument();
            });

            // StatusDialog sends getStatus on mount and listens for statusResponse
            await act(async () => {
                sendCommand('statusResponse', {
                    version: '1.2.3',
                    sessionId: 'session-abc-123',
                    workdir: '/home/user/project'
                });
            });

            const dialog = document.querySelector('.configuration-dialog') as HTMLElement;
            expect(dialog).toBeInTheDocument();
            expect(dialog).toHaveTextContent('1.2.3');
            expect(dialog).toHaveTextContent('session-abc-123');
            expect(dialog).toHaveTextContent('/home/user/project');
        });

        it('should close status dialog when close button is clicked', async () => {
            renderChatApp();

            await act(async () => {
                typeAndSend('/status');
            });

            await waitFor(() => {
                expect(document.querySelector('.configuration-dialog-overlay')).toBeInTheDocument();
            });

            const closeButton = document.querySelector('.configuration-cancel-btn') as HTMLButtonElement;
            await act(async () => {
                fireEvent.click(closeButton);
            });

            await waitFor(() => {
                expect(document.querySelector('.configuration-dialog-overlay')).not.toBeInTheDocument();
            });
        });
    });

    describe('/login command', () => {
        it('should open login dialog via /login', async () => {
            renderChatApp();

            await act(async () => {
                typeAndSend('/login');
            });

            await waitFor(() => {
                expect(document.querySelector('.configuration-dialog-overlay')).toBeInTheDocument();
            });
            expect(document.querySelector('#login-serverUrl')).toBeInTheDocument();
        });

        it('should send updateConfiguration with serverUrl when save is clicked', async () => {
            const { vscode } = renderChatApp();

            await act(async () => {
                typeAndSend('/login');
            });

            await waitFor(() => {
                expect(document.querySelector('#login-serverUrl')).toBeInTheDocument();
            });

            const serverUrlInput = document.querySelector('#login-serverUrl') as HTMLInputElement;
            await act(async () => {
                fireEvent.change(serverUrlInput, { target: { value: 'https://wave.example.com' } });
            });

            const saveButton = document.querySelector('#login-save-serverUrl') as HTMLButtonElement;
            vscode.postMessage.mockClear();
            await act(async () => {
                fireEvent.click(saveButton);
            });

            await waitFor(() => {
                expect(vscode.postMessage).toHaveBeenCalledWith(
                    expect.objectContaining({
                        command: 'updateConfiguration',
                        configurationData: expect.objectContaining({
                            serverUrl: 'https://wave.example.com'
                        })
                    })
                );
            });
        });
    });

    describe('/config command', () => {
        it('should open config dialog via /config', async () => {
            renderChatApp();

            await act(async () => {
                sendCommand('configurationResponse', {
                    configurationData: {
                        baseURL: 'https://api.example.com',
                        apiKey: 'test-key',
                        model: 'gpt-4'
                    }
                });
            });

            await act(async () => {
                typeAndSend('/config');
            });

            await waitFor(() => {
                expect(document.querySelector('.configuration-dialog-overlay')).toBeInTheDocument();
            });
            // Config dialog should have baseURL input
            expect(document.querySelector('#baseURL')).toBeInTheDocument();
        });

        it('should send updateConfiguration when save is clicked', async () => {
            const { vscode } = renderChatApp();

            await act(async () => {
                sendCommand('configurationResponse', {
                    configurationData: {
                        baseURL: 'https://api.example.com',
                        apiKey: 'test-key',
                        model: 'gpt-4'
                    }
                });
            });

            await act(async () => {
                typeAndSend('/config');
            });

            await waitFor(() => {
                expect(document.querySelector('#baseURL')).toBeInTheDocument();
            });

            const baseURLInput = document.querySelector('#baseURL') as HTMLInputElement;
            await act(async () => {
                fireEvent.change(baseURLInput, { target: { value: 'https://new-api.example.com' } });
            });

            const saveButton = document.querySelector('.configuration-save-btn') as HTMLButtonElement;
            vscode.postMessage.mockClear();
            await act(async () => {
                fireEvent.click(saveButton);
            });

            await waitFor(() => {
                expect(vscode.postMessage).toHaveBeenCalledWith(
                    expect.objectContaining({
                        command: 'updateConfiguration',
                        configurationData: expect.objectContaining({
                            baseURL: 'https://new-api.example.com'
                        })
                    })
                );
            });
        });
    });
});

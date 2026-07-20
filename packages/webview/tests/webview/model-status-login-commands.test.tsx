import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, screen, waitFor, fireEvent, act, sendCommand, fireInput } from './test-utils';

async function typeAndSend(text: string) {
    const input = screen.getByTestId('message-input');
    input.textContent = text;
    await fireInput(input);
    fireEvent.keyDown(input, { key: 'Enter' });
}

describe('Model, Status, and Login Commands', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('/status command', () => {
        it('should open status dialog and show version, sessionId, and workdir', async () => {
            renderChatApp();

            await act(async () => {
                await typeAndSend('/status');
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
                await typeAndSend('/status');
            });

            await waitFor(() => {
                expect(document.querySelector('.configuration-dialog-overlay')).toBeInTheDocument();
            });

            const closeButton = document.querySelector('.configuration-actions .configuration-cancel-btn') as HTMLButtonElement;
            await act(async () => {
                fireEvent.click(closeButton);
            });

            await waitFor(() => {
                expect(document.querySelector('.configuration-dialog-overlay')).not.toBeInTheDocument();
            });
        });
    });

    describe('/config command', () => {
        it('should open config dialog via /config', async () => {
            renderChatApp();

            await act(async () => {
                sendCommand('configurationResponse', {
                    configurationData: {
                        language: 'Chinese'
                    }
                });
            });

            await act(async () => {
                await typeAndSend('/config');
            });

            await waitFor(() => {
                expect(document.querySelector('.configuration-dialog-overlay')).toBeInTheDocument();
            });
            // Config dialog should have language select
            expect(document.querySelector('#language')).toBeInTheDocument();
        });

        it('should send updateConfiguration when save is clicked', async () => {
            const { vscode } = renderChatApp();

            await act(async () => {
                sendCommand('configurationResponse', {
                    configurationData: {
                        language: 'Chinese'
                    }
                });
            });

            await act(async () => {
                await typeAndSend('/config');
            });

            await waitFor(() => {
                expect(document.querySelector('#language')).toBeInTheDocument();
            });

            const languageSelect = document.querySelector('#language') as HTMLSelectElement;
            await act(async () => {
                fireEvent.change(languageSelect, { target: { value: 'English' } });
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
                            language: 'English'
                        })
                    })
                );
            });
        });
    });
});

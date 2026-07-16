import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, screen, act, sendCommand } from './test-utils';

describe('Meta Message Hiding', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should not display messages with isMeta: true in the message list', async () => {
        renderChatApp();

        await act(async () => {
            sendCommand('setInitialState', {
                messages: [
                    {
                        id: 'msg-1',
                        role: 'user',
                        blocks: [{ type: 'text', content: 'Hello' }],
                        timestamp: Date.now()
                    },
                    {
                        id: 'msg-2',
                        role: 'user',
                        blocks: [{ type: 'text', content: 'This is a meta message' }],
                        isMeta: true,
                        timestamp: Date.now()
                    },
                    {
                        id: 'msg-3',
                        role: 'assistant',
                        blocks: [{ type: 'text', content: 'Hi there' }],
                        timestamp: Date.now()
                    }
                ],
                permissionMode: 'default',
                configurationData: {}
            });
        });

        // Regular user message should be visible
        expect(screen.getByText('Hello')).toBeInTheDocument();
        // Assistant message should be visible
        expect(screen.getByText('Hi there')).toBeInTheDocument();
        // Meta message should NOT be visible
        expect(screen.queryByText('This is a meta message')).not.toBeInTheDocument();
    });

    it('should display messages without isMeta flag normally', async () => {
        renderChatApp();

        await act(async () => {
            sendCommand('setInitialState', {
                messages: [
                    {
                        id: 'msg-1',
                        role: 'user',
                        blocks: [{ type: 'text', content: 'Visible message 1' }],
                        timestamp: Date.now()
                    },
                    {
                        id: 'msg-2',
                        role: 'assistant',
                        blocks: [{ type: 'text', content: 'Visible message 2' }],
                        timestamp: Date.now()
                    }
                ],
                permissionMode: 'default',
                configurationData: {}
            });
        });

        expect(screen.getByText('Visible message 1')).toBeInTheDocument();
        expect(screen.getByText('Visible message 2')).toBeInTheDocument();
    });

    it('should hide multiple meta messages and show only non-meta ones', async () => {
        renderChatApp();

        await act(async () => {
            sendCommand('setInitialState', {
                messages: [
                    {
                        id: 'msg-1',
                        role: 'user',
                        blocks: [{ type: 'text', content: 'Meta 1' }],
                        isMeta: true,
                        timestamp: Date.now()
                    },
                    {
                        id: 'msg-2',
                        role: 'user',
                        blocks: [{ type: 'text', content: 'Real message' }],
                        timestamp: Date.now()
                    },
                    {
                        id: 'msg-3',
                        role: 'user',
                        blocks: [{ type: 'text', content: 'Meta 2' }],
                        isMeta: true,
                        timestamp: Date.now()
                    },
                    {
                        id: 'msg-4',
                        role: 'assistant',
                        blocks: [{ type: 'text', content: 'Response' }],
                        timestamp: Date.now()
                    }
                ],
                permissionMode: 'default',
                configurationData: {}
            });
        });

        expect(screen.queryByText('Meta 1')).not.toBeInTheDocument();
        expect(screen.getByText('Real message')).toBeInTheDocument();
        expect(screen.queryByText('Meta 2')).not.toBeInTheDocument();
        expect(screen.getByText('Response')).toBeInTheDocument();
    });

    it('should handle isMeta: false explicitly (should be visible)', async () => {
        renderChatApp();

        await act(async () => {
            sendCommand('setInitialState', {
                messages: [
                    {
                        id: 'msg-1',
                        role: 'user',
                        blocks: [{ type: 'text', content: 'Explicit non-meta' }],
                        isMeta: false,
                        timestamp: Date.now()
                    }
                ],
                permissionMode: 'default',
                configurationData: {}
            });
        });

        expect(screen.getByText('Explicit non-meta')).toBeInTheDocument();
    });
});

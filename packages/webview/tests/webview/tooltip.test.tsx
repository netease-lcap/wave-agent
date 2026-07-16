import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, screen, waitFor, fireEvent, act, sendCommand } from './test-utils';

describe('Tooltip Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should show tooltip on mouseEnter and hide on mouseLeave for the send button', async () => {
        renderChatApp();

        await act(async () => {
            sendCommand('setInitialState', {
                messages: [],
                permissionMode: 'default',
                configurationData: {}
            });
        });

        const sendBtn = screen.getByTestId('send-btn');
        const container = sendBtn.closest('.tooltip-container') as HTMLElement;
        expect(container).not.toBeNull();

        // Initially no visible tooltip
        expect(document.querySelector('.tooltip-box.visible')).toBeNull();

        // Hover over the send button
        await act(async () => {
            fireEvent.mouseEnter(container);
        });

        // Tooltip should become visible
        await waitFor(() => {
            const tooltip = document.querySelector('.tooltip-box.visible');
            expect(tooltip).not.toBeNull();
            expect(tooltip).toHaveTextContent('发送');
        });

        // Mouse leave
        await act(async () => {
            fireEvent.mouseLeave(container);
        });

        // Tooltip should be hidden
        await waitFor(() => {
            expect(document.querySelector('.tooltip-box.visible')).toBeNull();
        });
    });

    it('should show tooltip for the clear chat button', async () => {
        renderChatApp();

        await act(async () => {
            sendCommand('setInitialState', {
                messages: [],
                permissionMode: 'default',
                configurationData: {}
            });
        });

        const clearBtn = screen.getByTestId('clear-chat-btn');
        const container = clearBtn.closest('.tooltip-container') as HTMLElement;
        expect(container).not.toBeNull();

        await act(async () => {
            fireEvent.mouseEnter(container);
        });

        await waitFor(() => {
            const tooltip = document.querySelector('.tooltip-box.visible');
            expect(tooltip).not.toBeNull();
            expect(tooltip).toHaveTextContent('清除聊天');
        });
    });

    it('should show tooltip for the permission mode select', async () => {
        renderChatApp();

        await act(async () => {
            sendCommand('setInitialState', {
                messages: [],
                permissionMode: 'default',
                configurationData: {}
            });
        });

        const select = document.querySelector('.permission-mode-select') as HTMLElement;
        const container = select.closest('.tooltip-container') as HTMLElement;
        expect(container).not.toBeNull();

        await act(async () => {
            fireEvent.mouseEnter(container);
        });

        await waitFor(() => {
            const tooltip = document.querySelector('.tooltip-box.visible');
            expect(tooltip).not.toBeNull();
            expect(tooltip).toHaveTextContent('权限模式');
        });
    });

    it('should show tooltip for the abort button during streaming', async () => {
        renderChatApp();

        await act(async () => {
            sendCommand('setInitialState', {
                messages: [],
                permissionMode: 'default',
                configurationData: {},
                isStreaming: true
            });
        });

        const abortBtn = screen.getByTestId('abort-btn');
        const container = abortBtn.closest('.tooltip-container') as HTMLElement;
        expect(container).not.toBeNull();

        await act(async () => {
            fireEvent.mouseEnter(container);
        });

        await waitFor(() => {
            const tooltip = document.querySelector('.tooltip-box.visible');
            expect(tooltip).not.toBeNull();
            expect(tooltip).toHaveTextContent('停止');
        });
    });

    it('should have role="tooltip" on tooltip elements', async () => {
        renderChatApp();

        await act(async () => {
            sendCommand('setInitialState', {
                messages: [],
                permissionMode: 'default',
                configurationData: {}
            });
        });

        const sendBtn = screen.getByTestId('send-btn');
        const container = sendBtn.closest('.tooltip-container') as HTMLElement;

        await act(async () => {
            fireEvent.mouseEnter(container);
        });

        await waitFor(() => {
            const tooltip = document.querySelector('[role="tooltip"]');
            expect(tooltip).not.toBeNull();
        });
    });
});

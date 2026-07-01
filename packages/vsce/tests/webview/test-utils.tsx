import React from 'react';
import { vi } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { VsCodeApi } from '../../webview/src/types';
import { ChatApp } from '../../webview/src/components/ChatApp';

// Mock heavy dependencies
vi.mock('mermaid', () => ({
    default: {
        initialize: vi.fn(),
        render: vi.fn().mockResolvedValue({ svg: '<svg></svg>', bindFunctions: vi.fn() }),
    },
}));

vi.mock('dompurify', () => ({
    default: {
        sanitize: vi.fn((html: string) => html),
    },
}));

// Mock CSS imports
vi.mock('../../webview/src/styles/ChatApp.css', () => ({}));
vi.mock('../../webview/src/styles/globals.css', () => ({}));
vi.mock('@vscode/codicons/dist/codicon.css', () => ({}));

// Mock ResizeObserver (not available in jsdom)
class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

/**
 * Create a mock VS Code API object
 */
export function createMockVscode() {
    return {
        postMessage: vi.fn(),
        getState: vi.fn().mockReturnValue(null),
        setState: vi.fn(),
    };
}

/**
 * Render the ChatApp with a mock VS Code API
 */
export function renderChatApp(vscode?: VsCodeApi) {
    const mockVscode = (vscode || createMockVscode()) as ReturnType<typeof createMockVscode>;
    const result = render(<ChatApp vscode={mockVscode} />);
    const user = userEvent.setup();
    return { ...result, vscode: mockVscode, user };
}

/**
 * Simulate an extension → webview message
 */
export function sendExtensionMessage(data: Record<string, unknown>) {
    act(() => {
        window.dispatchEvent(new MessageEvent('message', { data }));
    });
}

/**
 * Simulate extension message with command and additional data
 */
export function sendCommand(command: string, data?: Record<string, unknown>) {
    sendExtensionMessage({ command, ...data });
}

/**
 * Set text on a contenteditable message input, working around jsdom's lack of innerText support.
 * MessageInput reads `event.currentTarget.innerText` in its handleInput handler, but jsdom does
 * not implement the innerText getter/setter. We define it on the element, set textContent, then
 * fire the input event so the React handler picks up the value.
 */
export async function setInputText(element: HTMLElement, text: string) {
    Object.defineProperty(element, 'innerText', {
        value: text,
        configurable: true,
        writable: true,
    });
    element.textContent = text;
    await act(async () => {
        fireEvent.input(element, { data: text, inputType: 'insertText' });
    });
}

/**
 * Fire an input event wrapped in act() to prevent React state update warnings.
 * If fake timers are enabled, also advances them to flush debounced state updates.
 */
export async function fireInput(element: HTMLElement, options?: { data?: string; inputType?: string }) {
    await act(async () => {
        fireEvent.input(element, options);
        // Try to advance timers if fake timers are enabled (flushes 100ms debounce in handleSelectionChange)
        try {
            await vi.advanceTimersByTimeAsync(150);
        } catch {
            // Fake timers not enabled, skip
        }
    });
}

// Re-export commonly used testing utilities
export { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';

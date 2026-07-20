import { describe, it, expect } from 'vitest';
// Import test-utils to trigger its file-level vi.mock setup (mermaid/dompurify/CSS/ResizeObserver).
import { render, screen, createMockVscode, sendExtensionMessage } from './test-utils';
import { ChatApp } from '../../src/components/ChatApp';

/**
 * Regression test: the chat input (MessageInput) must NOT be disabled while the user is
 * unauthenticated. Users can configure a direct-connection LLM in the settings dialog
 * without logging in, so the input needs to stay editable.
 *
 * Before the fix, ChatApp passed `disabled={state.inputDisabled || !state.isAuthenticated}`,
 * which disabled the input in the initial (unauthenticated) state. The input no longer has
 * any disabled binding, so it stays editable regardless of auth state — this test guards
 * against re-introducing a login gate.
 */
describe('Unauthenticated input enabled', () => {
    it('keeps the message input editable when unauthenticated (no authStatusResponse sent)', () => {
        const vscode = createMockVscode();
        // Render WITHOUT sending authStatusResponse so isAuthenticated stays at its
        // initial value of false — the real unauthenticated state.
        render(<ChatApp vscode={vscode as unknown as never} />);

        const input = screen.getByTestId('message-input');
        expect(input.getAttribute('contentEditable')).toBe('true');
    });

    it('remains editable after authenticating (login does not affect editability)', () => {
        const vscode = createMockVscode();
        render(<ChatApp vscode={vscode as unknown as never} />);

        sendExtensionMessage({ command: 'authStatusResponse', isAuthenticated: true });

        const input = screen.getByTestId('message-input');
        expect(input.getAttribute('contentEditable')).toBe('true');
    });
});

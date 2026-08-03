import { describe, it, expect } from 'vitest';
// Import test-utils to trigger its file-level vi.mock setup (mermaid/dompurify/CSS/ResizeObserver).
import { render, screen, createMockVscode, sendCommand } from './test-utils';
import { ChatApp } from '../../src/components/ChatApp';

/**
 * First connection to a remote host takes seconds (SSH connect + remote wave
 * resolve/start). While the fresh agent is mid-spawn the host pushes
 * isActivating: true, and the pane shows the connecting overlay + label. The
 * overlay replaces the whole message + input area (same as the restore sweep),
 * so the user cannot type or send until the spawn settles (spec 场景 24).
 */
function pushActivationState(vscode: ReturnType<typeof createMockVscode>, paneId: string, isActivating: boolean) {
    sendCommand('setInitialState', {
        paneId,
        messages: [],
        isStreaming: false,
        isActivating,
        sessions: [],
        configurationData: {},
        pendingConfirmations: [],
        workdir: '/remote/repo',
    });
}

describe('Activation overlay (first connection to a host)', () => {
    it('shows the connecting overlay in place of the input while the agent spawns, then clears both', () => {
        const mockVscode = createMockVscode();
        render(<ChatApp vscode={mockVscode} host={{ type: 'desktop' } as never} paneId="pane-a" />);

        pushActivationState(mockVscode, 'pane-a', true);

        const overlay = screen.getByTestId('chat-restoring-overlay');
        expect(overlay).toBeInTheDocument();
        expect(overlay).toHaveTextContent('正在连接…');
        // The overlay replaces the message + input area: the input is not in the
        // document at all while the agent is mid-spawn, so nothing can be typed.
        expect(screen.queryByTestId('message-input')).not.toBeInTheDocument();

        pushActivationState(mockVscode, 'pane-a', false);

        expect(screen.queryByTestId('chat-restoring-overlay')).not.toBeInTheDocument();
        expect(screen.getByTestId('message-input').getAttribute('contentEditable')).toBe('true');
    });
});

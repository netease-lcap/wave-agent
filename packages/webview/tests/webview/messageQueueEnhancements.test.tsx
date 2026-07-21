import { describe, it, expect, beforeEach } from 'vitest';
import { renderChatApp, screen, fireEvent, sendCommand, fireInput, waitFor } from './test-utils';

/**
 * Helper: set contenteditable text and fire input event
 */
async function typeMessage(text: string) {
    const input = screen.getByTestId('message-input');
    input.textContent = text;
    Object.defineProperty(input, 'innerText', { value: text, configurable: true, writable: true });
    await fireInput(input, { inputType: 'insertText' });
}

/**
 * Type body text while keeping the read-only edit chip in place (mirrors the real
 * editing flow where the chip precedes the editable body). Replaces only the body
 * text node so `.queued-edit-chip` stays in the DOM and edit mode is preserved.
 */
async function typeEditBody(text: string) {
    const input = screen.getByTestId('message-input');
    const chip = input.querySelector('.queued-edit-chip');
    // Keep the chip, replace everything after it with a single space + body node.
    while (input.lastChild && input.lastChild !== chip) {
        input.removeChild(input.lastChild);
    }
    input.appendChild(document.createTextNode(' '));
    input.appendChild(document.createTextNode(text));
    Object.defineProperty(input, 'innerText', {
        value: `编辑队列消息 ${text}`,
        configurable: true,
        writable: true,
    });
    await fireInput(input, { inputType: 'insertText' });
}

function itemText(id: string): string {
    const item = screen.getByTestId(`queued-item-${id}`);
    return item.querySelector('.queued-item-text')?.textContent ?? '';
}

function clickHeader() {
    const header = screen.getByTestId('queued-message-list').querySelector('.queued-message-list-header') as HTMLElement;
    fireEvent.click(header);
}

describe('Message Queue Features', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should show the count "消息队列 (N)" in the header', () => {
        renderChatApp();
        sendCommand('startStreaming');
        sendCommand('updateQueue', {
            queue: [
                { id: 'q1', content: 'Queued 1' },
                { id: 'q2', content: 'Queued 2' },
                { id: 'q3', content: 'Queued 3' }
            ]
        });

        const queuePanel = screen.getByTestId('queued-message-list');
        expect(queuePanel).toHaveTextContent('消息队列 (3)');
    });

    it('should default to collapsed showing only the first item, and expand to show all on header click', () => {
        renderChatApp();
        sendCommand('startStreaming');
        sendCommand('updateQueue', {
            queue: [
                { id: 'q1', content: 'Queued 1' },
                { id: 'q2', content: 'Queued 2' }
            ]
        });

        // Collapsed by default: only first item, chevron SVG not rotated (no `expanded`)
        expect(screen.getByTestId('queued-item-q1')).toBeInTheDocument();
        expect(screen.queryByTestId('queued-item-q2')).not.toBeInTheDocument();
        const collapsedChevron = screen.getByTestId('queued-message-list').querySelector('.queued-chevron');
        expect(collapsedChevron).toBeTruthy();
        expect(collapsedChevron?.classList.contains('expanded')).toBe(false);

        // Expand: both items, chevron SVG rotated (`expanded`)
        clickHeader();
        expect(screen.getByTestId('queued-item-q1')).toBeInTheDocument();
        expect(screen.getByTestId('queued-item-q2')).toBeInTheDocument();
        expect(screen.getByTestId('queued-message-list').querySelector('.queued-chevron.expanded')).toBeTruthy();

        // Collapse again
        clickHeader();
        expect(screen.queryByTestId('queued-item-q2')).not.toBeInTheDocument();
    });

    it('should delete a queued message by id via deleteQueuedMessageById', () => {
        const { vscode } = renderChatApp();
        sendCommand('startStreaming');
        sendCommand('updateQueue', { queue: [{ id: 'q1', content: 'Queued 1' }] });

        fireEvent.click(screen.getByTestId('queued-delete-q1'));

        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        const deleteMsg = sentMessages.find((m: Record<string, unknown>) => m.command === 'deleteQueuedMessageById');
        expect(deleteMsg).toBeDefined();
        expect(deleteMsg.id).toBe('q1');

        // Optimistic removal empties the queue and hides the panel
        expect(screen.queryByTestId('queued-message-list')).not.toBeInTheDocument();
    });

    it('should force-send a queued message and remove it when clicking the inline ↑ send button', () => {
        const { vscode } = renderChatApp();
        sendCommand('startStreaming');
        sendCommand('updateQueue', { queue: [{ id: 'q1', content: 'Send me now' }] });

        const sendBtn = screen.getByTestId('queued-send-q1');
        expect(sendBtn).toHaveAttribute('aria-label', '立即发送');

        vscode.postMessage.mockClear();
        fireEvent.click(sendBtn);

        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);

        // force-send: sendMessage carries the item's text with force:true
        const sendMsg = sentMessages.find((m: Record<string, unknown>) => m.command === 'sendMessage');
        expect(sendMsg).toBeDefined();
        expect(sendMsg.text).toBe('Send me now');
        expect(sendMsg.force).toBe(true);

        // followed by removing it from the queue by id
        const deleteMsg = sentMessages.find((m: Record<string, unknown>) => m.command === 'deleteQueuedMessageById');
        expect(deleteMsg).toBeDefined();
        expect(deleteMsg.id).toBe('q1');

        // Optimistic removal empties the queue and hides the panel
        expect(screen.queryByTestId('queued-message-list')).not.toBeInTheDocument();
    });

    it('should enter editing mode and insert the inline chip + body into the input when clicking edit', async () => {
        renderChatApp();
        sendCommand('startStreaming');
        sendCommand('updateQueue', { queue: [{ id: 'q1', content: 'Editable text' }] });

        const input = screen.getByTestId('message-input');

        // No inline edit chip before clicking edit
        expect(input.querySelector('.queued-edit-chip')).toBeNull();

        fireEvent.click(screen.getByTestId('queued-edit-q1'));

        // The read-only inline chip "编辑队列消息" appears inside the input,
        // and the queued item is marked as editing.
        await waitFor(() => {
            expect(input.querySelector('.queued-edit-chip')).not.toBeNull();
        });
        const chip = input.querySelector('.queued-edit-chip') as HTMLElement;
        expect(chip).toHaveTextContent('编辑队列消息');
        expect(chip.getAttribute('data-queued-edit-chip')).toBe('true');
        expect(chip.contentEditable).toBe('false');
        expect(screen.getByTestId('queued-item-q1').className).toMatch(/editing/);

        // The edited content is loaded into the input body alongside the chip
        await waitFor(() => {
            expect(input.textContent).toContain('Editable text');
        });
    });

    it('should exit editing mode when the inline chip is removed from the input', async () => {
        renderChatApp();
        sendCommand('startStreaming');
        sendCommand('updateQueue', { queue: [{ id: 'q1', content: 'Editable text' }] });

        const input = screen.getByTestId('message-input');
        fireEvent.click(screen.getByTestId('queued-edit-q1'));
        await waitFor(() => expect(input.querySelector('.queued-edit-chip')).not.toBeNull());
        expect(screen.getByTestId('queued-item-q1').className).toMatch(/editing/);

        // Simulate the user deleting the read-only chip (e.g. via backspace):
        // remove it from the DOM and fire an input event. handleInput detects the
        // missing chip and calls onCancelQueuedEdit, clearing editing state.
        const chip = input.querySelector('.queued-edit-chip') as HTMLElement;
        chip.remove();
        Object.defineProperty(input, 'innerText', { value: 'Editable text', configurable: true, writable: true });
        await fireInput(input, { inputType: 'deleteContentBackward' });

        await waitFor(() => {
            expect(screen.getByTestId('queued-item-q1').className).not.toMatch(/editing/);
        });
    });

    it('should submit the edit via updateQueuedMessage when sending in editing mode', async () => {
        const { vscode } = renderChatApp();
        sendCommand('startStreaming');
        sendCommand('updateQueue', { queue: [{ id: 'q1', content: 'Old text' }] });

        fireEvent.click(screen.getByTestId('queued-edit-q1'));
        await waitFor(() =>
            expect(screen.getByTestId('message-input').querySelector('.queued-edit-chip')).not.toBeNull()
        );

        vscode.postMessage.mockClear();
        await typeEditBody('New text');
        fireEvent.click(screen.getByTestId('send-btn'));

        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        const updateMsg = sentMessages.find((m: Record<string, unknown>) => m.command === 'updateQueuedMessage');
        expect(updateMsg).toBeDefined();
        expect(updateMsg.id).toBe('q1');
        expect(updateMsg.text).toBe('New text');

        // Editing mode is cleared after submit
        await waitFor(() => {
            expect(screen.getByTestId('message-input').querySelector('.queued-edit-chip')).toBeNull();
        });
    });

    it('should show a banner and exit editing when receiving updateQueuedMessageMissing', async () => {
        renderChatApp();
        sendCommand('startStreaming');
        sendCommand('updateQueue', { queue: [{ id: 'q1', content: 'Old text' }] });

        fireEvent.click(screen.getByTestId('queued-edit-q1'));
        await waitFor(() =>
            expect(screen.getByTestId('message-input').querySelector('.queued-edit-chip')).not.toBeNull()
        );

        sendCommand('updateQueuedMessageMissing');

        // Banner appears with the expected copy
        await waitFor(() => {
            expect(screen.getByTestId('queue-edit-warning')).toBeInTheDocument();
        });
        expect(screen.getByTestId('queue-edit-warning')).toHaveTextContent('编辑的队列消息已不存在！');

        // Editing mode is cleared
        expect(screen.queryByText('q1', { selector: '.queued-item.editing' })).not.toBeInTheDocument();
    });

    it('abort should NOT clear the queue', () => {
        renderChatApp();
        sendCommand('startStreaming');
        sendCommand('updateQueue', { queue: [{ id: 'q1', content: 'Queued 1' }] });

        const queuePanel = screen.getByTestId('queued-message-list');
        expect(queuePanel).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('abort-btn'));

        expect(queuePanel).toBeInTheDocument();
        expect(itemText('q1')).toBe('Queued 1');
    });

    it('new message should prioritize over queue when not streaming', async () => {
        const { vscode } = renderChatApp();

        sendCommand('updateQueue', { queue: [{ id: 'q1', content: 'Queued 1' }] });

        vscode.postMessage.mockClear();
        await typeMessage('New Message');
        fireEvent.click(screen.getByTestId('send-btn'));

        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        const sendMsg = sentMessages.find((m: Record<string, unknown>) => m.command === 'sendMessage' && m.text === 'New Message');
        expect(sendMsg).toBeDefined();
    });
});

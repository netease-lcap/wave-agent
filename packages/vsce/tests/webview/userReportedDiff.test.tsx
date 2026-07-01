import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, act, sendCommand } from './test-utils';
import { EDIT_TOOL_NAME } from 'wave-agent-sdk';
import type { Message } from 'wave-agent-sdk';

describe('Diff Viewer User Reported Case', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should maintain correct line order for the user reported case', async () => {
        renderChatApp();

        // The specific case reported by the user
        const mockEditMessage: Message = {
            id: 'msg_user_reported_1',
            role: 'assistant' as const,
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: [
                {
                    type: 'tool',
                    name: EDIT_TOOL_NAME,
                    parameters: JSON.stringify({
                        file_path: '/home/liuyiqi/code/bin/scripts/i-wave-agent.sh',
                        old_string: 'pkg_name="wave-agent-sdk-$(date +%s).tgz"\nmv ./packages/agent-sdk/wave-agent-sdk-*.tgz "$dir/$pkg_name"',
                        new_string: 'rm -f "$dir"/wave-agent-sdk-*.tgz\npkg_name="wave-agent-sdk-$(date +%s).tgz"\nmv ./packages/agent-sdk/wave-agent-sdk-*.tgz "$dir/$pkg_name"'
                    }),
                    compactParams: 'scripts/i-wave-agent.sh',
                    stage: 'end' as const,
                    success: true,
                    id: 'user_reported_case'
                }
            ]
        };

        await act(async () => {
            sendCommand('updateMessages', { messages: [mockEditMessage] });
        });

        // Check that diff viewer is present
        const diffViewer = document.querySelector('.diff-viewer-container');
        expect(diffViewer).toBeInTheDocument();

        // Get all diff lines in order
        const diffLines = document.querySelectorAll('.diff-line');

        const lineTexts: string[] = [];
        diffLines.forEach(line => {
            const text = (line as HTMLElement).innerText || line.textContent || '';
            // Clean up the text for comparison (remove extra whitespace/newlines from rendering)
            lineTexts.push(text.replace(/\s+/g, ' ').trim());
        });

        // Expected order based on the user's data:
        // 1. + rm -f "$dir"/wave-agent-sdk-*.tgz (Added line)
        // 2. pkg_name="wave-agent-sdk-$(date +%s).tgz" (Context line)
        // 3. mv ./packages/agent-sdk/wave-agent-sdk-*.tgz "$dir/$pkg_name" (Context line)

        expect(lineTexts[0]).toContain('rm -f');
        expect(lineTexts[1]).toContain('pkg_name=');
        expect(lineTexts[2]).toContain('mv');

        // Verify that the added line is indeed first
        expect(lineTexts[0]).toMatch(/^\+/);
        // Verify that the following lines are context lines (no prefix or space prefix)
        expect(lineTexts[1]).not.toMatch(/^\+/);
        expect(lineTexts[1]).not.toMatch(/^-/);
        expect(lineTexts[2]).not.toMatch(/^\+/);
        expect(lineTexts[2]).not.toMatch(/^-/);
    });
});

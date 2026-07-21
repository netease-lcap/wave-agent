import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { WRITE_TOOL_NAME } from 'wave-agent-sdk';
import { WriteToolPreview } from '../../src/components/WriteToolPreview';
import type { ToolBlock } from '../../src/types';

function makeBlock(parameters: string): ToolBlock {
    return {
        type: 'tool',
        name: WRITE_TOOL_NAME,
        parameters,
        stage: 'end',
        success: true,
        shortResult: 'File created (3 lines, 8 characters)',
        id: 'write_1',
    } as unknown as ToolBlock;
}

describe('WriteToolPreview', () => {
    it('renders path, stats and content preview for a valid Write block', () => {
        const vscode = { postMessage: vi.fn() };
        const block = makeBlock(JSON.stringify({ file_path: '/a/b.md', content: 'l1\nl2\nl3' }));
        const { container } = render(<WriteToolPreview toolBlock={block} vscode={vscode} />);

        expect(container.querySelector('.write-tool-path')).toHaveTextContent('/a/b.md');
        expect(container.querySelector('.write-tool-stats')).toHaveTextContent('File created (3 lines, 8 characters)');
        const box = container.querySelector('.write-preview-box');
        expect(box).toBeInTheDocument();
        expect(box).toHaveTextContent('l1');
        expect(box).toHaveTextContent('l2');
        expect(box).toHaveTextContent('l3');
        expect(container.querySelector('.write-preview-scrim')).toBeInTheDocument();
    });

    it('fires openFile when the enlarge button is clicked', async () => {
        const user = userEvent.setup();
        const vscode = { postMessage: vi.fn() };
        const block = makeBlock(JSON.stringify({ file_path: '/a/b.md', content: 'l1\nl2\nl3' }));
        const { getByTestId } = render(<WriteToolPreview toolBlock={block} vscode={vscode} />);

        const openButton = getByTestId('write-preview-open');
        expect(openButton).toHaveAttribute('aria-label', '打开预览');
        await user.click(openButton);

        expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'openFile', path: '/a/b.md' });
    });

    it('fires openFile when the path is clicked', async () => {
        const user = userEvent.setup();
        const vscode = { postMessage: vi.fn() };
        const block = makeBlock(JSON.stringify({ file_path: '/a/b.md', content: 'l1\nl2\nl3' }));
        const { container } = render(<WriteToolPreview toolBlock={block} vscode={vscode} />);

        await user.click(container.querySelector('.write-tool-path') as HTMLElement);
        expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'openFile', path: '/a/b.md' });
    });

    it('renders only the header without crashing on invalid JSON parameters', () => {
        const vscode = { postMessage: vi.fn() };
        const block = makeBlock('not valid json {');
        const { container } = render(<WriteToolPreview toolBlock={block} vscode={vscode} />);

        expect(container.querySelector('.write-tool-header')).toBeInTheDocument();
        expect(container.querySelector('.write-preview-box')).not.toBeInTheDocument();
        expect(container.querySelector('.write-tool-stats')).not.toBeInTheDocument();
    });
});

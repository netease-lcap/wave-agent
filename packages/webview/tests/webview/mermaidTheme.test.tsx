import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import mermaid from 'mermaid';
import { MermaidRenderer } from '../../src/components/MermaidRenderer';

vi.mock('mermaid', () => ({
    default: {
        initialize: vi.fn(),
        render: vi.fn().mockResolvedValue({ svg: '<svg></svg>', bindFunctions: vi.fn() }),
    },
}));

const initializeMock = vi.mocked(mermaid.initialize);

function renderDiagram() {
    const vscode = { postMessage: vi.fn() };
    return render(<MermaidRenderer content={'graph TD\nA-->B'} vscode={vscode} />);
}

afterEach(() => {
    document.body.classList.remove('vscode-dark', 'vscode-light');
    document.documentElement.removeAttribute('data-theme');
    initializeMock.mockClear();
});

describe('MermaidRenderer theme', () => {
    it('initializes with the dark theme when the host is dark, and re-initializes on theme flip', async () => {
        document.body.classList.add('vscode-dark');
        renderDiagram();
        await vi.waitFor(() => {
            expect(initializeMock).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
        });

        document.body.classList.remove('vscode-dark');
        document.body.classList.add('vscode-light');
        await vi.waitFor(() => {
            expect(initializeMock).toHaveBeenCalledWith(expect.objectContaining({ theme: 'default' }));
        });
    });

    it('detects dark mode from <html data-theme> for desktop/JetBrains hosts', async () => {
        document.documentElement.setAttribute('data-theme', 'dark');
        renderDiagram();
        await vi.waitFor(() => {
            expect(initializeMock).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
        });
    });
});

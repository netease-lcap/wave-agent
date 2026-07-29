import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { Message } from '../../src/components/Message';
import { MockDataGenerator } from '../fixtures/mockData';

// Mermaid is heavy and irrelevant here; stub it out. DOMPurify must stay REAL so
// these tests exercise the actual sanitize whitelist in Message.tsx.
vi.mock('mermaid', () => ({
    default: {
        initialize: vi.fn(),
        render: vi.fn().mockResolvedValue({ svg: '<svg></svg>', bindFunctions: vi.fn() }),
    },
}));

function renderAssistantMessage(content: string) {
    const vscode = { postMessage: vi.fn(), getState: vi.fn(), setState: vi.fn() };
    const message = MockDataGenerator.createAssistantMessage(content);
    return render(<Message message={message} vscode={vscode} />);
}

describe('markdown sanitize whitelist', () => {
    it('renders --- as an <hr> divider', () => {
        const { container } = renderAssistantMessage('before\n\n---\n\nafter');
        expect(container.querySelector('.markdown-content hr')).not.toBeNull();
    });

    it('renders a remote image with src and alt preserved', () => {
        const { container } = renderAssistantMessage('look ![架构图](https://example.com/arch.png) here');
        const img = container.querySelector('.markdown-content img');
        expect(img).not.toBeNull();
        expect(img?.getAttribute('src')).toBe('https://example.com/arch.png');
        expect(img?.getAttribute('alt')).toBe('架构图');
    });
});

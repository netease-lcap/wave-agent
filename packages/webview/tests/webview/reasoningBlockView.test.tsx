import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ReasoningBlockView } from '../../src/components/ReasoningBlockView';
import type { ReasoningBlock } from '../../src/types';

const renderContent = (content: string) => <div className="rc">{content}</div>;

describe('ReasoningBlockView', () => {
    it('renders content expanded by default', () => {
        const block = { type: 'reasoning', content: 'thinking hard', stage: 'streaming' } as ReasoningBlock;
        const { container } = render(<ReasoningBlockView block={block} renderContent={renderContent} />);

        expect(container.querySelector('.reasoning-dot')).toBeInTheDocument();
        expect(container.querySelector('.reasoning-title')).toHaveTextContent('思考');
        expect(container.querySelector('.reasoning-chevron')).toHaveClass('expanded');
        expect(container.querySelector('.reasoning-content')).toHaveTextContent('thinking hard');
    });

    it('collapses and expands when the header is clicked', async () => {
        const user = userEvent.setup();
        const block = { type: 'reasoning', content: 'some thoughts', stage: 'streaming' } as ReasoningBlock;
        const { container } = render(<ReasoningBlockView block={block} renderContent={renderContent} />);

        const header = container.querySelector('.reasoning-header') as HTMLElement;

        // Collapse
        await user.click(header);
        expect(container.querySelector('.reasoning-chevron')).not.toHaveClass('expanded');
        expect(container.querySelector('.reasoning-content')).not.toBeInTheDocument();

        // Expand again
        await user.click(header);
        expect(container.querySelector('.reasoning-chevron')).toHaveClass('expanded');
        expect(container.querySelector('.reasoning-content')).toHaveTextContent('some thoughts');
    });

    it('starts collapsed when mounted already finished (e.g. loaded from history)', () => {
        const block = { type: 'reasoning', content: 'past thoughts', stage: 'end' } as ReasoningBlock;
        const { container } = render(<ReasoningBlockView block={block} renderContent={renderContent} />);

        expect(container.querySelector('.reasoning-content')).not.toBeInTheDocument();
        expect(container.querySelector('.reasoning-chevron')).not.toHaveClass('expanded');
    });

    it('auto-collapses once when stage transitions to end', () => {
        const streaming = { type: 'reasoning', content: 'live', stage: 'streaming' } as ReasoningBlock;
        const { container, rerender } = render(
            <ReasoningBlockView block={streaming} renderContent={renderContent} />
        );
        expect(container.querySelector('.reasoning-content')).toBeInTheDocument();

        const ended = { type: 'reasoning', content: 'live', stage: 'end' } as ReasoningBlock;
        rerender(<ReasoningBlockView block={ended} renderContent={renderContent} />);

        expect(container.querySelector('.reasoning-content')).not.toBeInTheDocument();
        expect(container.querySelector('.reasoning-chevron')).not.toHaveClass('expanded');
    });

    it('lets the user re-expand after auto-collapse', async () => {
        const user = userEvent.setup();
        const streaming = { type: 'reasoning', content: 'details', stage: 'streaming' } as ReasoningBlock;
        const { container, rerender } = render(
            <ReasoningBlockView block={streaming} renderContent={renderContent} />
        );

        const ended = { type: 'reasoning', content: 'details', stage: 'end' } as ReasoningBlock;
        rerender(<ReasoningBlockView block={ended} renderContent={renderContent} />);
        expect(container.querySelector('.reasoning-content')).not.toBeInTheDocument();

        await act(async () => {
            await user.click(container.querySelector('.reasoning-header') as HTMLElement);
        });
        expect(container.querySelector('.reasoning-content')).toHaveTextContent('details');
    });
});

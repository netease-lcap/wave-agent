import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import { PanelToggleMenu } from '../../src/components/PanelToggleMenu';

function renderMenu(overrides?: {
    checked?: Array<'preview' | 'diff' | 'terminal' | 'file'>;
    disabled?: Array<'preview' | 'diff' | 'terminal' | 'file'>;
    onToggle?: (kind: 'preview' | 'diff' | 'terminal' | 'file') => void;
    onClose?: () => void;
}) {
    const onToggle = overrides?.onToggle ?? vi.fn();
    const onClose = overrides?.onClose ?? vi.fn();
    render(
        <PanelToggleMenu
            checked={overrides?.checked ?? []}
            disabled={overrides?.disabled}
            onToggle={onToggle}
            onClose={onClose}
        />,
    );
    return { onToggle, onClose };
}

describe('PanelToggleMenu', () => {
    it('renders the four panel items with labels and shortcuts', () => {
        renderMenu();
        expect(screen.getByTestId('panel-toggle-item-preview')).toHaveTextContent('预览');
        expect(screen.getByTestId('panel-toggle-item-diff')).toHaveTextContent('差异');
        expect(screen.getByTestId('panel-toggle-item-terminal')).toHaveTextContent('终端');
        const fileItem = screen.getByTestId('panel-toggle-item-file');
        expect(fileItem).toHaveTextContent('文件');
        // Shortcut follows the platform: ⇧⌘F on macOS, Ctrl+Shift+F elsewhere.
        const fileShortcut = fileItem.querySelector('.panel-toggle-menu-shortcut');
        expect(fileShortcut).not.toBeNull();
        expect(['⇧⌘F', 'Ctrl+Shift+F']).toContain(fileShortcut!.textContent);
    });

    it('reflects checked state via aria-checked and the check icon', () => {
        renderMenu({ checked: ['preview', 'terminal'] });
        expect(screen.getByTestId('panel-toggle-item-preview')).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByTestId('panel-toggle-item-diff')).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByTestId('panel-toggle-item-terminal')).toHaveAttribute('aria-checked', 'true');
        expect(
            screen.getByTestId('panel-toggle-item-preview').querySelector('.panel-toggle-menu-check--on'),
        ).not.toBeNull();
        expect(
            screen.getByTestId('panel-toggle-item-diff').querySelector('.panel-toggle-menu-check--on'),
        ).toBeNull();
    });

    it('toggles items WITHOUT closing the menu (consecutive multi-select)', () => {
        const { onToggle, onClose } = renderMenu();
        fireEvent.click(screen.getByTestId('panel-toggle-item-preview'));
        fireEvent.click(screen.getByTestId('panel-toggle-item-diff'));
        expect(onToggle).toHaveBeenNthCalledWith(1, 'preview');
        expect(onToggle).toHaveBeenNthCalledWith(2, 'diff');
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByTestId('panel-toggle-menu')).toBeInTheDocument();
    });

    it('ignores clicks on disabled items', () => {
        const { onToggle } = renderMenu({ disabled: ['diff'] });
        fireEvent.click(screen.getByTestId('panel-toggle-item-diff'));
        expect(onToggle).not.toHaveBeenCalled();
        expect(screen.getByTestId('panel-toggle-item-diff')).toHaveAttribute('aria-disabled', 'true');
    });

    it('closes on click outside but not on click inside', () => {
        const { onClose } = renderMenu();
        fireEvent.mouseDown(screen.getByTestId('panel-toggle-item-preview'));
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.mouseDown(document.body);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape', () => {
        const { onClose } = renderMenu();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

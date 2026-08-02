import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen, act, within } from '@testing-library/react';
import React from 'react';
import { DiffPane, formatDiffComment } from '../../src/components/DiffPane';
import type { WorkspaceDiffFile } from '../../src/components/DiffPane';
import { createMockVscode, sendCommand } from './test-utils';

function makeFile(overrides: Partial<WorkspaceDiffFile> = {}): WorkspaceDiffFile {
    return {
        path: 'src/a.ts',
        status: 'modified',
        additions: 2,
        deletions: 1,
        hunks: '@@ -1 +1 @@\n-old\n+new1\n+new2',
        truncated: false,
        binary: false,
        ...overrides,
    };
}

function renderPane(options?: {
    paneId?: string;
    visible?: boolean;
    isStreaming?: boolean;
    sessionId?: string;
    workdir?: string;
    onClose?: () => void;
    onAddComment?: (text: string) => void;
}) {
    const vscode = createMockVscode();
    const onClose = options?.onClose ?? vi.fn();
    const result = render(
        <DiffPane
            vscode={vscode}
            width={420}
            onWidthChange={vi.fn()}
            maxWidth={716}
            onClose={onClose}
            paneId={options?.paneId}
            visible={options?.visible ?? true}
            isStreaming={options?.isStreaming ?? false}
            sessionId={options?.sessionId}
            workdir={options?.workdir}
            onAddComment={options?.onAddComment}
        />,
    );
    const rerenderWith = (props: { visible?: boolean; isStreaming?: boolean; sessionId?: string; workdir?: string }) =>
        result.rerender(
            <DiffPane
                vscode={vscode}
                width={420}
                onWidthChange={vi.fn()}
                maxWidth={716}
                onClose={onClose}
                paneId={options?.paneId}
                visible={props.visible ?? true}
                isStreaming={props.isStreaming ?? false}
                sessionId={props.sessionId}
                workdir={props.workdir}
                onAddComment={options?.onAddComment}
            />,
        );
    return { ...result, rerenderWith, vscode, onClose };
}

function sendDiffResult(files: WorkspaceDiffFile[], paneId?: string) {
    sendCommand('desktopWorkspaceDiff', {
        result: { kind: 'ok', files },
        ...(paneId !== undefined ? { paneId } : {}),
    });
}

const lastDiffRequest = (vscode: ReturnType<typeof createMockVscode>) =>
    vscode.postMessage.mock.calls.filter(([msg]) => msg.command === 'desktopGetWorkspaceDiff');

// makeFile's default hunks are 4 lines; the jsdom fallback viewport is 800px,
// so a single file block (~96px estimated) renders, while hundreds of files
// stay windowed.
function makeManyFiles(count: number): WorkspaceDiffFile[] {
    return Array.from({ length: count }, (_, i) => makeFile({ path: `src/file-${i}.ts` }));
}

const mountedFileBlocks = () => document.querySelectorAll('.diff-file').length;
const scrollBodyTo = (scrollTop: number) => {
    const body = document.querySelector('.diff-pane-body') as HTMLElement;
    body.scrollTop = scrollTop;
    fireEvent.scroll(body);
};

describe('DiffPane', () => {
    it('requests the workspace diff on mount and shows a loading state', () => {
        const { vscode } = renderPane();
        expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'desktopGetWorkspaceDiff' });
        expect(screen.getByText('加载中…')).toBeInTheDocument();
    });

    it('renders file blocks with status, path and +/- stats', () => {
        renderPane();
        sendDiffResult([
            makeFile(),
            makeFile({ path: 'img/logo.png', status: 'added', additions: 0, deletions: 0, binary: true, hunks: '' }),
        ]);
        expect(screen.getByTestId('diff-file-modified')).toBeInTheDocument();
        expect(screen.getByTestId('diff-file-added')).toBeInTheDocument();
        expect(screen.getByText('修改')).toBeInTheDocument();
        expect(screen.getByText('新增')).toBeInTheDocument();
        expect(screen.getByText('+2')).toBeInTheDocument();
        expect(screen.getByText('-1')).toBeInTheDocument();
    });

    it('renders hunks with added/removed/context line classes', () => {
        const { container } = renderPane();
        sendDiffResult([makeFile()]);
        expect(container.querySelector('.diff-line-hunk')).toHaveTextContent('@@ -1 +1 @@');
        expect(container.querySelector('.diff-line-added .diff-content')).toHaveTextContent('new1');
        expect(container.querySelector('.diff-line-removed .diff-content')).toHaveTextContent('old');
    });

    it('binary files show a placeholder instead of hunks', () => {
        renderPane();
        sendDiffResult([makeFile({ binary: true, hunks: '' })]);
        expect(screen.getByText('二进制文件，不显示差异')).toBeInTheDocument();
    });

    it('truncated files show a truncation note', () => {
        renderPane();
        sendDiffResult([makeFile({ truncated: true })]);
        expect(screen.getByText('差异过大，已截断…')).toBeInTheDocument();
    });

    it('renames without content changes show the source path', () => {
        renderPane();
        sendDiffResult([makeFile({ status: 'renamed', oldPath: 'src/old.ts', hunks: '' })]);
        expect(screen.getByText('重命名自 src/old.ts')).toBeInTheDocument();
    });

    it('shows the not-a-repo state', () => {
        renderPane();
        sendCommand('desktopWorkspaceDiff', { result: { kind: 'not-a-repo' } });
        expect(screen.getByText('非 git 仓库')).toBeInTheDocument();
    });

    it('shows the no-changes state for an empty file list', () => {
        renderPane();
        sendDiffResult([]);
        expect(screen.getByText('无改动')).toBeInTheDocument();
    });

    it('collapses and expands a file block via its header', () => {
        const { container } = renderPane();
        sendDiffResult([makeFile()]);
        const header = container.querySelector('.diff-file-header') as HTMLElement;
        expect(header).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(header);
        expect(header).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('new1')).not.toBeInTheDocument();
        fireEvent.click(header);
        expect(header).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('new1')).toBeInTheDocument();
    });

    it('refresh button requests the diff again', () => {
        const { vscode } = renderPane();
        expect(lastDiffRequest(vscode)).toHaveLength(1);
        fireEvent.click(screen.getByTestId('diff-refresh'));
        expect(lastDiffRequest(vscode)).toHaveLength(2);
    });

    it('close button calls onClose', () => {
        const onClose = vi.fn();
        renderPane({ onClose });
        fireEvent.click(screen.getByTestId('diff-close'));
        expect(onClose).toHaveBeenCalled();
    });

    it('tags requests with paneId and ignores responses for other panes', () => {
        const { vscode } = renderPane({ paneId: 'pane-1' });
        expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'desktopGetWorkspaceDiff', paneId: 'pane-1' });
        sendDiffResult([makeFile()], 'pane-2');
        expect(screen.getByText('加载中…')).toBeInTheDocument();
        sendDiffResult([], 'pane-1');
        expect(screen.getByText('无改动')).toBeInTheDocument();
    });

    it('re-showing a hidden panel triggers a fresh load', () => {
        const { vscode, rerenderWith } = renderPane({ visible: false });
        expect(lastDiffRequest(vscode)).toHaveLength(0);
        rerenderWith({ visible: true });
        expect(lastDiffRequest(vscode)).toHaveLength(1);
    });

    it('refreshes when generation ends while visible', () => {
        const { vscode, rerenderWith } = renderPane({ isStreaming: true });
        expect(lastDiffRequest(vscode)).toHaveLength(1);
        rerenderWith({ isStreaming: false });
        expect(lastDiffRequest(vscode)).toHaveLength(2);
    });

    it('keeps current files visible while the generation-end refresh is in flight', () => {
        const { rerenderWith } = renderPane({ isStreaming: true });
        sendDiffResult([makeFile()]);
        expect(screen.getByText('src/a.ts')).toBeInTheDocument();
        rerenderWith({ isStreaming: false });
        expect(screen.queryByText('加载中…')).not.toBeInTheDocument();
        expect(screen.getByText('src/a.ts')).toBeInTheDocument();
        sendDiffResult([makeFile({ path: 'src/b.ts' })]);
        expect(screen.queryByText('src/a.ts')).not.toBeInTheDocument();
        expect(screen.getByText('src/b.ts')).toBeInTheDocument();
    });

    it('keeps current files visible on manual refresh and spins the refresh icon until the response arrives', () => {
        renderPane();
        sendDiffResult([makeFile()]);
        fireEvent.click(screen.getByTestId('diff-refresh'));
        expect(screen.queryByText('加载中…')).not.toBeInTheDocument();
        expect(screen.getByText('src/a.ts')).toBeInTheDocument();
        expect(screen.getByTestId('diff-refresh').querySelector('.codicon-modifier-spin')).not.toBeNull();
        sendDiffResult([makeFile()]);
        expect(screen.getByTestId('diff-refresh').querySelector('.codicon-modifier-spin')).toBeNull();
    });

    it('resets to the loading state when the session context changes', () => {
        const { rerenderWith } = renderPane({ sessionId: 's1', workdir: '/w/a' });
        sendDiffResult([makeFile()]);
        rerenderWith({ sessionId: 's2', workdir: '/w/b' });
        expect(screen.getByText('加载中…')).toBeInTheDocument();
        expect(screen.queryByText('src/a.ts')).not.toBeInTheDocument();
    });

    it('does not refresh on generation end while hidden', () => {
        const { vscode, rerenderWith } = renderPane({ visible: false, isStreaming: true });
        rerenderWith({ visible: false, isStreaming: false });
        expect(lastDiffRequest(vscode)).toHaveLength(0);
    });

    it('refreshes when the session context changes while visible', () => {
        const { vscode, rerenderWith } = renderPane({ sessionId: 's1', workdir: '/w/a' });
        expect(lastDiffRequest(vscode)).toHaveLength(1);
        rerenderWith({ sessionId: 's2', workdir: '/w/b' });
        expect(lastDiffRequest(vscode)).toHaveLength(2);
    });

    it('drag handle resizes within min/max bounds', () => {
        const onWidthChange = vi.fn();
        const vscode = createMockVscode();
        render(
            <DiffPane
                vscode={vscode}
                width={420}
                onWidthChange={onWidthChange}
                maxWidth={716}
                onClose={vi.fn()}
                visible={true}
                isStreaming={false}
            />,
        );
        const pane = screen.getByTestId('diff-pane');
        const handle = pane.querySelector('.preview-pane-drag-handle') as HTMLElement;
        vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ right: 1024 } as DOMRect);

        fireEvent.mouseDown(handle);
        // The handle stays lit for the whole drag instead of relying on :hover,
        // which flickers when the pointer outruns the 6px handle.
        expect(handle.style.background).not.toBe('');
        expect(document.body.classList.contains('is-panel-resizing')).toBe(true);
        fireEvent.mouseMove(window, { clientX: 624 }); // 1024 - 624 = 400
        expect(onWidthChange).toHaveBeenLastCalledWith(400);
        expect(handle.style.background).not.toBe(''); // still lit mid-drag
        fireEvent.mouseMove(window, { clientX: 950 }); // 74 → clamped to 320
        expect(onWidthChange).toHaveBeenLastCalledWith(320);
        fireEvent.mouseMove(window, { clientX: 10 }); // 1014 → clamped to 716
        expect(onWidthChange).toHaveBeenLastCalledWith(716);
        fireEvent.mouseUp(window);
        expect(handle.style.background).toBe(''); // cleared on release
        expect(document.body.classList.contains('is-panel-resizing')).toBe(false);
    });

    describe('line comments', () => {
        it('formats a diff-line comment with path, prefix and text', () => {
            expect(formatDiffComment({ path: 'a.ts', prefix: '+', text: 'x', comment: '改这里' }))
                .toBe('**差异评论** · a.ts\n`+`「x」\n\n改这里');
            // context-line prefix (space) is omitted
            expect(formatDiffComment({ path: 'a.ts', prefix: ' ', text: 'x', comment: 'c' }))
                .toBe('**差异评论** · a.ts\n「x」\n\nc');
        });

        it('shows a comment button on each commentable line (not on @@ headers)', () => {
            renderPane();
            sendDiffResult([makeFile()]);
            expect(screen.getByTestId('diff-comment-add-1')).toBeInTheDocument();
            expect(screen.getByTestId('diff-comment-add-2')).toBeInTheDocument();
            expect(screen.getByTestId('diff-comment-add-3')).toBeInTheDocument();
            expect(screen.queryByTestId('diff-comment-add-0')).not.toBeInTheDocument();
        });

        it('opens a comment box under the clicked line with the file path', () => {
            renderPane();
            sendDiffResult([makeFile()]);
            fireEvent.click(screen.getByTestId('diff-comment-add-2'));
            const box = screen.getByTestId('diff-comment-box');
            expect(box).toBeInTheDocument();
            expect(screen.getByTestId('diff-comment-input')).toBeInTheDocument();
            expect(box.querySelector('.diff-comment-box-tag')).toHaveTextContent('src/a.ts');
        });

        it('appends the comment to the input and closes the box on submit', () => {
            const onAddComment = vi.fn();
            renderPane({ onAddComment });
            sendDiffResult([makeFile()]);
            fireEvent.click(screen.getByTestId('diff-comment-add-2'));
            fireEvent.change(screen.getByTestId('diff-comment-input'), { target: { value: '改这里' } });
            fireEvent.click(screen.getByTestId('diff-comment-submit'));
            expect(onAddComment).toHaveBeenCalledWith('**差异评论** · src/a.ts\n`+`「new1」\n\n改这里');
            expect(screen.queryByTestId('diff-comment-box')).not.toBeInTheDocument();
        });

        it('submits on Enter (without shift)', () => {
            const onAddComment = vi.fn();
            renderPane({ onAddComment });
            sendDiffResult([makeFile()]);
            fireEvent.click(screen.getByTestId('diff-comment-add-2'));
            const input = screen.getByTestId('diff-comment-input');
            fireEvent.change(input, { target: { value: '好' } });
            fireEvent.keyDown(input, { key: 'Enter' });
            expect(onAddComment).toHaveBeenCalled();
        });

        it('does not submit on Enter while IME is composing (e.g. pinyin)', () => {
            const onAddComment = vi.fn();
            renderPane({ onAddComment });
            sendDiffResult([makeFile()]);
            fireEvent.click(screen.getByTestId('diff-comment-add-2'));
            const input = screen.getByTestId('diff-comment-input');
            fireEvent.change(input, { target: { value: '改这里' } });
            // Chinese IME uses Enter to confirm the candidate; that keydown fires
            // with isComposing=true (keyCode 229) and must NOT submit the draft.
            fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
            expect(onAddComment).not.toHaveBeenCalled();
        });

        it('does not submit when the comment is empty', () => {
            const onAddComment = vi.fn();
            renderPane({ onAddComment });
            sendDiffResult([makeFile()]);
            fireEvent.click(screen.getByTestId('diff-comment-add-2'));
            fireEvent.click(screen.getByTestId('diff-comment-submit'));
            expect(onAddComment).not.toHaveBeenCalled();
        });

        it('closes the box on Escape', () => {
            renderPane();
            sendDiffResult([makeFile()]);
            fireEvent.click(screen.getByTestId('diff-comment-add-2'));
            fireEvent.keyDown(screen.getByTestId('diff-comment-input'), { key: 'Escape' });
            expect(screen.queryByTestId('diff-comment-box')).not.toBeInTheDocument();
        });

        it('closes the box via the cancel button', () => {
            renderPane();
            sendDiffResult([makeFile()]);
            fireEvent.click(screen.getByTestId('diff-comment-add-2'));
            fireEvent.click(screen.getByTestId('diff-comment-cancel'));
            expect(screen.queryByTestId('diff-comment-box')).not.toBeInTheDocument();
        });

        it('discards the open comment box on refresh', () => {
            renderPane();
            sendDiffResult([makeFile()]);
            fireEvent.click(screen.getByTestId('diff-comment-add-2'));
            expect(screen.getByTestId('diff-comment-box')).toBeInTheDocument();
            fireEvent.click(screen.getByTestId('diff-refresh'));
            expect(screen.queryByTestId('diff-comment-box')).not.toBeInTheDocument();
        });

        it('keeps at most one comment box open (clicking another line moves it)', () => {
            renderPane();
            sendDiffResult([makeFile()]);
            fireEvent.click(screen.getByTestId('diff-comment-add-2'));
            expect(screen.getByTestId('diff-comment-box')).toBeInTheDocument();
            fireEvent.click(screen.getByTestId('diff-comment-add-3'));
            expect(screen.queryAllByTestId('diff-comment-box')).toHaveLength(1);
        });
    });

    describe('virtualized rendering', () => {
        it('mounts only the file blocks intersecting the viewport (bounded DOM)', () => {
            renderPane();
            sendDiffResult(makeManyFiles(200));
            // All 200 files were loaded in one message, but only ~11 blocks fit
            // the viewport window (+overscan) — the DOM stays small.
            expect(mountedFileBlocks()).toBeGreaterThan(0);
            expect(mountedFileBlocks()).toBeLessThan(20);
            expect(mountedFileBlocks()).toBeLessThan(200);
        });

        it('scrolling shifts the mounted window: reveals later files, unmounts scrolled-out ones', () => {
            renderPane();
            sendDiffResult(makeManyFiles(200));
            expect(screen.getByText('src/file-0.ts')).toBeInTheDocument();
            scrollBodyTo(5000);
            expect(screen.queryByText('src/file-0.ts')).not.toBeInTheDocument();
            expect(screen.getByText('src/file-55.ts')).toBeInTheDocument();
            // Scrolling back returns the first window.
            scrollBodyTo(0);
            expect(screen.getByText('src/file-0.ts')).toBeInTheDocument();
            expect(screen.queryByText('src/file-55.ts')).not.toBeInTheDocument();
        });

        it('collapse/expand still works inside the windowed list', () => {
            renderPane();
            sendDiffResult(makeManyFiles(200));
            // Scope queries to the first mounted block: every block shares the
            // same hunks ('new1') and line testids.
            const firstBlock = document.querySelector('.diff-file') as HTMLElement;
            const header = firstBlock.querySelector('.diff-file-header') as HTMLElement;
            expect(header).toHaveAttribute('aria-expanded', 'true');
            fireEvent.click(header);
            expect(header).toHaveAttribute('aria-expanded', 'false');
            expect(within(firstBlock).queryByText('new1')).not.toBeInTheDocument();
            fireEvent.click(header);
            expect(header).toHaveAttribute('aria-expanded', 'true');
            expect(within(firstBlock).getByText('new1')).toBeInTheDocument();
        });

        it('line comments work on a windowed file block', () => {
            renderPane();
            sendDiffResult(makeManyFiles(200));
            const firstBlock = document.querySelector('.diff-file') as HTMLElement;
            fireEvent.click(within(firstBlock).getByTestId('diff-comment-add-1'));
            expect(screen.getByTestId('diff-comment-box')).toBeInTheDocument();
            expect(screen.getByTestId('diff-comment-box').querySelector('.diff-comment-box-tag')).toHaveTextContent('src/file-0.ts');
        });

        it('does not blank the pane when a refresh shrinks the list while scrolled', () => {
            renderPane();
            sendDiffResult(makeManyFiles(200));
            scrollBodyTo(5000);
            expect(screen.queryByText('src/file-0.ts')).not.toBeInTheDocument();
            // New result is a single file: the stale scrollTop must be clamped
            // so the remaining file still renders without a scroll event.
            sendDiffResult([makeFile({ path: 'src/only.ts' })]);
            expect(screen.getByText('src/only.ts')).toBeInTheDocument();
        });
    });
});

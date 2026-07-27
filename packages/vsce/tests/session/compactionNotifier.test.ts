import { describe, test, expect, vi } from 'vitest';

const { withProgress } = vi.hoisted(() => ({ withProgress: vi.fn() }));

vi.mock('vscode', () => ({
    window: { withProgress },
    ProgressLocation: { Notification: 15 },
}));

import { CompactionNotifier } from '../../src/session/compactionNotifier';

describe('CompactionNotifier', () => {
    test('shows a single notification on start and dismisses it on complete without a second notification', async () => {
        withProgress.mockClear();
        // Mock calls the task so its promise executor runs and captures resolve.
        let taskPromise: Promise<void> | undefined;
        withProgress.mockImplementation((_opts, task) => {
            taskPromise = task(
                { report: vi.fn() },
                { onCancellationRequested: vi.fn() } as unknown as Parameters<
                    Parameters<typeof withProgress>[1]
                >[1],
            );
            return taskPromise;
        });

        const notifier = new CompactionNotifier();

        // Start compaction → one notification shown
        notifier.notify(true);
        expect(withProgress).toHaveBeenCalledTimes(1);
        expect(withProgress.mock.calls[0][0].title).toBe('正在压缩对话…');

        const onResolve = vi.fn();
        taskPromise!.then(onResolve);

        // Complete compaction → no NEW notification, the in-flight one dismissed
        notifier.notify(false);
        expect(withProgress).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(onResolve).toHaveBeenCalled());
    });

    test('complete without a prior start is a no-op', () => {
        withProgress.mockClear();
        const notifier = new CompactionNotifier();
        notifier.notify(false);
        expect(withProgress).not.toHaveBeenCalled();
    });

    test('a new start after complete shows a fresh notification', async () => {
        withProgress.mockClear();
        let taskPromise: Promise<void> | undefined;
        withProgress.mockImplementation((_opts, task) => {
            taskPromise = task(
                { report: vi.fn() },
                { onCancellationRequested: vi.fn() } as unknown as Parameters<
                    Parameters<typeof withProgress>[1]
                >[1],
            );
            return taskPromise;
        });

        const notifier = new CompactionNotifier();
        notifier.notify(true);
        expect(withProgress).toHaveBeenCalledTimes(1);

        const firstResolved = vi.fn();
        taskPromise!.then(firstResolved);
        notifier.notify(false);
        await vi.waitFor(() => expect(firstResolved).toHaveBeenCalled());

        // A fresh start shows a new notification
        notifier.notify(true);
        expect(withProgress).toHaveBeenCalledTimes(2);
    });
});

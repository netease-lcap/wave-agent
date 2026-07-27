import * as vscode from 'vscode';

/**
 * Shows a single progress notification while conversation compaction is in
 * progress and dismisses it when compaction completes — instead of stacking
 * separate "starting" and "complete" notifications.
 *
 * Mirrors packages/jetbrains/.../session/CompactionNotifier.kt.
 */
export class CompactionNotifier {
    private resolve?: () => void;

    notify(isCompacting: boolean): void {
        if (isCompacting) {
            vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: '正在压缩对话…',
                    cancellable: false,
                },
                () =>
                    new Promise<void>((resolve) => {
                        this.resolve = resolve;
                    }),
            );
        } else {
            this.resolve?.();
            this.resolve = undefined;
        }
    }
}

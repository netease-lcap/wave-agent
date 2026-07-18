/**
 * StdioClient — low-level JSON-RPC transport over a child process.
 *
 * Spawns `wave --stdio`, writes requests to stdin, reads responses and
 * notifications from stdout (one JSON object per line).
 */

import { type ChildProcess, spawn } from 'child_process';
import { createInterface } from 'readline';

export type NotificationHandler = (params: unknown) => void;

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
}

export class StdioClient {
    private proc: ChildProcess;
    private nextId = 1;
    private pending = new Map<number, PendingRequest>();
    private handlers = new Map<string, Set<NotificationHandler>>();
    private disposed = false;

    constructor(
        binaryPath: string,
        args: string[] = [],
        env?: Record<string, string>,
    ) {
        this.proc = spawn(binaryPath, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, ...env },
        });

        const rl = createInterface({ input: this.proc.stdout! });
        rl.on('line', (line) => this.handleLine(line));

        this.proc.stderr!.on('data', (data: Buffer) => {
            console.error('[wave-stdio]', data.toString().trimEnd());
        });

        this.proc.on('exit', (code, signal) => {
            const error = new Error(
                `wave --stdio process exited (code: ${code}, signal: ${signal})`,
            );
            for (const p of this.pending.values()) {
                p.reject(error);
            }
            this.pending.clear();
            this.disposed = true;
        });

        this.proc.on('error', (err) => {
            console.error('[wave-stdio] Process error:', err);
        });
    }

    // ── Public API ────────────────────────────────────────────────

    async request(method: string, params?: unknown): Promise<unknown> {
        if (this.disposed) {
            throw new Error('StdioClient is disposed');
        }
        const id = this.nextId++;
        const message = JSON.stringify({ id, method, params }) + '\n';

        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.proc.stdin!.write(message);
        });
    }

    notify(method: string, params?: unknown): void {
        if (this.disposed) return;
        const message = JSON.stringify({ method, params }) + '\n';
        this.proc.stdin!.write(message);
    }

    onNotification(method: string, handler: NotificationHandler): void {
        let set = this.handlers.get(method);
        if (!set) {
            set = new Set();
            this.handlers.set(method, set);
        }
        set.add(handler);
    }

    offNotification(method: string, handler: NotificationHandler): void {
        this.handlers.get(method)?.delete(handler);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.proc.kill();
    }

    // ── Internal ──────────────────────────────────────────────────

    private handleLine(line: string): void {
        let msg: unknown;
        try {
            msg = JSON.parse(line);
        } catch {
            console.error('[wave-stdio] Failed to parse:', line);
            return;
        }

        if (typeof msg !== 'object' || msg === null) return;
        const obj = msg as Record<string, unknown>;

        // Response (has id + result/error)
        if ('id' in obj && ('result' in obj || 'error' in obj)) {
            const id = Number(obj.id);
            const pending = this.pending.get(id);
            if (pending) {
                this.pending.delete(id);
                if (obj.error) {
                    const err = obj.error as { code: number; message: string };
                    pending.reject(new Error(err.message));
                } else {
                    pending.resolve(obj.result);
                }
            }
            return;
        }

        // Notification (has method, no id)
        if ('method' in obj && !('id' in obj)) {
            const method = obj.method as string;
            const params = obj.params;
            const set = this.handlers.get(method);
            if (set) {
                for (const handler of set) {
                    handler(params);
                }
            }
            return;
        }
    }
}

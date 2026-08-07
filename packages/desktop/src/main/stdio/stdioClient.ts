/**
 * StdioClient — JSON-RPC transport over a child process's stdin/stdout.
 *
 * Spawns `wave --stdio`, writes requests to stdin, reads responses and
 * notifications from stdout (one JSON object per line). Extends the shared
 * JsonRpcClient with a process lifecycle: a rolling stderr tail is folded into
 * the rich error message that rejects pending requests when the process exits.
 */

import { type ChildProcess, spawn } from 'child_process';
import { JsonRpcClient } from './jsonRpcClient';

export type { NotificationHandler } from './jsonRpcClient';
export type StderrHandler = (data: string) => void;

/** Keep a bounded tail of stderr (bytes) for inclusion in the exit error. */
const STDERR_TAIL_LIMIT = 4096;

/**
 * Decode stderr bytes: UTF-8 when valid, otherwise GBK (Windows console
 * code page 936). cmd.exe and native Windows tools emit GBK on Chinese
 * systems; decoding those bytes as UTF-8 yields U+FFFD garbage and the real
 * error message is lost.
 */
function decodeStderr(buf: Buffer): string {
    const utf8 = buf.toString('utf-8');
    if (!utf8.includes('\uFFFD')) return utf8;
    try {
        return new TextDecoder('gbk').decode(buf);
    } catch {
        return utf8;
    }
}

export class StdioClient extends JsonRpcClient {
    private proc: ChildProcess;
    /** Raw stderr bytes, bounded to the last STDERR_TAIL_LIMIT bytes. */
    private stderrChunks: Buffer[] = [];
    private stderrBytes = 0;
    private onStderr?: StderrHandler;

    constructor(
        binaryPath: string,
        args: string[] = [],
        env?: Record<string, string>,
        onStderr?: StderrHandler,
    ) {
        super();
        this.onStderr = onStderr;
        // On Windows, binaryPath may be a `wave.cmd` shim. Node (since the
        // CVE-2024-27980 patch) refuses to spawn `.cmd`/`.bat` files without a
        // shell, throwing ERR_CHILD_PROCESS_INVALID_COMMAND_FILE. `args` is a
        // fixed flag list (`['--stdio']`) with no metacharacters, so enabling
        // the shell on Windows is safe; Unix behaviour is unchanged.
        //
        // With `shell: true`, Node concatenates file+args into the cmd.exe
        // command line WITHOUT quoting the file — a path containing spaces
        // (e.g. `C:\Users\a b\...\wave.cmd`) is split at the space and fails
        // with "'C:\Users\a' is not recognized". Pre-quote it on Windows.
        const command =
            process.platform === 'win32' ? `"${binaryPath}"` : binaryPath;
        this.proc = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, ...env },
            shell: process.platform === 'win32',
        });

        this.attachReadable(this.proc.stdout!);
        this.proc.stdin!.on('error', (err) => {
            // EPIPE when the peer exits while a request is being written — the
            // exit handler already rejects pending requests, nothing to do.
            console.error('[wave-stdio] stdin write error:', err.message);
        });

        this.proc.stderr!.on('data', (data: Buffer) => {
            // Keep raw bytes (not per-chunk strings) so the exit error can be
            // decoded exactly, without splitting a multi-byte character across
            // chunk boundaries.
            this.stderrChunks.push(data);
            this.stderrBytes += data.length;
            while (
                this.stderrChunks.length > 1 &&
                this.stderrBytes - this.stderrChunks[0].length >= STDERR_TAIL_LIMIT
            ) {
                this.stderrBytes -= this.stderrChunks[0].length;
                this.stderrChunks.shift();
            }
            const trimmed = decodeStderr(data).trimEnd();
            if (trimmed) this.onStderr?.(trimmed);
        });

        this.proc.on('exit', (code, signal) => {
            const stderr = decodeStderr(
                Buffer.concat(this.stderrChunks),
            ).trim();
            const parts = [
                `wave --stdio process exited (code: ${code}, signal: ${signal})`,
            ];
            if (stderr) parts.push(`stderr:\n${stderr}`);
            this.handleClosed(parts.join('\n'));
        });

        this.proc.on('error', (err) => {
            console.error('[wave-stdio] Process error:', err);
        });
    }

    protected writeLine(message: string): void {
        this.proc.stdin!.write(message);
    }

    dispose(): void {
        this.handleClosed('连接已断开。wave 进程已退出，请重启编辑器或检查 CLI 安装。');
        this.proc.kill();
    }
}

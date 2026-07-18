import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ── Mocks ──────────────────────────────────────────────────────

const mockSpawn = vi.hoisted(() => vi.fn());
const mockCreateInterface = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
    default: { spawn: mockSpawn },
    spawn: mockSpawn,
}));

vi.mock('readline', () => ({
    default: { createInterface: mockCreateInterface },
    createInterface: mockCreateInterface,
}));

// ── Helpers ────────────────────────────────────────────────────

interface MockProc extends EventEmitter {
    stdin: { write: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
}

function createMockProc(): MockProc {
    const proc = new EventEmitter() as MockProc;
    proc.stdin = { write: vi.fn() };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    return proc;
}

function createClient(args?: string[], env?: Record<string, string>) {
    const proc = createMockProc();
    const rl = new EventEmitter();
    mockSpawn.mockReturnValue(proc);
    mockCreateInterface.mockReturnValue(rl);

    const client = new StdioClient('/fake/wave', args, env);
    return { client, proc, rl };
}

// ── Import after mocks ─────────────────────────────────────────

import { StdioClient } from '../../src/stdio/stdioClient';

/** Await a promise that is expected to reject, returning the error. */
async function expectReject(p: Promise<unknown>): Promise<Error> {
    try {
        await p;
        throw new Error('Expected promise to reject');
    } catch (e) {
        return e as Error;
    }
}

describe('StdioClient', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    // ── Construction ───────────────────────────────────────────

    it('spawns process with binary path, args, and env', () => {
        createClient(['--stdio'], { FOO: 'bar' });

        expect(mockSpawn).toHaveBeenCalledWith(
            '/fake/wave',
            ['--stdio'],
            expect.objectContaining({
                env: expect.objectContaining({ FOO: 'bar' }),
                stdio: ['pipe', 'pipe', 'pipe'],
            }),
        );
    });

    it('passes empty args array by default', () => {
        createClient();

        expect(mockSpawn).toHaveBeenCalledWith(
            '/fake/wave',
            [],
            expect.any(Object),
        );
    });

    it('merges env with process.env', () => {
        createClient([], { CUSTOM: 'value' });

        const callEnv = mockSpawn.mock.calls[0][2].env;
        expect(callEnv.CUSTOM).toBe('value');
        expect(callEnv).toHaveProperty('PATH'); // inherited from process.env
    });

    // ── Request / Response ─────────────────────────────────────

    it('sends request with auto-incrementing id and returns result', async () => {
        const { client, proc, rl } = createClient();

        const promise = client.request('initialize', { workdir: '/test' });

        // Verify stdin write
        expect(proc.stdin.write).toHaveBeenCalledTimes(1);
        const sent = JSON.parse(proc.stdin.write.mock.calls[0][0]);
        expect(sent).toEqual({ id: 1, method: 'initialize', params: { workdir: '/test' } });

        // Simulate server response
        rl.emit('line', JSON.stringify({ id: 1, result: { sessionId: 's1' } }));

        const result = await promise;
        expect(result).toEqual({ sessionId: 's1' });
    });

    it('increments id for subsequent requests', async () => {
        const { client, proc, rl } = createClient();

        const p1 = client.request('method1');
        const p2 = client.request('method2');

        const sent1 = JSON.parse(proc.stdin.write.mock.calls[0][0]);
        const sent2 = JSON.parse(proc.stdin.write.mock.calls[1][0]);
        expect(sent1.id).toBe(1);
        expect(sent2.id).toBe(2);

        rl.emit('line', JSON.stringify({ id: 1, result: 'r1' }));
        rl.emit('line', JSON.stringify({ id: 2, result: 'r2' }));

        expect(await p1).toBe('r1');
        expect(await p2).toBe('r2');
    });

    it('rejects when server returns error', async () => {
        const { client, rl } = createClient();

        const promise = client.request('failing');
        rl.emit('line', JSON.stringify({ id: 1, error: { code: -32601, message: 'Method not found' } }));

        const error = await expectReject(promise);
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('Method not found');
    });

    it('supports params as undefined', async () => {
        const { client, proc, rl } = createClient();

        const promise = client.request('noParams');
        const sent = JSON.parse(proc.stdin.write.mock.calls[0][0]);
        expect(sent).toEqual({ id: 1, method: 'noParams', params: undefined });

        rl.emit('line', JSON.stringify({ id: 1, result: 'ok' }));
        expect(await promise).toBe('ok');
    });

    // ── Notify ─────────────────────────────────────────────────

    it('sends notification without id', () => {
        const { client, proc } = createClient();

        client.notify('permissionResponse', { requestId: 'r1', decision: 'allow' });

        const sent = JSON.parse(proc.stdin.write.mock.calls[0][0]);
        expect(sent).toEqual({
            method: 'permissionResponse',
            params: { requestId: 'r1', decision: 'allow' },
        });
        expect(sent).not.toHaveProperty('id');
    });

    it('notify with no params sends undefined params', () => {
        const { client, proc } = createClient();

        client.notify('someNotification');

        const sent = JSON.parse(proc.stdin.write.mock.calls[0][0]);
        expect(sent.method).toBe('someNotification');
        expect(sent.params).toBeUndefined();
    });

    // ── Notifications ──────────────────────────────────────────

    it('calls registered handler when notification arrives', () => {
        const { client, rl } = createClient();

        const handler = vi.fn();
        client.onNotification('messagesChange', handler);

        rl.emit('line', JSON.stringify({ method: 'messagesChange', params: { messages: [] } }));

        expect(handler).toHaveBeenCalledWith({ messages: [] });
    });

    it('supports multiple handlers for same notification', () => {
        const { client, rl } = createClient();

        const h1 = vi.fn();
        const h2 = vi.fn();
        client.onNotification('tasksChange', h1);
        client.onNotification('tasksChange', h2);

        rl.emit('line', JSON.stringify({ method: 'tasksChange', params: { tasks: [] } }));

        expect(h1).toHaveBeenCalledWith({ tasks: [] });
        expect(h2).toHaveBeenCalledWith({ tasks: [] });
    });

    it('offNotification removes specific handler', () => {
        const { client, rl } = createClient();

        const h1 = vi.fn();
        const h2 = vi.fn();
        client.onNotification('loadingChange', h1);
        client.onNotification('loadingChange', h2);
        client.offNotification('loadingChange', h1);

        rl.emit('line', JSON.stringify({ method: 'loadingChange', params: { loading: true } }));

        expect(h1).not.toHaveBeenCalled();
        expect(h2).toHaveBeenCalledWith({ loading: true });
    });

    it('does not call handlers for different notification methods', () => {
        const { client, rl } = createClient();

        const handler = vi.fn();
        client.onNotification('messagesChange', handler);

        rl.emit('line', JSON.stringify({ method: 'tasksChange', params: {} }));

        expect(handler).not.toHaveBeenCalled();
    });

    it('ignores notification when no handler registered', () => {
        const { rl } = createClient();

        // Should not throw
        expect(() => {
            rl.emit('line', JSON.stringify({ method: 'unknown', params: {} }));
        }).not.toThrow();
    });

    // ── Line parsing ───────────────────────────────────────────

    it('ignores non-JSON lines on stdout', () => {
        const { client, rl } = createClient();

        const handler = vi.fn();
        client.onNotification('test', handler);

        expect(() => {
            rl.emit('line', 'this is not json');
        }).not.toThrow();

        expect(handler).not.toHaveBeenCalled();
    });

    it('ignores null or non-object JSON', () => {
        const { rl } = createClient();

        expect(() => {
            rl.emit('line', JSON.stringify(null));
            rl.emit('line', JSON.stringify(42));
            rl.emit('line', JSON.stringify('string'));
        }).not.toThrow();
    });

    // ── Dispose ────────────────────────────────────────────────

    it('kills process on dispose', () => {
        const { client, proc } = createClient();

        client.dispose();

        expect(proc.kill).toHaveBeenCalled();
    });

    it('does not kill process twice on double dispose', () => {
        const { client, proc } = createClient();

        client.dispose();
        client.dispose();

        expect(proc.kill).toHaveBeenCalledTimes(1);
    });

    it('throws on request after dispose', async () => {
        const { client } = createClient();

        client.dispose();

        const error = await expectReject(client.request('test'));
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('StdioClient is disposed');
    });

    it('notify is silent after dispose', () => {
        const { client, proc } = createClient();

        client.dispose();
        client.notify('test');

        expect(proc.stdin.write).not.toHaveBeenCalled();
    });

    // ── Process exit ───────────────────────────────────────────

    it('rejects all pending requests on process exit', async () => {
        const { client, proc } = createClient();

        const p1 = expectReject(client.request('method1'));
        const p2 = expectReject(client.request('method2'));

        proc.emit('exit', 1, null);

        const e1 = await p1;
        const e2 = await p2;
        expect(e1).toBeInstanceOf(Error);
        expect(e1.message).toContain('wave --stdio process exited');
        expect(e2).toBeInstanceOf(Error);
        expect(e2.message).toContain('wave --stdio process exited');
    });

    it('marks client as disposed after process exit', async () => {
        const { client, proc } = createClient();

        proc.emit('exit', 0, null);

        const error = await expectReject(client.request('test'));
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('StdioClient is disposed');
    });
});

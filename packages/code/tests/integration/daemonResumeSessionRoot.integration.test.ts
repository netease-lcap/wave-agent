/**
 * Real-daemon test: a re-attached live session must report its **creation
 * root**, not the cwd a `cd` inside the conversation drifted to.
 *
 * Why this cannot live in the unit layer: the bug only exists across the
 * daemon's client detach/attach seam. `AgentBridge.initialize` reuses an agent
 * that is still running in the daemon process when the client passes
 * `restoreSessionId` (desktop app quit → daemon kept the session; desktop
 * restarted → `/resume`). A mocked bridge returns whatever the test told it to,
 * so nothing in `agentBridge.test.ts` can make the *real* drift show up.
 *
 * So this suite runs the real thing: a real `wave --daemon <socket>` child
 * process with a throwaway HOME, a real local model server that answers the
 * first turn with a `Bash: cd sub` tool call (which really executes and really
 * moves the session cwd), a real client detach, then a second client that
 * re-attaches with `restoreSessionId`.
 *
 * Skipped on Windows: the daemon listens on a unix socket, which libuv rejects
 * there (same reason `tests/stdio/daemonServer.test.ts` skips).
 *
 * Requires a built CLI (`pnpm build`, or at least `pnpm -F wave-code build`):
 * the child is `bin/wave-code.js`, which loads `dist/bundle/wave.mjs`. The
 * integration CI job builds first.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInterface } from "readline";
import { execFileSync, spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

const CLI = fileURLToPath(new URL("../../bin/wave-code.js", import.meta.url));

/**
 * Unix-domain sockets are unreliable on Windows: libuv rejects binding a
 * non-`\\.\pipe\...` path with EACCES.
 */
const test = process.platform === "win32" ? it.skip : it;

/** Scratch root; unique per run so two worktrees cannot collide. */
const ROOT = path.join(
  os.tmpdir(),
  `wave-daemon-root-${process.pid}-${Date.now()}`,
);
const HOME = path.join(ROOT, "home");
const REPO = path.join(ROOT, "repo");
const SUB = path.join(REPO, "sub");
const WORKTREE = path.join(REPO, ".wave", "worktrees", "feat");
const SOCKET = path.join(ROOT, "daemon.sock");

const real = (p: string) => fs.realpathSync(p);

// ── fake model: turn 1 → Bash tool_call, then plain text for later turns ──
let modelCalls = 0;
const model = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    modelCalls += 1;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    const chunk = (delta: unknown, finish?: string) =>
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-daemon-root",
          object: "chat.completion.chunk",
          created: 1_700_000_000,
          model: "test-model",
          choices: [{ index: 0, delta, finish_reason: finish ?? null }],
        })}\n\n`,
      );
    if (modelCalls === 1) {
      // The real Bash tool wraps this as `eval '<cmd>' && pwd -P >| <tmp>`, so
      // the new cwd is detected and reported back as a `workdirChange`.
      chunk({
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "call_cd",
            type: "function",
            function: { name: "Bash", arguments: '{"command":"cd sub"}' },
          },
        ],
      });
      chunk({}, "tool_calls");
    } else {
      chunk({ role: "assistant", content: "ok" });
      chunk({}, "stop");
    }
    res.write("data: [DONE]\n\n");
    res.end();
  });
});

let daemon: ChildProcess | undefined;
let clients: ReturnType<typeof connect>[] = [];

interface RpcClient {
  socket: net.Socket;
  /** Notifications received so far, in arrival order. */
  notes: Array<{ method: string; params?: unknown }>;
  request: (
    method: string,
    params?: unknown,
    sessionId?: string,
  ) => Promise<Record<string, unknown>>;
  waitForNotification: (method: string, timeout?: number) => Promise<unknown>;
}

/** One JSON object per line, same envelope the real clients use. */
function connect(): RpcClient {
  const socket = net.connect(SOCKET);
  let nextId = 1;
  const pending = new Map<
    number,
    {
      resolve: (v: Record<string, unknown>) => void;
      reject: (e: Error) => void;
    }
  >();
  const notes: Array<{ method: string; params?: unknown }> = [];
  createInterface({ input: socket }).on("line", (line) => {
    const msg = JSON.parse(line) as Record<string, unknown>;
    if ("id" in msg && ("result" in msg || "error" in msg)) {
      const p = pending.get(Number(msg.id));
      if (!p) return;
      pending.delete(Number(msg.id));
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result as Record<string, unknown>);
      return;
    }
    if (typeof msg.method === "string")
      notes.push({ method: msg.method, params: msg.params });
  });
  const client: RpcClient = {
    socket,
    notes,
    request: (method, params, sessionId) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        const envelope = {
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        };
        socket.write(`${JSON.stringify(envelope)}\n`);
      }),
    waitForNotification: async (method, timeout = 60_000) => {
      const deadline = Date.now() + timeout;
      for (;;) {
        const found = notes.find((n) => n.method === method);
        if (found) return found.params;
        if (Date.now() > deadline)
          throw new Error(
            `Timed out waiting for "${method}". Notifications: ${JSON.stringify(notes.map((n) => n.method))}`,
          );
        await new Promise((r) => setTimeout(r, 50));
      }
    },
  };
  clients.push(client);
  return client;
}

function git(...args: string[]): void {
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    cwd: REPO,
    stdio: "ignore",
  });
}

beforeAll(async () => {
  fs.mkdirSync(HOME, { recursive: true });
  fs.mkdirSync(SUB, { recursive: true });

  // A real linked worktree, so `deriveWorktreeInfo` (pure fs: `.git` file →
  // gitdir → commondir) has real on-disk state to read.
  git("init", "-q", "-b", "main");
  git("commit", "-q", "--allow-empty", "-m", "base");
  git("worktree", "add", "-q", "-b", "feat", WORKTREE);

  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  const port = (model.address() as net.AddressInfo).port;

  daemon = spawn(process.execPath, [CLI, "--daemon", SOCKET], {
    env: {
      ...process.env,
      // A throwaway HOME: sessions, transcripts and the daemon socket all live
      // under it, so nothing touches the developer's ~/.wave.
      HOME,
      USERPROFILE: HOME,
      WAVE_LOGS_DIR: path.join(HOME, ".wave", "logs"),
      DISABLE_LOGGER_IO: "true",
      WAVE_API_KEY: "test-key",
      WAVE_BASE_URL: `http://127.0.0.1:${port}/v1`,
      WAVE_MODEL: "test-model",
      WAVE_FAST_MODEL: "test-model",
    },
    stdio: "ignore",
  });

  const deadline = Date.now() + 60_000;
  while (!fs.existsSync(SOCKET)) {
    if (Date.now() > deadline) throw new Error("daemon socket never appeared");
    await new Promise((r) => setTimeout(r, 100));
  }
}, 90_000);

afterAll(async () => {
  for (const c of clients) c.socket.destroy();
  clients = [];
  // The daemon is resident by design (it outlives every client), so nothing
  // shuts it down on its own — kill it. No graceful `shutdown` RPC here: it
  // awaits a reply that races the process teardown, and this suite has no
  // transcript worth flushing.
  daemon?.kill("SIGKILL");
  model.closeAllConnections();
  await new Promise<void>((resolve) => model.close(() => resolve()));
  fs.rmSync(ROOT, { recursive: true, force: true });
}, 30_000);

describe("real daemon · re-attach reports the session root", () => {
  test("a session whose cwd drifted reports its creation dir, not the drifted one", async () => {
    const first = connect();
    const created = await first.request("initialize", {
      workdir: REPO,
      permissionMode: "bypassPermissions",
    });
    const sessionId = created.sessionId as string;
    expect(created.sessionCwd).toBe(real(REPO));

    // One real turn: the fake model asks for `cd sub`, the real Bash tool
    // runs it, and the session reports its new cwd.
    await first.request("sendMessage", { text: "go" }, sessionId);
    const drift = (await first.waitForNotification("workdirChange")) as {
      workdir: string;
    };
    expect(drift.workdir).toBe(real(SUB));

    // Client detaches — the desktop app quits, the daemon keeps the session.
    first.socket.destroy();
    await new Promise((r) => setTimeout(r, 300));

    // A fresh client re-attaches, exactly like `/resume` after a restart.
    const second = connect();
    const resumed = await second.request("initialize", {
      workdir: REPO,
      restoreSessionId: sessionId,
    });

    // Same live agent (no duplicate writer on one transcript)…
    expect(resumed.sessionId).toBe(sessionId);
    // …the drifted cwd is still reported as "where the user is now"…
    expect(resumed.currentWorkdir).toBe(real(SUB));
    // …but the project root the host groups by is the creation dir.
    expect(resumed.sessionCwd).toBe(real(REPO));
    // Not a worktree, so no repo root to fold into.
    expect(resumed.repoRoot).toBeUndefined();
  }, 120_000);

  test("a worktree session reports the main repo root so the host can group it", async () => {
    const client = connect();
    const created = await client.request("initialize", {
      workdir: WORKTREE,
      permissionMode: "bypassPermissions",
    });
    const sessionId = created.sessionId as string;
    // The session's own root stays the worktree…
    expect(created.sessionCwd).toBe(real(WORKTREE));
    // …and the repo root is what the sidebar groups by.
    expect(created.repoRoot).toBe(real(REPO));

    const resumed = await client.request("initialize", {
      workdir: WORKTREE,
      restoreSessionId: sessionId,
    });
    expect(resumed.sessionId).toBe(sessionId);
    expect(resumed.sessionCwd).toBe(real(WORKTREE));
    expect(resumed.repoRoot).toBe(real(REPO));
  }, 120_000);
});

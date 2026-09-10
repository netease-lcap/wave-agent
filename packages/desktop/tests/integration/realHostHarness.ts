/**
 * Harness for the real-host integration suite (Part B).
 *
 * Boots the *real* `DesktopHost` (real fs, real JSON-RPC, real `wave --stdio`
 * child process) and captures the host→webview message stream. Only the
 * Electron shell is stubbed — see the vitest integration config.
 *
 * Also provides a throwaway local model server so a full turn
 * (sendMessage → CLI → model HTTP → streamed reply → webview message) can run
 * offline and deterministically instead of calling a real LLM.
 */

import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import type { BrowserWindow } from "electron";
import { HOST_CHANNEL } from "../../src/main/channels";
import { ConfigStore } from "../../src/main/configStore";
import { DesktopHost } from "../../src/main/desktopHost";
import { LOCAL_HOST } from "../../src/main/sshHosts";

/** Must match `vitest.integration.config.ts`. */
export const REALHOST_ROOT = path.join(os.tmpdir(), "wave-desktop-realhost");
export const REALHOST_HOME = path.join(REALHOST_ROOT, "home");
export const STORE_PATH = path.join(
  REALHOST_ROOT,
  "userData",
  "wave-desktop.json",
);

export const DIR_A = path.join(REALHOST_ROOT, "ws", "project-a");
export const DIR_B = path.join(REALHOST_ROOT, "ws", "project-b");

/** A host→webview message (shape is asserted per test). */
export type HostMessage = Record<string, unknown> & { command?: string };

/**
 * Wipe the throwaway HOME/userData and recreate the two workspaces. Returns
 * the realpath'd workdirs: the CLI encodes the session directory from the
 * resolved path, so tests must use the same form or transcript files land in
 * an unexpected bucket.
 */
export function resetRealHostState(): { dirA: string; dirB: string } {
  fs.rmSync(REALHOST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(REALHOST_HOME, { recursive: true });
  fs.mkdirSync(DIR_A, { recursive: true });
  fs.mkdirSync(DIR_B, { recursive: true });
  return {
    dirA: fs.realpathSync(DIR_A),
    dirB: fs.realpathSync(DIR_B),
  };
}

/**
 * `<HOME>/.wave/projects/<encoded workdir>` — mirrors the CLI's
 * `pathEncoder.encodeSync` (strip the leading separator, `/`→`-`, spaces→`_`).
 */
export function projectDir(workdir: string): string {
  const encoded = workdir
    .replace(/^[/\\]/, "")
    .replace(/[/\\]/g, "-")
    .replace(/\s+/g, "_");
  return path.join(REALHOST_HOME, ".wave", "projects", encoded);
}

/** All transcript files for a workdir, newest last. */
export function transcriptFiles(workdir: string): string[] {
  const dir = projectDir(workdir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(dir, f));
}

/** Rewrite a transcript with a truncated tail (a killed append — PR #2137). */
export function truncateTranscriptTail(workdir: string): void {
  const files = transcriptFiles(workdir);
  const file = files[files.length - 1];
  const content = fs.readFileSync(file, "utf-8");
  fs.writeFileSync(
    file,
    `${content}{"type":"assistant","id":"cut-off","blocks":[{"type":"te`,
    "utf-8",
  );
}

/** Flat view of a `desktopSessionTree` push. */
export interface TreeSession {
  sessionId: string;
  title: string;
  workdir: string;
}

export interface RealHost {
  host: DesktopHost;
  store: ConfigStore;
  /** Every host→webview message, in order. */
  messages: HostMessage[];
  /** Messages with the given command. */
  of<M extends HostMessage = HostMessage>(command: string): M[];
  /** Latest message with the given command. */
  last<M extends HostMessage = HostMessage>(command: string): M | undefined;
  /** Messages containing a command, in order, resolved when it appears. */
  waitFor<M extends HostMessage = HostMessage>(
    command: string,
    opts?: { timeout?: number; predicate?: (m: M) => boolean },
  ): Promise<M>;
  /** Drop the recorded messages — call before an action so waits can't match a stale one. */
  clear(): void;
  /** The session the pane currently shows (undefined when unbound). */
  paneSessionId(paneId?: string): string | undefined;
  /** Sessions from the latest `desktopSessionTree`. */
  tree(): TreeSession[];
  /** Everything the host streamed into a pane (concatenated updateStreamingContent chunks). */
  streamedText(paneId?: string): string;
  /** Run one real turn in a pane; resolves with the messages it produced. */
  turn(text: string, paneId?: string): Promise<HostMessage[]>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Unhandled-rejection guard
// ---------------------------------------------------------------------------

/**
 * The real CLI rejects in-flight RPCs with "Session not found" while it is
 * recreating a session (`updateConfig` → destroy + `Agent.create`), which the
 * host triggers for every live agent on a settings write / login / plugin
 * change — and `backgroundTasksChange` notifications reach the host during that
 * same window. Any host-side promise that forgets a catch therefore surfaces
 * here as an unhandled rejection (fatal under Node's default policy), and the
 * unit layer can never see it because every RPC is mocked there.
 *
 * The suite registers its own listener (so the leak survives long enough to be
 * reported) and fails the test for *any* rejection — there is no allow-list:
 * the one known leak (refreshWorkflowRuns) is fixed, so a new one must be red.
 * Vitest additionally fails the run on unhandled errors, since
 * `dangerouslyIgnoreUnhandledErrors` is NOT set in the integration config.
 */
const unexpectedRejections: unknown[] = [];

process.on("unhandledRejection", (reason) => {
  unexpectedRejections.push(reason);
});

/** Drops the rejections seen so far — call before the action under test. */
export function takeUnexpectedRejections(): unknown[] {
  return unexpectedRejections.splice(0, unexpectedRejections.length);
}

/** Call from `afterEach`: fails the test when the host leaked a rejection. */
export function assertNoUnexpectedRejections(): void {
  const leaked = takeUnexpectedRejections();
  if (leaked.length === 0) return;
  const details = leaked
    .map((r) => (r instanceof Error ? (r.stack ?? r.message) : String(r)))
    .join("\n---\n");
  throw new Error(
    `Unexpected unhandled rejection(s) from the host:\n${details}`,
  );
}

export function createRealHost(): RealHost {
  const store = new ConfigStore(STORE_PATH);
  const host = new DesktopHost(store);
  const messages: HostMessage[] = [];
  /**
   * pane → sessionId, kept OUTSIDE `messages` so it survives `clear()` (tests
   * clear the buffer between turns to keep waits unambiguous, but still need
   * to ask which session a pane shows).
   */
  const paneBindings = new Map<string, string | undefined>();
  /** Survives `clear()` for the same reason as `paneBindings`. */
  let focusedPane = "pane-1";
  const win = {
    webContents: {
      send: (channel: string, msg: unknown) => {
        if (channel !== HOST_CHANNEL) return;
        const m = msg as HostMessage;
        messages.push(m);
        if (m.command === "desktopPanes") {
          if (typeof m.focusedPaneId === "string")
            focusedPane = m.focusedPaneId;
          for (const p of m.panes as Array<{
            paneId: string;
            sessionId?: string;
          }>) {
            paneBindings.set(p.paneId, p.sessionId);
          }
        } else if (m.command === "updateCurrentSession") {
          paneBindings.set(
            m.paneId as string,
            (m.session as { id?: string } | undefined)?.id,
          );
        }
      },
    },
    isDestroyed: () => false,
    getContentSize: () => [1440, 900],
  } as unknown as BrowserWindow;
  host.setMainWindow(win);

  const of = <M extends HostMessage = HostMessage>(command: string) =>
    messages.filter((m) => m.command === command) as M[];

  const waitUntil = async (
    label: string,
    predicate: () => boolean,
    opts: { timeout?: number } = {},
  ): Promise<void> => {
    const deadline = Date.now() + (opts.timeout ?? 30_000);
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(
      `Timed out waiting for ${label}. Messages: ${JSON.stringify(messages.slice(-12), null, 2)}`,
    );
  };

  const waitFor = async <M extends HostMessage = HostMessage>(
    command: string,
    opts: { timeout?: number; predicate?: (m: M) => boolean } = {},
  ): Promise<M> => {
    const deadline = Date.now() + (opts.timeout ?? 30_000);
    for (;;) {
      const found = of<M>(command).find((m) => opts.predicate?.(m) ?? true);
      if (found) return found;
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(
      `Timed out waiting for "${command}". Messages: ${JSON.stringify(messages.slice(-12), null, 2)}`,
    );
  };

  const focusedPaneId = () => focusedPane;

  const paneSessionId = (paneId?: string) =>
    paneBindings.get(paneId ?? focusedPaneId());

  const tree = (): TreeSession[] =>
    (
      (of("desktopSessionTree").at(-1)?.groups ?? []) as Array<{
        workdir: string;
        sessions: Array<{ sessionId: string; title: string }>;
      }>
    ).flatMap((g) =>
      g.sessions.map((s) => ({
        sessionId: s.sessionId,
        title: s.title,
        workdir: g.workdir,
      })),
    );

  const streamedText = (paneId?: string) =>
    messages
      .filter(
        (m) =>
          m.command === "updateStreamingContent" &&
          (paneId === undefined || m.paneId === paneId),
      )
      .map((m) => (m.chunk as string) ?? "")
      .join("");

  const turn = async (
    text: string,
    paneId?: string,
  ): Promise<HostMessage[]> => {
    await waitFor("setInitialState", {
      predicate: (m) => paneId === undefined || m.paneId === paneId,
    });
    const start = messages.length;
    await host.handleWebviewMessage({
      command: "sendMessage",
      text,
      ...(paneId ? { paneId } : {}),
    });
    await waitUntil("turn end", () =>
      messages
        .slice(start)
        .some(
          (m) =>
            m.command === "endStreaming" &&
            (paneId === undefined || m.paneId === paneId),
        ),
    );
    return messages.slice(start);
  };

  const clear = () => {
    messages.length = 0;
  };

  return {
    host,
    store,
    messages,
    of,
    last: (command: string) => of(command).at(-1),
    waitFor,
    clear,
    paneSessionId,
    tree,
    streamedText,
    turn,
    close: async () => {
      await host.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Local model server — an OpenAI-compatible /chat/completions endpoint
// ---------------------------------------------------------------------------

export interface FakeModelServer {
  /** Point configuration.baseURL here. */
  baseURL: string;
  /** Raw request bodies the CLI sent (order = call order). */
  requests: Array<Record<string, unknown>>;
  /** Queue the text the model streams back; the last reply repeats. */
  reply(...texts: string[]): void;
  /** Requests received so far that carried this substring in the payload. */
  sawRequest(match: string): boolean;
  close(): Promise<void>;
}

export async function startFakeModelServer(): Promise<FakeModelServer> {
  const requests: Array<Record<string, unknown>> = [];
  let replies: string[] = ["OK"];

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        requests.push(JSON.parse(body) as Record<string, unknown>);
      } catch {
        requests.push({ raw: body });
      }
      const text =
        replies.length > 1 ? (replies.shift() as string) : replies[0];
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      const chunk = (delta: unknown, extra: Record<string, unknown> = {}) =>
        res.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-realhost",
            object: "chat.completion.chunk",
            created: 1_700_000_000,
            model: "test-model",
            choices: [{ index: 0, delta, finish_reason: null }],
            ...extra,
          })}\n\n`,
        );
      chunk({ role: "assistant", content: text });
      chunk({}, { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    requests,
    reply: (...texts: string[]) => {
      replies = texts;
    },
    sawRequest: (match: string) =>
      requests.some((r) => JSON.stringify(r).includes(match)),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export { LOCAL_HOST };

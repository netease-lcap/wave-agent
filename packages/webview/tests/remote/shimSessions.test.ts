/**
 * The remote page's shim, driven the way a browser drives it: a stub WebSocket
 * on one side, the shared UI's `acquireVsCodeApi()` on the other.
 *
 * The shim ships as plain browser JS with no build step and no module system, so
 * the tests load the shipped file itself (`remote/shim.js`) rather than a copy —
 * what is under test is the thing that ships.
 *
 * The relay is device-level: one socket carries every session the serving
 * process holds, and the envelope's `sessionId` is the only thing that says
 * which conversation a frame belongs to. So the interesting cases here are all
 * about *misattribution* — another session's frames, a switch that overtakes an
 * in-flight reply, a stale pin from the address.
 *
 * Scope split with the sibling `shim.test.ts`: that file owns the login hop
 * (`location.replace`, which jsdom performs as a no-op), this one owns everything
 * that goes over the socket. jsdom is what makes the latter drivable — real
 * promises, timers and `window.dispatchEvent` for the host→page direction.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const SHIM = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../remote/shim.js"),
  "utf8",
);

type Frame = Record<string, unknown>;

const SESSIONS = [
  {
    sessionId: "s-old",
    sessionCwd: "/tmp/other",
    lastActiveAt: "2026-10-14T09:00:00.000Z",
  },
  {
    sessionId: "s-new",
    sessionCwd: "/repo",
    customTitle: "登录页",
    lastActiveAt: "2026-10-14T10:00:00.000Z",
  },
];

const SEED = { id: "m1", role: "user", blocks: [] };

/** A request waiting on the machine, in the shape `listPendingPermissions` returns. */
const QUESTION_PENDING = {
  requestId: "req-auq",
  context: {
    toolName: "AskUserQuestion",
    toolInput: { questions: [{ question: "先做哪个？" }] },
  },
};

/** The same shape for an ordinary tool approval, which needs no options to be
 *  answerable — it is here to pin the card arithmetic, not the dialog. */
const BASH_PENDING = {
  requestId: "req-bash",
  context: { toolName: "Bash", toolInput: { command: "rm -rf build" } },
};

/** Stands in for the relay's socket: frames out are recorded, frames in are pushed. */
class FakeSocket {
  static opened: FakeSocket[] = [];
  readonly sent: string[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.opened.push(this);
  }

  send(line: string) {
    this.sent.push(line);
  }

  /** The relay completed the handshake. */
  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  /** The relay pushed one frame at the page. */
  receive(frame: Frame) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  frames(): Frame[] {
    return this.sent.map((line) => JSON.parse(line) as Frame);
  }

  /** Requests for one method, in the order they went out. */
  framesFor(method: string): Frame[] {
    return this.frames().filter((frame) => frame.method === method);
  }
}

let messageListeners: Array<(event: MessageEvent) => void> = [];

/**
 * Load the page in a browser-like environment and complete the handshake — unless
 * the caller passes `handshake: false` to observe the pre-handshake state itself.
 */
function startPage(search: string, handshake = true) {
  const posted: Frame[] = [];
  const listener = (event: MessageEvent) => posted.push(event.data as Frame);
  messageListeners.push(listener);
  window.addEventListener("message", listener);

  window.history.replaceState({}, "", "/remote/" + search);
  window.localStorage.setItem("token", "sso-token");

  new Function(SHIM)();
  const socket = FakeSocket.opened[FakeSocket.opened.length - 1];
  if (handshake) {
    socket.open();
    socket.receive({ type: "auth_ok" });
  }

  const answered = new Set<unknown>();
  return {
    socket,
    posted,
    api: (
      window as unknown as {
        acquireVsCodeApi(): { postMessage(msg: unknown): void };
      }
    ).acquireVsCodeApi(),
    /** How many requests for `method` the page has sent so far. */
    requests: (method: string) => socket.framesFor(method).length,
    /**
     * Reply to the oldest unanswered request for `method`, as the machine would,
     * and let the page take its next step before returning.
     *
     * The machine answers in the JSON-RPC envelope — `{id, method:"result",
     * params:{result}}` (see `RemoteControlService.sendResult`) — not with a
     * bare `result` field. The bare shape is what an earlier version of this
     * harness used, and it is exactly the shape the page could not read: every
     * reply silently resolved to `undefined`.
     */
    async answer(method: string, result: unknown) {
      const frame = nextFrame(method);
      socket.receive({ id: frame.id, method: "result", params: { result } });
      await flush();
      return frame;
    },
    /** Refuse the oldest unanswered request for `method`, as a machine would. */
    async refuse(method: string, message: string) {
      const frame = nextFrame(method);
      socket.receive({
        id: frame.id,
        method: "error",
        params: { code: -32603, message },
      });
      await flush();
      return frame;
    },
  };

  function nextFrame(method: string) {
    const frame = socket
      .framesFor(method)
      .find((candidate) => !answered.has(candidate.id));
    if (!frame) throw new Error(`the page never sent a ${method} request`);
    answered.add(frame.id);
    return frame;
  }
}

/** Let the promises inside the shim settle. */
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

/** The last message the page handed to the shared UI. */
function lastPosted(page: { posted: Frame[] }) {
  return page.posted[page.posted.length - 1];
}

/**
 * Answer the newest request for `method` on `socket`, as the machine would.
 *
 * A reconnect replaces the socket, so the harness' `answer` — bound to the socket
 * the page started on — does not apply to anything sent after it, and the shim
 * ignores frames from a socket that is no longer the current one.
 */
function answerOn(socket: FakeSocket, method: string, result: unknown) {
  const frames = socket.framesFor(method);
  socket.receive({
    id: frames[frames.length - 1]?.id,
    method: "result",
    params: { result },
  });
}

/** The status line's close (×), or null when the line is not on screen. */
function statusClose(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    '#remote-status button[aria-label="关闭"]',
  );
}

/**
 * Drop the link the way a sleeping phone does, and let the page's retry open the
 * next one. Everything from here on goes over the returned socket.
 *
 * The retry backoff doubles per drop (2s → 4s → …, capped at 30s), so the wait
 * is advanced adaptively — a test that reconnects twice still lands.
 */
async function reconnect(current: FakeSocket) {
  current.onclose?.({ code: 1006 });
  const before = FakeSocket.opened.length;
  for (let waited = 0; waited < 31000; waited += 500) {
    await vi.advanceTimersByTimeAsync(500);
    if (FakeSocket.opened.length > before) break;
  }
  const next = FakeSocket.opened[FakeSocket.opened.length - 1];
  next.open();
  next.receive({ type: "auth_ok" });
  await flush();
  return next;
}

/** Answer the reads a reconnect makes — messages by delta, the states from
 *  their own registries — as the machine would. */
async function answerRereads(socket: FakeSocket, requests: Frame[] = []) {
  answerOn(socket, "getMessages", { messages: [] });
  answerOn(socket, "listDaemonSessions", { sessions: SESSIONS });
  answerOn(socket, "getSessionInfo", {
    sessionId: "s-new",
    permissionMode: "default",
  });
  answerOn(socket, "listPendingPermissions", { requests });
  answerOn(socket, "getWorkflowRuns", { runs: [] });
  await flush();
}

/**
 * Boot + mount (webviewReady) + first snapshot, i.e. the page as the phone sees it.
 *
 * `permissionMode` is what the machine answers the snapshot's session-state read
 * with; `family` adds the rest of the state family the same reply carries
 * (scenario 26 — `contextUsagePercent` is stripped out of it and attached to the
 * `getMessages` reply, where the machine actually puts it). Every re-alignment
 * asks for these — the adapter only pushes the *changes* — so a harness that
 * stayed silent would leave those reads to time out and put a warning on the
 * suite's stderr.
 */
async function openPage(
  search = "?host=h-1",
  permissionMode = "default",
  family: Frame = {},
) {
  const page = startPage(search);
  await flush();
  page.api.postMessage({ command: "webviewReady" });
  await flush();
  await page.answer("listDaemonSessions", { sessions: SESSIONS });
  const { contextUsagePercent, ...info } = family as {
    contextUsagePercent?: number;
  };
  await page.answer("getSessionInfo", {
    sessionId: "s-new",
    permissionMode,
    ...info,
  });
  const pull = await page.answer("getMessages", {
    messages: [SEED],
    ...(typeof contextUsagePercent === "number" ? { contextUsagePercent } : {}),
  });
  await page.answer("listPendingPermissions", { requests: [] });
  // 工作流运行：没有变化推送源，所以每条对齐路径各读一次（`/workflows` 弹窗
  // 的数据）。答空表即可——本轮用例不关心它，但不答会留下超时警告。
  await page.answer("getWorkflowRuns", { runs: [] });
  return { page, pull };
}

beforeEach(() => {
  FakeSocket.opened = [];
  messageListeners = [];
  // A real page load starts from a fresh document; jsdom reuses one, and the
  // shim's status banner is a plain DOM node it never removes on teardown.
  document.getElementById("remote-status")?.remove();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  for (const listener of messageListeners) {
    window.removeEventListener("message", listener);
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("remote page shim", () => {
  test("sends the handshake first and holds every request behind it", async () => {
    const page = startPage("?host=h-1", false);
    page.socket.open();

    // The relay parses **every** frame as `auth` while the connection is
    // unauthenticated, and a parse failure is a permanent 4003 — so the
    // handshake owns the first frame.
    expect(page.socket.frames()).toEqual([
      {
        type: "auth",
        credential: { type: "sso", token: "sso-token" },
        version: "",
      },
    ]);

    // The app mounts before the handshake is answered; its requests wait.
    page.api.postMessage({ command: "webviewReady" });
    await flush();
    expect(page.socket.frames()).toHaveLength(1);

    page.socket.receive({ type: "auth_ok" });
    await flush();
    expect(page.requests("listDaemonSessions")).toBe(1);
  });

  test("a machine that cannot list its sessions says so instead of going blank", async () => {
    const page = startPage("?host=h-1");
    await flush();
    page.api.postMessage({ command: "webviewReady" });
    await flush();

    // The likeliest cause is a machine older than this page: the page is served
    // centrally, so the method sits behind the machine's own remote allowlist and
    // the relay's version floor is what is supposed to catch the mismatch first.
    await page.refuse("listDaemonSessions", "Method not allowed");

    expect(document.getElementById("remote-status")?.textContent).toContain(
      "读不到电脑侧的会话列表",
    );
  });

  test("says what is missing when the page has no enterprise login", async () => {
    window.history.replaceState({}, "", "/remote/?host=h-1");
    window.localStorage.setItem("token", "");

    new Function(SHIM)();
    // Boot asks whether the enterprise gave it anything to renew with before it
    // decides the credential is missing, so the verdict lands a turn later.
    await flush();

    // Nothing to connect with, so nothing is attempted.
    expect(FakeSocket.opened).toHaveLength(0);
    expect(document.getElementById("remote-status")?.textContent).toContain(
      "请先在企业端登录",
    );
  });

  test("boots with the auth frame and lists the sessions the process is running", async () => {
    const page = startPage("?host=h-1");
    await flush();

    // No address to configure: the page is served from the relay's own domain.
    expect(page.socket.url).toBe(
      "ws://localhost:3000/v1/hosts/ws/h-1/subscribe",
    );
    expect(page.socket.frames()[0]).toEqual({
      type: "auth",
      credential: { type: "sso", token: "sso-token" },
      version: "",
    });

    page.api.postMessage({ command: "webviewReady" });
    await flush();

    // The list is the machine's live registry, never the on-disk transcripts:
    // reading requires the session to be live in the serving process, so a disk
    // entry would fail the moment it is tapped.
    expect(page.requests("listSessions")).toBe(0);
    expect(page.requests("listDaemonSessions")).toBe(1);

    await page.answer("listDaemonSessions", { sessions: SESSIONS });
    // The snapshot chain's session-state read (scenario 26) sits between the
    // registry and the message pull.
    await page.answer("getSessionInfo", {
      sessionId: "s-new",
      permissionMode: "default",
    });

    // Most recently active wins: the page cannot see the computer's screen, so
    // that is the only ordering signal it has.
    const pull = await page.answer("getMessages", { messages: [SEED] });
    expect(pull.sessionId).toBe("s-new");
    // The first page is sized by the frame BUDGET, not by "300 looks like
    // enough": at the measured 5.7 KB/message 100 messages ≈ 0.57 MB already
    // sits at the 512 KiB budget, and the relay drops an over-buffer frame
    // without an error.
    expect(pull.params).toEqual({ limit: 100 });

    await page.answer("listPendingPermissions", { requests: [] });

    expect(lastPosted(page)).toMatchObject({
      command: "setInitialState",
      session: { id: "s-new", workdir: "/repo", customTitle: "登录页" },
      sessions: [{ id: "s-new" }, { id: "s-old", workdir: "/tmp/other" }],
      // The relay authenticated this page with the machine's own credential;
      // there is no separate phone login to satisfy.
      isAuthenticated: true,
    });
  });

  test("drops another session's frames, its approval card included", async () => {
    const { page } = await openPage();
    const before = page.posted.length;

    page.socket.receive({
      method: "assistantMessageAdded",
      params: { message: { id: "other-1" } },
      sessionId: "s-old",
    });
    expect(page.posted.slice(before)).toHaveLength(0);

    page.socket.receive({
      method: "assistantMessageAdded",
      params: { message: { id: "mine-1" } },
      sessionId: "s-new",
    });
    expect(lastPosted(page)).toMatchObject({
      command: "appendMessage",
      message: { id: "mine-1" },
    });

    // An approval in another conversation is a fact — but its *card* is not
    // deliverable: the card says the tool and its input, never which conversation
    // asked, so answering it here answers in someone else's context (the
    // 2026-10-15 report) and can even hide this conversation's own card behind
    // it. The wait surfaces on the session list instead.
    page.socket.receive({
      method: "permissionRequest",
      params: { requestId: "r1", context: { toolName: "AskUserQuestion" } },
      sessionId: "s-old",
    });
    expect(
      page.posted.filter((message) => message.command === "showConfirmation"),
    ).toHaveLength(0);
    expect(lastPosted(page)).toMatchObject({
      command: "updateSessionStatus",
      waiting: ["s-old"],
      running: [],
    });

    // The same frame for the conversation on screen is still a card, and it is
    // named as belonging to this one: 「待确认」 on the list covers the rest.
    page.socket.receive({
      method: "permissionRequest",
      params: { requestId: "r2", context: { toolName: "Bash" } },
      sessionId: "s-new",
    });
    expect(lastPosted(page)).toMatchObject({
      command: "showConfirmation",
      confirmationId: "r2",
      toolName: "Bash",
    });
  });

  test("a snapshot keeps another conversation's approval out of the card queue", async () => {
    const { page } = await openPage();

    // The registry reports every session's requests, and this is the path a cold
    // start takes — the one the user reported seeing another conversation's
    // `AskUserQuestion` on. Only the requests owned by the session on screen
    // become cards; the others become the list's 「待确认」 marker.
    const next = await reconnect(page.socket);
    await answerRereads(next, [
      { ...QUESTION_PENDING, sessionId: "s-old" },
      { ...BASH_PENDING, sessionId: "s-new" },
    ]);

    expect(
      page.posted.filter((message) => message.command === "showConfirmation"),
    ).toEqual([
      expect.objectContaining({ confirmationId: "req-bash", toolName: "Bash" }),
    ]);

    // Both owners reach the list, the one whose card was dropped included: that
    // marker is the whole reason the card could be dropped safely.
    expect(
      page.posted.filter(
        (message) => message.command === "updateSessionStatus",
      ),
    ).toContainEqual(expect.objectContaining({ waiting: ["s-old", "s-new"] }));
  });

  test("the session list hears who is waiting and who is running", async () => {
    const { page } = await openPage();
    const markers = () =>
      page.posted.filter(
        (message) => message.command === "updateSessionStatus",
      ) as Array<{ waiting: string[]; running: string[] }>;

    // The snapshot carries the pair with the list it describes (one read, one
    // paint): s-new is generating in the registry, nothing is waiting.
    page.api.postMessage({ command: "restoreSession", sessionId: "s-old" });
    await flush();
    await page.answer("listDaemonSessions", {
      sessions: [
        { sessionId: "s-old", sessionCwd: "/tmp/other" },
        { sessionId: "s-new", sessionCwd: "/repo", isLoading: true },
      ],
    });
    await page.answer("getSessionInfo", { permissionMode: "default" });
    await page.answer("getMessages", { messages: [SEED] });
    await page.answer("listPendingPermissions", { requests: [] });
    expect(lastPosted(page)).toMatchObject({
      command: "setInitialState",
      sessionStatus: { waiting: [], running: ["s-new"] },
    });

    // A turn starting in the conversation on screen moves its own marker, without
    // waiting for the next registry read — and the current session is marked too
    // (the desktop sidebar's one deliberate exception: 「我正在看的这条还在不在
    // 跑」 is exactly what a list of conversations has to answer).
    page.socket.receive({
      method: "loadingChange",
      params: { loading: true },
      sessionId: "s-old",
    });
    await flush();
    expect(markers()[markers().length - 1]).toMatchObject({
      running: ["s-new", "s-old"],
    });

    page.socket.receive({
      method: "loadingChange",
      params: { loading: false },
      sessionId: "s-old",
    });
    await flush();
    expect(markers()[markers().length - 1]).toMatchObject({
      running: ["s-new"],
    });
  });

  test("a reconnect re-reads both markers, not only the one with a notification", async () => {
    const { page } = await openPage();

    // 「待确认」 has no transition to catch (the request asked while the link was
    // down) and 「运行中」 is a *state* the registry holds — both come from the two
    // reads every re-alignment already makes, so neither adds an RPC.
    const next = await reconnect(page.socket);
    await answerRereads(next, [{ ...QUESTION_PENDING, sessionId: "s-old" }]);

    expect(
      page.posted.filter(
        (message) => message.command === "updateSessionStatus",
      ),
    ).toContainEqual(
      expect.objectContaining({ waiting: ["s-old"], running: [] }),
    );
  });

  test("the picker switches the page's own view without touching the computer", async () => {
    const { page } = await openPage();

    page.api.postMessage({ command: "restoreSession", sessionId: "s-old" });
    await flush();

    // "Show me that conversation here" is answered locally on purpose: the
    // machine's own restoreSession is an *in-place* load, which on a desktop host
    // swaps the conversation the user is looking at.
    expect(page.requests("restoreSession")).toBe(0);

    // The switch re-reads the registry first: a session can end while the picker
    // sits open, and an id that is gone only produces "Session not found".
    await page.answer("listDaemonSessions", { sessions: SESSIONS });
    await page.answer("getSessionInfo", {
      sessionId: "s-old",
      permissionMode: "default",
    });

    const pull = await page.answer("getMessages", {
      messages: [{ id: "old-1", role: "user", blocks: [] }],
    });
    expect(pull.sessionId).toBe("s-old");
    // A switch re-reads from scratch: the window the page held belongs to the
    // session it just left.
    expect(pull.params).toEqual({ limit: 100 });

    await page.answer("listPendingPermissions", { requests: [] });
    expect(lastPosted(page)).toMatchObject({
      command: "setInitialState",
      session: { id: "s-old" },
      messages: [{ id: "old-1" }],
    });
  });

  test("a session that is no longer running is refused, not silently opened", async () => {
    const { page } = await openPage();
    const pulls = page.requests("getMessages");

    page.api.postMessage({ command: "restoreSession", sessionId: "s-gone" });
    await flush();

    expect(page.requests("getMessages")).toBe(pulls);
    expect(document.getElementById("remote-status")?.textContent).toContain(
      "不在电脑侧的运行中",
    );
  });

  test("both spellings of the change signal re-read only what was appended", async () => {
    const { page } = await openPage();

    page.socket.receive({
      method: "messagesChange",
      params: {},
      sessionId: "s-new",
    });
    await flush();
    const delta = await page.answer("getMessages", {
      messages: [{ id: "m2", role: "assistant", blocks: [] }],
    });
    expect(delta.params).toMatchObject({ since: "m1" });
    expect(lastPosted(page)).toMatchObject({
      command: "updateMessages",
      messages: [{ id: "m1" }, { id: "m2" }],
    });

    // A machine older than the rename still says `messagesChanged`; the page
    // speaks both so it stays connectable either way.
    page.socket.receive({
      method: "messagesChanged",
      params: {},
      sessionId: "s-new",
    });
    await flush();
    expect(
      (await page.answer("getMessages", { messages: [] })).params,
    ).toMatchObject({
      since: "m2",
    });

    // The other shape of the same method carries the whole array — a host
    // snapshot, which replaces the window instead of asking for one.
    const pulls = page.requests("getMessages");
    page.socket.receive({
      method: "messagesChange",
      params: { messages: [{ id: "solo", role: "user", blocks: [] }] },
      sessionId: "s-new",
    });
    expect(lastPosted(page)).toMatchObject({
      command: "updateMessages",
      messages: [{ id: "solo" }],
    });
    expect(page.requests("getMessages")).toBe(pulls);
  });

  test("a ?session= pin is honored while that session is live, else the newest wins", async () => {
    const pinned = startPage("?host=h-1&session=s-old");
    await flush();
    pinned.api.postMessage({ command: "webviewReady" });
    await flush();
    await pinned.answer("listDaemonSessions", { sessions: SESSIONS });
    await pinned.answer("getSessionInfo", {
      sessionId: "s-old",
      permissionMode: "default",
    });
    expect(
      (await pinned.answer("getMessages", { messages: [] })).sessionId,
    ).toBe("s-old");

    // The pin is a name, not an authority: it never makes an unopened session
    // openable.
    const stale = startPage("?host=h-1&session=s-gone");
    await flush();
    stale.api.postMessage({ command: "webviewReady" });
    await flush();
    await stale.answer("listDaemonSessions", { sessions: SESSIONS });
    await stale.answer("getSessionInfo", {
      sessionId: "s-new",
      permissionMode: "default",
    });
    expect(
      (await stale.answer("getMessages", { messages: [] })).sessionId,
    ).toBe("s-new");
  });

  test("a page that arrives mid-turn still offers the stop button", async () => {
    const page = startPage("?host=h-1");
    await flush();
    page.api.postMessage({ command: "webviewReady" });
    await flush();

    // The turn has been running since before this page existed. `loadingChange`
    // is a *transition* — the one that started this turn was delivered to
    // nobody — so the machine's registry is the only place the page can learn
    // it is mid-turn.
    await page.answer("listDaemonSessions", {
      sessions: [{ ...SESSIONS[1], isLoading: true }, SESSIONS[0]],
    });
    await page.answer("getSessionInfo", {
      sessionId: "s-new",
      permissionMode: "default",
    });
    await page.answer("getMessages", { messages: [SEED] });
    await page.answer("listPendingPermissions", { requests: [] });

    expect(page.posted).toContainEqual({ command: "startStreaming" });
    expect(
      page.posted.find((message) => message.command === "setInitialState"),
    ).toMatchObject({ isStreaming: true });

    // A phone has no Escape key, so this flag is the only way to reach the
    // abort — and the abort has to actually go out.
    page.api.postMessage({ command: "abortMessage" });
    await flush();
    expect(page.requests("abortMessage")).toBe(1);
  });

  test("serves /btw as a side question and routes its stream back to the panel", async () => {
    const { page } = await openPage();

    page.api.postMessage({ command: "askBtw", question: "今天几号" });
    await flush();

    // 一条 RPC，带当前会话 —— 页面这一侧不再把它当普通消息发出去
    //（spec ui/remote-control.md「Web 页也能用 /btw 旁路提问」场景 1/2）。
    expect(page.socket.framesFor("askBtw")).toEqual([
      {
        id: expect.any(Number),
        method: "askBtw",
        params: { question: "今天几号" },
        sessionId: "s-new",
      },
    ]);
    expect(page.requests("sendMessage")).toBe(0);

    // 流式尾部：宿主的 `btwContent` 带 question，页面的面板靠它判归属——少了
    // 这个字段，切会话后迟到的增量会画进新问题的面板里。
    page.socket.receive({
      method: "btwContent",
      params: { question: "今天几号", content: "10 月 20", type: "content" },
      sessionId: "s-new",
    });
    expect(lastPosted(page)).toEqual({
      command: "btwStream",
      question: "今天几号",
      type: "content",
      content: "10 月 20",
    });

    await page.answer("askBtw", "**10 月 20 日**");
    expect(lastPosted(page)).toEqual({
      command: "btwResponse",
      question: "今天几号",
      answer: "**10 月 20 日**",
    });
  });

  test("a /btw the machine cannot run ends on screen instead of loading forever", async () => {
    const { page } = await openPage();

    page.api.postMessage({ command: "askBtw", question: "今天几号" });
    await flush();

    // 前台 CLI 会话（`RemoteControlCliHost`）还没接这个方法：它回的是
    // `REMOTE_HOST_UNSUPPORTED`（-32011），与「通道不放行」(-32601) 是两回事，
    // 页面据此说「这台电脑上的会话还不支持」，而不是停在加载中。
    const frame = page.socket.framesFor("askBtw")[0];
    page.socket.receive({
      id: frame.id,
      method: "error",
      params: {
        code: -32011,
        message: "Not implemented by a foreground CLI session: askBtw",
      },
    });
    await flush();

    expect(lastPosted(page)).toEqual({
      command: "btwError",
      question: "今天几号",
      error: "这台电脑上的会话还不支持附带提问",
    });
  });

  test("keeps waiting on /btw past the 20s request budget", async () => {
    const { page } = await openPage();
    page.api.postMessage({ command: "askBtw", question: "今天几号" });
    await flush();

    // 回执只在整轮答完之后才发（与 sendMessage / compact 同族），所以它按回合级
    // 超时算：20s 一到就报超时，每次稍慢一点的旁路提问都会变成一条假的失败。
    await vi.advanceTimersByTimeAsync(60000);
    expect(
      page.posted.filter((message) => message.command === "btwError"),
    ).toHaveLength(0);
  });

  test("switching into a session that is already generating shows its stop button", async () => {
    const { page } = await openPage();
    expect(
      page.posted.filter((message) => message.command === "startStreaming"),
    ).toHaveLength(0);

    page.api.postMessage({ command: "restoreSession", sessionId: "s-old" });
    await flush();
    await page.answer("listDaemonSessions", {
      sessions: [SESSIONS[1], { ...SESSIONS[0], isLoading: true }],
    });
    await page.answer("getSessionInfo", {
      sessionId: "s-old",
      permissionMode: "default",
    });
    await page.answer("getMessages", { messages: [SEED] });
    await page.answer("listPendingPermissions", { requests: [] });

    expect(lastPosted(page)).toMatchObject({
      command: "setInitialState",
      session: { id: "s-old" },
      isStreaming: true,
    });

    // The other direction still comes from the transition: once the page is
    // listening, `loadingChange` is the cheapest and most current signal. (The
    // marker broadcast rides along with it, hence the filter rather than
    // `lastPosted` — see 「the session list hears who is waiting…」.)
    page.socket.receive({
      method: "loadingChange",
      params: { loading: false },
      sessionId: "s-old",
    });
    expect(
      page.posted.filter((message) => message.command === "endStreaming"),
    ).toHaveLength(1);
  });

  test("a reconnect re-reads the busy state a message delta cannot carry", async () => {
    const { page } = await openPage();

    // The phone slept and the socket dropped; the turn the user comes back to
    // starts while nobody is listening.
    const next = await reconnect(page.socket);

    // Each half is re-read from its own source: the messages by delta, the state
    // from the registry. (A third read — the pending approvals — goes out here
    // too; it is the subject of the tests further down.)
    answerOn(next, "getMessages", { messages: [] });
    answerOn(next, "listDaemonSessions", {
      sessions: [{ ...SESSIONS[1], isLoading: true }],
    });
    await flush();

    expect(page.posted).toContainEqual({ command: "startStreaming" });
  });

  test("a turn that outlives the request budget is not reported as a failed send", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { page } = await openPage();

    page.api.postMessage({ command: "sendMessage", text: "跑一个长任务" });
    await flush();
    // The machine took the message; the turn is running, so the page can see the
    // send landed (and the composer already offers the stop entry).
    page.socket.receive({
      method: "loadingChange",
      params: { loading: true },
      sessionId: "s-new",
    });
    await flush();

    // `sendMessage`'s reply is sent when the whole turn is over, and a turn has
    // no upper bound: it loops through tools, and it parks indefinitely on an
    // approval nobody has answered yet. So neither the read budget nor the much
    // longer turn budget arriving means anything went wrong.
    await vi.advanceTimersByTimeAsync(20000);
    await vi.advanceTimersByTimeAsync(300000);

    expect(
      page.posted.filter((message) => message.command === "updateErrorBlock"),
    ).toHaveLength(0);
    // Nothing for the user to act on, but not swallowed either — the log line is
    // the only place this leaves a trace.
    expect(warn.mock.calls.flat().join(" ")).toContain("sendMessage 没有回执");
    warn.mockRestore();
  });

  test("a send with no reply and no turn says so in its own words", async () => {
    const { page } = await openPage();

    page.api.postMessage({ command: "sendMessage", text: "hi" });
    await flush();

    // No reply ever comes and no turn starts, so nothing here proves the message
    // landed: the page must say something. But not 「中继或电脑侧没有响应」 — that
    // describes a failure that did not happen, and it is the line users resend
    // on because it reads as 「没发出去」.
    //
    // It also says it on the *turn* budget rather than the read one: a turn can
    // legitimately stay silent this long, so 20s is not yet evidence of anything.
    await vi.advanceTimersByTimeAsync(20000);
    expect(
      page.posted.filter((message) => message.command === "updateErrorBlock"),
    ).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(300000);
    const error = page.posted.find(
      (message) => message.command === "updateErrorBlock",
    );
    expect(String(error?.error)).toContain("还没有回执");
    expect(String(error?.error)).not.toContain("没有响应");
  });

  test("a control指令 that never gets a reply says so instead of failing silently", async () => {
    const { page } = await openPage();

    page.api.postMessage({ command: "abortMessage" });
    await flush();

    // Stop / switch tier / compact all end in a state the message stream carries
    // back, so their success needs no reply — while their failure used to be an
    // empty `.catch`. A phone has no Escape key and no terminal, so 「点了暂停但没
    // 反应」 had nowhere at all to be explained.
    await vi.advanceTimersByTimeAsync(20000);

    expect(document.getElementById("remote-status")?.textContent).toContain(
      "暂停指令没有回执",
    );
  });

  test("a read still gets the short budget", async () => {
    const { page } = await openPage();
    const before = page.posted.length;

    page.api.postMessage({ command: "requestSlashCommands" });
    await flush();

    // The default tier is unchanged: a read the machine answers at once is still
    // reported within 20s, so a machine that is not answering stays visible.
    await vi.advanceTimersByTimeAsync(20000);

    expect(page.posted.slice(before)).toContainEqual(
      expect.objectContaining({ command: "slashCommandsError" }),
    );
  });

  test("an approval that arrives while the link is down is re-read on reconnect", async () => {
    const { page } = await openPage();

    // The model asks for an approval while nobody is subscribed. The remote path
    // drops notifications rather than buffering them (`RemoteControlService`:
    // nothing to serve while the link is down), so this one is not late — it is
    // never sent at all.
    const next = await reconnect(page.socket);

    // The delta a reconnect pulls carries no approvals, so the registry is the
    // only place this card can come from.
    await answerRereads(next, [QUESTION_PENDING]);

    // The options are the half the user reported missing: with no card, the list
    // shows the tool block (name and icon) and nothing to tap — which reads as a
    // turn that has stopped for no reason. Killing the app "fixed" it because a
    // cold start's snapshot reads the same registry.
    expect(
      page.posted.filter((message) => message.command === "showConfirmation"),
    ).toEqual([
      expect.objectContaining({
        confirmationId: "req-auq",
        toolName: "AskUserQuestion",
        toolInput: { questions: [{ question: "先做哪个？" }] },
      }),
    ]);
  });

  test("a re-read does not put up a second card for an approval the page already has", async () => {
    const { page } = await openPage();

    // It arrived the ordinary way, while the page was listening…
    page.socket.receive({
      method: "permissionRequest",
      params: BASH_PENDING,
      sessionId: "s-new",
    });
    await flush();

    // …and the machine is still waiting on it, so every reconnect reports it
    // again. The page's reducer appends (`SHOW_CONFIRMATION`), so re-posting the
    // same id would leave two cards standing for one approval — and the dialog
    // only ever shows the first, so the second could never be answered.
    let current = page.socket;
    for (let i = 0; i < 2; i++) {
      current = await reconnect(current);
      await answerRereads(current, [BASH_PENDING]);
    }

    expect(
      page.posted.filter((message) => message.command === "showConfirmation"),
    ).toHaveLength(1);
  });

  test("an app that re-mounted is handed the cards it lost", async () => {
    const { page } = await openPage();
    page.socket.receive({
      method: "permissionRequest",
      params: BASH_PENDING,
      sessionId: "s-new",
    });
    await flush();

    // The page re-mounted, so its own list is empty again — while this shim still
    // remembers handing that card over. What this side believes about the page is
    // exactly what has to go: otherwise the one approval the machine is waiting on
    // is the one thing the fresh page never hears about.
    page.api.postMessage({ command: "webviewReady" });
    await flush();
    answerOn(page.socket, "getMessages", { messages: [SEED] });
    answerOn(page.socket, "listDaemonSessions", { sessions: SESSIONS });
    answerOn(page.socket, "listPendingPermissions", {
      requests: [BASH_PENDING],
    });
    await flush();

    expect(
      page.posted.filter((message) => message.command === "showConfirmation"),
    ).toHaveLength(2);
  });

  test("an answer lost on the way out leaves an approval that can still be answered", async () => {
    const { page } = await openPage();
    page.socket.receive({
      method: "permissionRequest",
      params: BASH_PENDING,
      sessionId: "s-new",
    });
    await flush();

    // The user taps 允许. The page hides its card in the same tick
    // (`handleConfirmation` hides optimistically), and the answer itself is a
    // notification with no reply — so if that frame never lands, the machine is
    // parked on a request no card is offering anymore, and the turn waits with
    // nothing on screen to unblock it.
    page.api.postMessage({
      command: "confirmationResponse",
      confirmationId: "req-bash",
      approved: true,
    });
    await flush();

    const next = await reconnect(page.socket);
    await answerRereads(next, [BASH_PENDING]);

    // Two cards for one id is the correct arithmetic here: the first one belongs
    // to the card the user already answered and the page already hid.
    const cards = page.posted.filter(
      (message) => message.command === "showConfirmation",
    );
    expect(cards).toHaveLength(2);
    expect(cards[1]).toEqual(
      expect.objectContaining({ confirmationId: "req-bash" }),
    );
  });

  test("coming back to the foreground aligns what the page slept through", async () => {
    const { page } = await openPage();
    const before = {
      messages: page.requests("getMessages"),
      sessions: page.requests("listDaemonSessions"),
      pending: page.requests("listPendingPermissions"),
    };

    // jsdom reports its own `prerender` and never changes it; a phone that comes
    // back to the foreground is `visible`, which is what the page acts on.
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");

    // iOS suspends a backgrounded page outright: while it is away nothing is
    // delivered at all — no messages, no busy transitions, no approvals — so
    // coming back to a picture of the past is the only possible outcome unless
    // the page asks again.
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();

    expect(page.requests("getMessages")).toBe(before.messages + 1);
    expect(page.requests("listDaemonSessions")).toBe(before.sessions + 1);
    expect(page.requests("listPendingPermissions")).toBe(before.pending + 1);

    // A first load fires the same event; only a bfcache restore means "you were
    // away and are back".
    window.dispatchEvent(new Event("pageshow"));
    await flush();
    expect(page.requests("getMessages")).toBe(before.messages + 1);

    const restored = new Event("pageshow");
    Object.defineProperty(restored, "persisted", { value: true });
    window.dispatchEvent(restored);
    await flush();
    expect(page.requests("getMessages")).toBe(before.messages + 2);

    visibility.mockRestore();
  });

  test("a rename is answered with ok, so the page keeps the new title", async () => {
    const { page } = await openPage();

    page.api.postMessage({
      command: "renameSession",
      sessionId: "s-new",
      title: "登录页 v2",
      requestId: "rename-1",
    });
    await flush();

    const sent = page.socket.framesFor("renameSession")[0];
    expect(sent).toMatchObject({
      params: { title: "登录页 v2" },
      sessionId: "s-new",
    });

    // The shared UI reads `ok !== true` as a failure and rolls the optimistic
    // title back (`useSessionRename`), so a success reply without the flag is a
    // rename that always undoes itself on screen and reports 「重命名失败」.
    await page.answer("renameSession", null);
    expect(lastPosted(page)).toEqual({
      command: "sessionRenamed",
      requestId: "rename-1",
      sessionId: "s-new",
      title: "登录页 v2",
      ok: true,
    });
  });

  test("a rename the machine refuses comes back as a visible failure", async () => {
    const { page } = await openPage();

    page.api.postMessage({
      command: "renameSession",
      sessionId: "s-gone",
      title: "登录页 v2",
      requestId: "rename-2",
    });
    await flush();
    await page.refuse("renameSession", "no such session");

    // An empty `.catch` here would leave the optimistic title on screen with
    // nothing said — i.e. a rename that looks like it worked and did not.
    expect(lastPosted(page)).toEqual({
      command: "sessionRenamed",
      requestId: "rename-2",
      sessionId: "s-gone",
      title: "登录页 v2",
      ok: false,
      error: "no such session",
    });
  });

  test("the slash-command menu is served from the machine's own list", async () => {
    const { page } = await openPage();

    page.api.postMessage({ command: "requestSlashCommands" });
    await flush();
    const frame = await page.answer("getSlashCommands", {
      commands: [{ id: "c1", name: "/review", description: "复盘这次改动" }],
    });

    // `surface` 是这台机器拼清单的依据：同一个进程也可能同时服务电脑上的会话区，
    // 由它决定这台入口该多出哪几条（spec ui/slash-commands.md「弹窗里的宿主命令
    // 只有一份表」）。页面上能用的那批因此不再靠手打才知道存在。
    expect(frame.params).toEqual({ surface: "remote-page" });

    // Narrowed objects only — the SDK's own command objects carry handlers,
    // which have no business travelling over the relay.
    expect(lastPosted(page)).toEqual({
      command: "slashCommandsResponse",
      commands: [{ id: "c1", name: "/review", description: "复盘这次改动" }],
    });
  });

  // ── The permission mode the page displays ────────────────────────
  //
  // The adapter only pushes `permissionModeChange` — a *transition*. A mode
  // picked before the page arrived (or while the link was down, or on the
  // conversation the reader just left) has no transition left to deliver, so the
  // page would keep rendering its own reducer default `default` — 「修改前询问」,
  // a permission the session does not have. `getSessionInfo` carries the value,
  // and every path that re-aligns the page has to read it.

  /** The mode the page was last told to display. The paths that rebuild the
   *  snapshot carry it inside `setInitialState` (the hosts' own snapshots do
   *  the same); the paths that do not rebuild it get a standalone
   *  `updatePermissionMode` post. The last writer wins, in post order. */
  function shownMode(page: { posted: Frame[] }) {
    const updates = page.posted.filter(
      (message) => message.command === "updatePermissionMode",
    );
    if (updates.length) return updates[updates.length - 1].mode;
    const snapshots = page.posted.filter(
      (message) => message.command === "setInitialState",
    );
    // The latest snapshot: a switch rebuilds it, and the one being left is not
    // the conversation on screen any more.
    return snapshots.length
      ? snapshots[snapshots.length - 1].permissionMode
      : undefined;
  }

  test("reads the session's current mode into the first screen", async () => {
    // Built by hand rather than through `openPage`, which answers this read
    // itself: the point here is the request the page makes on its own.
    const page = startPage("?host=h-1");
    await flush();
    page.api.postMessage({ command: "webviewReady" });
    await flush();
    await page.answer("listDaemonSessions", { sessions: SESSIONS });

    // Addressed to the session the page just picked — the host answers for the
    // id in the envelope.
    const asked = await page.answer("getSessionInfo", {
      sessionId: "s-new",
      permissionMode: "bypassPermissions",
    });
    await page.answer("getMessages", { messages: [SEED] });
    await page.answer("listPendingPermissions", { requests: [] });

    expect(asked.sessionId).toBe("s-new");
    expect(shownMode(page)).toBe("bypassPermissions");
  });

  test("follows a mode switched while the page is looking at it", async () => {
    const { page } = await openPage();

    page.socket.receive({
      method: "permissionModeChange",
      params: { mode: "acceptEdits" },
      sessionId: "s-new",
    });
    await flush();

    expect(shownMode(page)).toBe("acceptEdits");
  });

  test("re-reads the mode when the reader switches conversation", async () => {
    // The conversation being left is running wide open; the one being opened is
    // not. A switch that only re-pulled the messages would leave the label on
    // the permission of the conversation the reader has left.
    const { page } = await openPage("?host=h-1", "bypassPermissions");
    expect(shownMode(page)).toBe("bypassPermissions");

    page.api.postMessage({ command: "restoreSession", sessionId: "s-old" });
    await flush();
    // The switch re-pulls through the same path a cold start uses, so the read
    // goes out again — for the conversation being opened.
    await page.answer("listDaemonSessions", { sessions: SESSIONS });
    const asked = await page.answer("getSessionInfo", {
      sessionId: "s-old",
      permissionMode: "plan",
    });
    // The mode now rides the snapshot (the hosts' own snapshots carry it too),
    // so the pull has to complete before the page can show it.
    await page.answer("getMessages", { messages: [SEED] });
    await page.answer("listPendingPermissions", { requests: [] });

    expect(asked.sessionId).toBe("s-old");
    expect(shownMode(page)).toBe("plan");
  });

  test("a mode read that lands after a switch cannot repaint the new conversation", async () => {
    // Hand-built: the race needs the first screen's read to still be in flight
    // when the reader switches away.
    const page = startPage("?host=h-1");
    await flush();
    page.api.postMessage({ command: "webviewReady" });
    await flush();
    await page.answer("listDaemonSessions", { sessions: SESSIONS });

    page.api.postMessage({ command: "restoreSession", sessionId: "s-old" });
    await flush();
    await page.answer("listDaemonSessions", { sessions: SESSIONS });

    // Oldest first: this reply describes `s-new`, which the page has left.
    await page.answer("getSessionInfo", {
      sessionId: "s-new",
      permissionMode: "bypassPermissions",
    });
    expect(shownMode(page)).toBeUndefined();

    await page.answer("getSessionInfo", {
      sessionId: "s-old",
      permissionMode: "default",
    });
    await page.answer("getMessages", { messages: [SEED] });
    await page.answer("listPendingPermissions", { requests: [] });
    expect(shownMode(page)).toBe("default");
  });

  test("a mode switched while the link was down is re-read on reconnect", async () => {
    const { page } = await openPage();
    expect(shownMode(page)).toBe("default");

    const next = await reconnect(page.socket);
    answerOn(next, "getMessages", { messages: [] });
    answerOn(next, "listDaemonSessions", { sessions: SESSIONS });
    answerOn(next, "getSessionInfo", {
      sessionId: "s-new",
      permissionMode: "bypassPermissions",
    });
    await flush();

    expect(shownMode(page)).toBe("bypassPermissions");
  });

  test("coming back to the foreground dials a waiting link at once", async () => {
    const { page } = await openPage();
    // No news is no element: the banner only exists while something is wrong.
    expect(document.getElementById("remote-status")).toBeFalsy();

    // The link drops the way a sleeping phone's does; the page schedules its
    // first backoff step (2s out).
    page.socket.onclose?.({ code: 4001 });
    expect(document.getElementById("remote-status")?.textContent).toContain(
      "等待上线",
    );
    const before = FakeSocket.opened.length;

    // Half a second later the phone is back in hand: the dial must happen now,
    // not when the armed step expires — a buried page burns no retries anyway,
    // so the wait between "screen on" and "usable again" is pure dead time.
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeSocket.opened.length).toBe(before);

    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    visibility.mockRestore();

    expect(FakeSocket.opened.length).toBe(before + 1);
    const next = FakeSocket.opened[FakeSocket.opened.length - 1];
    next.open();
    next.receive({ type: "auth_ok" });
    await flush();
    // And the link is whole again — the mode re-read is part of the same
    // realignment every reconnect gets.
    answerOn(next, "getMessages", { messages: [] });
    answerOn(next, "listDaemonSessions", { sessions: SESSIONS });
    await flush();
    expect(document.getElementById("remote-status")).toBeFalsy();
  });

  test("closing the waiting line covers the whole outage, retry count and all", async () => {
    const { page } = await openPage();

    page.socket.onclose?.({ code: 4001 });
    expect(
      document.getElementById("remote-status-text")?.textContent,
    ).toContain("第 1 次重试");

    statusClose()?.click();
    expect(document.getElementById("remote-status")).toBeFalsy();

    // The next backoff step runs as usual — closing the line mutes its
    // presentation, not the retrying — and it drops again with a different
    // count in the words. 同一条状态已经关掉了：换成「第 2 次」不算新状态。
    await vi.advanceTimersByTimeAsync(2000);
    const next = FakeSocket.opened[FakeSocket.opened.length - 1];
    next.onclose?.({ code: 4001 });
    expect(document.getElementById("remote-status")).toBeFalsy();

    // 反证「页面只是不再报状态」：退避仍在推进，下一条 socket 照样开出来。
    const beforeRetry = FakeSocket.opened.length;
    await vi.advanceTimersByTimeAsync(4000);
    expect(FakeSocket.opened.length).toBe(beforeRetry + 1);
  });

  test("an earlier close does not cover a different state", async () => {
    const { page } = await openPage();

    page.socket.onclose?.({ code: 4001 });
    statusClose()?.click();
    expect(document.getElementById("remote-status")).toBeFalsy();

    // 永久拒绝是另一条状态，与「等待上线」分开呈现——关掉一条不等于把这一面
    // 关掉。它同时是用户唯一能读到原因的地方。
    page.socket.onclose?.({ code: 4003 });
    expect(
      document.getElementById("remote-status-text")?.textContent,
    ).toContain("中继拒绝了这个连接");
  });

  test("the mute ends with the outage: the next drop is announced again", async () => {
    const { page } = await openPage();

    page.socket.onclose?.({ code: 4001 });
    statusClose()?.click();

    // 接回就是这条状态的出口（`onopen` 清掉状态面），于是下一次断开是一条新的
    // 状态，照常出现——不是「关过一次就永远安静」。
    const next = await reconnect(page.socket);
    answerOn(next, "getMessages", { messages: [] });
    answerOn(next, "listDaemonSessions", { sessions: SESSIONS });
    await flush();
    expect(document.getElementById("remote-status")).toBeFalsy();

    next.onclose?.({ code: 4001 });
    expect(
      document.getElementById("remote-status-text")?.textContent,
    ).toContain("等待上线");
  });

  test("coming back to the foreground re-reads the mode too", async () => {
    const { page } = await openPage();
    expect(shownMode(page)).toBe("default");

    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();

    expect(page.requests("getSessionInfo")).toBe(2);
    await page.answer("getSessionInfo", {
      sessionId: "s-new",
      permissionMode: "acceptEdits",
    });
    expect(shownMode(page)).toBe("acceptEdits");
    visibility.mockRestore();
  });

  test("a re-mounted app is told the mode again", async () => {
    const { page } = await openPage("?host=h-1", "bypassPermissions");
    expect(shownMode(page)).toBe("bypassPermissions");

    // The app re-mounted (a pane was rebuilt behind our back) and its reducer
    // started over at `default`; the value it had been told went with it, so
    // "already said so once" is not a reason to stay quiet.
    page.api.postMessage({ command: "webviewReady" });
    await flush();
    answerOn(page.socket, "getMessages", { messages: [SEED] });
    answerOn(page.socket, "listDaemonSessions", { sessions: SESSIONS });
    answerOn(page.socket, "listPendingPermissions", { requests: [] });
    answerOn(page.socket, "getSessionInfo", {
      sessionId: "s-new",
      permissionMode: "acceptEdits",
    });
    await flush();

    expect(page.requests("getSessionInfo")).toBe(2);
    expect(shownMode(page)).toBe("acceptEdits");
  });

  test("a machine that refuses the read leaves the mode unshown, not the page broken", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { page } = await openPage();

    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    await page.refuse(
      "getSessionInfo",
      "Method not available over remote control: getSessionInfo",
    );
    visibility.mockRestore();

    // The mode is display-only — the pick itself is a request — so a refusal
    // must not cost the page its session: the reason goes to the log rather
    // than onto the screen, and the page keeps what it had.
    expect(shownMode(page)).toBe("default");
    expect(warn.mock.calls.flat().join(" ")).toContain("会话状态补读失败");
    expect(
      page.posted.some((message) => message.command === "setInitialState"),
    ).toBe(true);
    warn.mockRestore();
  });

  // ── The session-state family (scenario 26) ───────────────────────
  //
  // Mode, todo list, compaction, command running and the queue are all
  // *states*: the adapter pushes their changes, but a page that arrives late
  // (or re-mounted, or slept through the change) has no transition left to
  // hear. `getSessionInfo` carries the family; the snapshot path folds it into
  // `setInitialState`, the paths that do not rebuild the snapshot get the
  // standalone posts. The last member of the family rides for free: the
  // context ring comes off the `getMessages` reply the page was already
  // pulling.

  /** The last post for `command`, if the page was ever told. */
  function lastOf(page: { posted: Frame[] }, command: string) {
    const found = page.posted.filter((message) => message.command === command);
    return found[found.length - 1];
  }

  test("the first screen carries the family as the machine answered it", async () => {
    const tasks = [{ id: "t1", subject: "改规格", status: "in_progress" }];
    const queued = [{ id: "q1", text: "补一条" }];
    const { page } = await openPage("?host=h-1", "bypassPermissions", {
      tasks,
      isCompacting: true,
      isCommandRunning: true,
      queuedMessages: queued,
      contextUsagePercent: 42,
    });

    const snapshot = lastOf(page, "setInitialState");
    expect(snapshot).toMatchObject({
      // Every member is the machine's answer, not the page's default: a
      // first screen that *looks* idle while the machine is mid-compaction
      // with a queue is the bug this family exists for.
      tasks,
      isCompacting: true,
      isCommandRunning: true,
      queuedMessages: queued,
      permissionMode: "bypassPermissions",
    });
    // The ring rides the `getMessages` reply — no read of its own — and it is
    // posted, not folded: the webview keeps it outside the reducer.
    expect(lastOf(page, "contextUsage")).toEqual({
      command: "contextUsage",
      percent: 42,
    });
  });

  test("a re-mounted app is told the whole family again, not just the mode", async () => {
    const { page } = await openPage("?host=h-1", "default", {
      tasks: [{ id: "t1", subject: "改规格", status: "pending" }],
      isCompacting: true,
      queuedMessages: [{ id: "q1", text: "补一条" }],
    });

    page.api.postMessage({ command: "webviewReady" });
    await flush();
    answerOn(page.socket, "getMessages", { messages: [SEED] });
    answerOn(page.socket, "listDaemonSessions", { sessions: SESSIONS });
    answerOn(page.socket, "listPendingPermissions", { requests: [] });
    answerOn(page.socket, "getSessionInfo", {
      sessionId: "s-new",
      permissionMode: "default",
      tasks: [],
      isCompacting: false,
      isCommandRunning: false,
      queuedMessages: [],
    });
    await flush();

    // The remounted reducer went back to *all* of its defaults — an empty todo
    // list, no compaction hint, no queue — so a re-read that only fixed the
    // mode would leave the other three stale. The machine now says "empty /
    // not compacting / not running / empty", and all four must arrive.
    expect(lastOf(page, "updateTasks")).toEqual({
      command: "updateTasks",
      tasks: [],
    });
    expect(lastOf(page, "compactionStateChange")).toEqual({
      command: "compactionStateChange",
      isCompacting: false,
    });
    expect(lastOf(page, "updateCommandRunning")).toEqual({
      command: "updateCommandRunning",
      running: false,
    });
    expect(lastOf(page, "updateQueue")).toEqual({
      command: "updateQueue",
      queue: [],
    });
  });

  test("a queue change reaches the webview under the name the webview reads", async () => {
    const { page } = await openPage();

    // The machine's notification calls the list `messages`; the webview's own
    // vocabulary calls it `queue` — the same name the VSCE and desktop hosts
    // send (webview-fixtures). Forwarding the host's name verbatim made the
    // webview read `undefined`, write it into `state.queuedMessages`, and throw
    // in the list render, which unmounts the whole app: the white page a phone
    // showed after being backgrounded and reopened.
    const queued = [{ id: "q1", text: "补一条" }];
    page.socket.receive({
      method: "queuedMessagesChange",
      params: { messages: queued },
      sessionId: "s-new",
    });
    await flush();

    expect(lastOf(page, "updateQueue")).toEqual({
      command: "updateQueue",
      queue: queued,
    });
  });

  test("switching conversations re-reads the family for the one being opened", async () => {
    const { page } = await openPage("?host=h-1", "bypassPermissions", {
      tasks: [{ id: "t1", subject: "旧会话的活", status: "in_progress" }],
      isCompacting: true,
      queuedMessages: [{ id: "q1", text: "旧的" }],
    });

    page.api.postMessage({ command: "restoreSession", sessionId: "s-old" });
    await flush();
    await page.answer("listDaemonSessions", { sessions: SESSIONS });
    await page.answer("getSessionInfo", {
      sessionId: "s-old",
      permissionMode: "plan",
      tasks: [{ id: "t2", subject: "新会话的活", status: "pending" }],
      isCompacting: false,
      isCommandRunning: false,
      queuedMessages: [],
    });
    await page.answer("getMessages", { messages: [SEED] });
    await page.answer("listPendingPermissions", { requests: [] });

    // The snapshot rebuilt for the switch carries the new conversation's
    // family — the previous one's todo list and queue must not follow the
    // reader across.
    const snapshot = lastOf(page, "setInitialState");
    expect(snapshot).toMatchObject({
      tasks: [{ id: "t2", subject: "新会话的活", status: "pending" }],
      isCompacting: false,
      isCommandRunning: false,
      queuedMessages: [],
      permissionMode: "plan",
    });
  });

  test("a machine older than this page cannot have its fields written as empty", async () => {
    // Scenario 26's version-skew rule: a reply without the new fields is
    // 「this build cannot say」, not 「the machine has none」. Writing them
    // absent would clobber a value the page already holds with `undefined` —
    // the todo list the machine pushed a moment ago would blink away.
    const { page } = await openPage(); // family omitted from the reply entirely

    expect(lastOf(page, "updateTasks")).toBeUndefined();
    expect(lastOf(page, "compactionStateChange")).toBeUndefined();
    expect(lastOf(page, "updateCommandRunning")).toBeUndefined();
    expect(lastOf(page, "updateQueue")).toBeUndefined();
    // The snapshot still has to say *something* on first paint; the neutral
    // values are the fallback for 「cannot ask」, not the machine's answer.
    expect(lastOf(page, "setInitialState")).toMatchObject({
      tasks: [],
      isCompacting: false,
      isCommandRunning: false,
      queuedMessages: [],
    });

    // Same rule on the standalone re-read (a remount here): the machine that
    // cannot answer the family must not get its absence written either.
    page.api.postMessage({ command: "webviewReady" });
    await flush();
    answerOn(page.socket, "getMessages", { messages: [SEED] });
    answerOn(page.socket, "listDaemonSessions", { sessions: SESSIONS });
    answerOn(page.socket, "listPendingPermissions", { requests: [] });
    answerOn(page.socket, "getSessionInfo", {
      sessionId: "s-new",
      permissionMode: "default",
    });
    await flush();

    expect(lastOf(page, "updateTasks")).toBeUndefined();
    expect(lastOf(page, "compactionStateChange")).toBeUndefined();
    expect(lastOf(page, "updateCommandRunning")).toBeUndefined();
    expect(lastOf(page, "updateQueue")).toBeUndefined();
  });

  test("a state read that lands after a switch cannot repaint the new conversation", async () => {
    // The guard in `refreshSessionState`: the request names the session it was
    // asked for, and a reader who moved on before the reply landed must not be
    // shown the conversation they left — its wide-open mode, its todo list.
    const { page } = await openPage("?host=h-1", "default");

    page.api.postMessage({ command: "restoreSession", sessionId: "s-old" });
    await flush();
    await page.answer("listDaemonSessions", { sessions: SESSIONS });
    await page.answer("getSessionInfo", {
      sessionId: "s-old",
      permissionMode: "bypassPermissions",
      tasks: [{ id: "t1", subject: "旧会话的活", status: "in_progress" }],
      isCompacting: true,
      queuedMessages: [{ id: "q1", text: "旧的" }],
    });
    await page.answer("getMessages", { messages: [SEED] });
    await page.answer("listPendingPermissions", { requests: [] });

    // The resume read goes out for s-old…
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    // …its other reads get answered; the session-state one stays in flight.
    await page.answer("getMessages", { messages: [] });
    await page.answer("listDaemonSessions", { sessions: SESSIONS });
    await page.answer("listPendingPermissions", { requests: [] });

    // …and the reader switches before its reply lands.
    page.api.postMessage({ command: "restoreSession", sessionId: "s-new" });
    await flush();
    await page.answer("listDaemonSessions", { sessions: SESSIONS });

    // Oldest first: this reply describes s-old, which the page has left.
    await page.answer("getSessionInfo", {
      sessionId: "s-old",
      permissionMode: "bypassPermissions",
      tasks: [{ id: "t1", subject: "旧会话的活", status: "in_progress" }],
      isCompacting: true,
      queuedMessages: [{ id: "q1", text: "旧的" }],
    });
    await page.answer("getSessionInfo", {
      sessionId: "s-new",
      permissionMode: "default",
      tasks: [],
      isCompacting: false,
      isCommandRunning: false,
      queuedMessages: [],
    });
    await page.answer("getMessages", { messages: [SEED] });
    await page.answer("listPendingPermissions", { requests: [] });
    visibility.mockRestore();

    // Nothing was *posted* — the family rides the snapshots, and the stale
    // reply must contribute neither the mode nor any family member.
    expect(
      page.posted.filter(
        (message) => message.command === "updatePermissionMode",
      ),
    ).toEqual([]);
    expect(lastOf(page, "updateTasks")).toBeUndefined();
    expect(lastOf(page, "compactionStateChange")).toBeUndefined();
    // And the view is the conversation being read now.
    expect(shownMode(page)).toBe("default");
  });

  test("a reconnect realigns the context ring from the delta it was already pulling", async () => {
    const { page } = await openPage("?host=h-1", "default", {
      contextUsagePercent: 30,
    });

    const next = await reconnect(page.socket);
    answerOn(next, "getMessages", { messages: [], contextUsagePercent: 87 });
    answerOn(next, "listDaemonSessions", { sessions: SESSIONS });
    answerOn(next, "listPendingPermissions", { requests: [] });
    answerOn(next, "getSessionInfo", {
      sessionId: "s-new",
      permissionMode: "default",
    });
    await flush();

    // The ring moves with the resync reply itself: a reconnect that pulled a
    // delta anyway needs no read of its own to fix a stale percentage.
    expect(lastOf(page, "contextUsage")).toEqual({
      command: "contextUsage",
      percent: 87,
    });
  });

  // ── 发起新会话（spec「Web 端也能发起新会话」）──────────────────
  //
  // The dialog is the page's own UI; the shim ferries four whitelisted RPCs.
  // All four are session-less utility calls: the envelope must NOT carry the
  // page's current sessionId, and the machine-side gate strips `initialize`
  // down to `workdir`/`permissionMode` regardless of what the page sends.

  test("lists a machine directory without tying the call to the open session", async () => {
    const { page } = await openPage();

    page.api.postMessage({
      command: "newSessionListDirs",
      dir: "~",
      requestId: "dirs-1",
    });
    await flush();

    const asked = page.socket.framesFor("listDirectories")[0];
    expect(asked).toMatchObject({ params: { dir: "~" } });
    // A session-less call: creating/browsing must work from an empty view too.
    expect(asked.sessionId).toBeUndefined();

    await page.answer("listDirectories", {
      resolvedPath: "/home/u",
      dirs: ["repos", "docs"],
    });
    expect(lastPosted(page)).toEqual({
      command: "newSessionDirs",
      requestId: "dirs-1",
      resolvedPath: "/home/u",
      dirs: ["repos", "docs"],
    });
  });

  test("a missing or unreadable directory comes back as an error, not an empty list", async () => {
    const { page } = await openPage();

    page.api.postMessage({
      command: "newSessionListDirs",
      dir: "/nope",
      requestId: "dirs-2",
    });
    await flush();
    await page.refuse("listDirectories", "目录不存在或不可读：/nope");

    expect(lastPosted(page)).toEqual({
      command: "newSessionDirs",
      requestId: "dirs-2",
      error: "目录不存在或不可读：/nope",
    });
  });

  test("branches are fetched for the picked workdir", async () => {
    const { page } = await openPage();

    page.api.postMessage({
      command: "newSessionListBranches",
      workdir: "/repo",
      requestId: "br-1",
    });
    await flush();

    const branchFrame = page.socket.framesFor("listGitBranches")[0];
    expect(branchFrame).toMatchObject({ params: { workdir: "/repo" } });
    expect(branchFrame.sessionId).toBeUndefined();

    await page.answer("listGitBranches", {
      branches: ["main", "dev"],
      current: "main",
    });
    expect(lastPosted(page)).toEqual({
      command: "newSessionBranches",
      requestId: "br-1",
      result: { branches: ["main", "dev"], current: "main" },
    });
  });

  test("lists this machine's recent workdirs on request, without a session", async () => {
    const { page } = await openPage();

    page.api.postMessage({ command: "getRecentWorkdirs", requestId: "rw-1" });
    await flush();

    const frame = page.socket.framesFor("getRecentWorkdirs")[0];
    // 机器级读：不能绑在页面正在看的那条会话上（会话全删光时它照样要能问）。
    expect(frame.sessionId).toBeUndefined();

    await page.answer("getRecentWorkdirs", { dirs: ["/repo", "/tmp/other"] });
    expect(lastPosted(page)).toEqual({
      command: "recentWorkdirsResponse",
      requestId: "rw-1",
      dirs: ["/repo", "/tmp/other"],
    });
  });

  test("answers an empty list when the machine is too old to have one", async () => {
    const { page } = await openPage();

    page.api.postMessage({ command: "getRecentWorkdirs", requestId: "rw-2" });
    await flush();
    await page.refuse(
      "getRecentWorkdirs",
      "Method not available over remote control",
    );

    // 旧版电脑：页面只按活会话派生的那些列，而不是把「没有这项能力」显示成错。
    expect(lastPosted(page)).toMatchObject({
      command: "recentWorkdirsResponse",
      requestId: "rw-2",
      dirs: [],
    });
  });

  test("remembers the picked directory when a session is created", async () => {
    const { page } = await openPage();

    page.api.postMessage({
      command: "newSessionCreate",
      workdir: "/new/repo",
      requestId: "mk-3",
    });
    await flush();
    await page.answer("initialize", {
      sessionId: "s-created",
      currentWorkdir: "/new/repo",
      permissionMode: "default",
      latestTotalTokens: 0,
    });
    await flush();

    const frame = page.socket.framesFor("rememberRecentWorkdir")[0];
    expect(frame).toMatchObject({ params: { workdir: "/new/repo" } });
    expect(frame.sessionId).toBeUndefined();
  });

  test("creating a session points the page's own view at the new one", async () => {
    const { page } = await openPage();

    page.api.postMessage({
      command: "newSessionCreate",
      workdir: "/new/repo",
      requestId: "mk-1",
    });
    await flush();

    const init = page.socket.framesFor("initialize")[0];
    expect(init).toMatchObject({ params: { workdir: "/new/repo" } });
    expect(init.sessionId).toBeUndefined();
    // The page never asked for a worktree, so the machine sees exactly the
    // picked shape — nothing else rides along.
    expect(Object.keys(init.params as object)).toEqual(["workdir"]);

    await page.answer("initialize", {
      sessionId: "s-created",
      currentWorkdir: "/new/repo",
      permissionMode: "default",
      latestTotalTokens: 0,
    });

    // The re-pull's first read is the registry, and it must already know the
    // new session — on a live machine it does, because `initialize` resolves
    // after the session is registered. `chooseSession` keeps the id it was
    // handed only while the registry confirms it.
    await page.answer("listDaemonSessions", {
      sessions: [
        ...SESSIONS,
        { sessionId: "s-created", sessionCwd: "/new/repo" },
      ],
    });
    // The snapshot chain reads in order: registry → getSessionInfo →
    // getMessages, so the session info answer must land before the pull.
    await page.answer("getSessionInfo", {
      sessionId: "s-created",
      permissionMode: "default",
    });

    // The machine built the session in its registry; this side re-points its
    // own view and lets the cold-start path fill it in — the computer moves
    // for nobody.
    const pulls = page.socket.framesFor("getMessages");
    const pull = pulls[pulls.length - 1];
    expect(pull.sessionId).toBe("s-created");
    expect(pull.params).toEqual({ limit: 100 });
    await page.answer("getMessages", { messages: [] });
    await page.answer("listPendingPermissions", { requests: [] });
    await flush();

    expect(
      page.posted.find((message) => message.command === "newSessionCreated"),
    ).toMatchObject({
      requestId: "mk-1",
      sessionId: "s-created",
      currentWorkdir: "/new/repo",
      worktreeName: undefined,
    });
  });

  test("a worktree creation is the desktop's two-step, pointed at the worktree", async () => {
    const { page } = await openPage();

    page.api.postMessage({
      command: "newSessionCreate",
      workdir: "/repo",
      useWorktree: true,
      baseBranch: "main",
      name: "warm-bear",
      requestId: "mk-2",
    });
    await flush();

    const worktreeFrame = page.socket.framesFor("createWorktree")[0];
    expect(worktreeFrame).toMatchObject({
      params: { workdir: "/repo", baseBranch: "main", name: "warm-bear" },
    });
    expect(worktreeFrame.sessionId).toBeUndefined();

    await page.answer("createWorktree", {
      name: "warm-bear",
      path: "/repo/.wave/worktrees/warm-bear",
      branch: "warm-bear",
      repoRoot: "/repo",
    });
    await flush();

    const init = page.socket.framesFor("initialize")[0];
    expect(init.params).toMatchObject({
      workdir: "/repo/.wave/worktrees/warm-bear",
    });

    await page.answer("initialize", {
      sessionId: "s-wt",
      currentWorkdir: "/repo/.wave/worktrees/warm-bear",
      permissionMode: "default",
      latestTotalTokens: 0,
    });
    // The registry confirms the new session before the switch's pull continues.
    await page.answer("listDaemonSessions", {
      sessions: [
        ...SESSIONS,
        {
          sessionId: "s-wt",
          sessionCwd: "/repo/.wave/worktrees/warm-bear",
        },
      ],
    });
    await page.answer("getSessionInfo", {
      sessionId: "s-wt",
      permissionMode: "default",
    });
    await page.answer("getMessages", { messages: [] });
    await page.answer("listPendingPermissions", { requests: [] });
    await flush();

    expect(
      page.posted.find((message) => message.command === "newSessionCreated"),
    ).toMatchObject({
      requestId: "mk-2",
      sessionId: "s-wt",
      worktreeName: "warm-bear",
    });
  });

  test("a refused creation leaves the page where it was, with the reason said", async () => {
    const { page } = await openPage();
    const pulls = page.requests("getMessages");

    page.api.postMessage({
      command: "newSessionCreate",
      workdir: "/nope",
      requestId: "mk-3",
    });
    await flush();
    await page.refuse("initialize", "目录不存在或不可读：/nope");

    expect(lastPosted(page)).toEqual({
      command: "newSessionCreateFailed",
      requestId: "mk-3",
      error: "目录不存在或不可读：/nope",
    });
    // The view still belongs to the session it was on: a failed create must
    // not strand the page on an empty list.
    expect(page.requests("getMessages")).toBe(pulls);
  });
});

/**
 * 会话列表的行级动作（spec ui/remote-control.md「手机端的会话列表与删除」）：删除
 * 与删除前的 worktree 计数。
 *
 * 两条都**按信封 `sessionId` 指向被操作的那一行**，而不是页面当前看着的那条——列表
 * 上能点的是每一条会话，删除 / 查改动跟「我正在读哪条」无关。协议上不放行裸
 * `removeWorktree` / `getWorktreeChanges`：手机能指名的只能是它列出来的会话，路径由
 * 电脑侧自己从会话的 `createdWorkdir` 推导。
 */
describe("remote page session list actions", () => {
  /** The session-list facts the registry read already carries (no extra RPC). */
  test("rides the registry read for 后台任务 and worktree membership", async () => {
    const { page } = await openPage();

    // 同一份 `listDaemonSessions` 回复里的两个字段：`hasRunningBackgroundWork` 是
    // 「前台空了但还在干活」、`worktree` 是「这条会话建在工作树里」。都不新增读路径。
    page.api.postMessage({ command: "restoreSession", sessionId: "s-old" });
    await flush();
    await page.answer("listDaemonSessions", {
      sessions: [
        {
          sessionId: "s-old",
          sessionCwd: "/tmp/other",
          hasRunningBackgroundWork: true,
        },
        {
          sessionId: "s-new",
          sessionCwd: "/repo",
          worktree: {
            path: "/repo/.wave/worktrees/feat",
            branch: "wave/feat",
            repoRoot: "/repo",
            hookBased: false,
          },
        },
      ],
    });
    await page.answer("getSessionInfo", { permissionMode: "default" });
    await page.answer("getMessages", { messages: [SEED] });
    await page.answer("listPendingPermissions", { requests: [] });

    expect(lastPosted(page)).toMatchObject({
      command: "setInitialState",
      sessionStatus: {
        waiting: [],
        running: [],
        background: ["s-old"],
        worktrees: ["s-new"],
      },
    });
    // 同一份读里的 `worktree.repoRoot` 也随会话下发：新建会话弹窗的「最近目录」
    // 按 `repoRoot ?? workdir` 归并，所以 worktree 会话在那里只出现它的仓库根，
    // 而 `workdir` 仍是那条会话真实的 cwd（`@` 文件提及拼路径靠它）。
    expect(lastPosted(page)).toMatchObject({
      sessions: expect.arrayContaining([
        expect.objectContaining({
          id: "s-new",
          workdir: "/repo",
          repoRoot: "/repo",
        }),
      ]),
    });
  });

  test("forwards a delete as destroy against that row, then re-reads the list", async () => {
    const { page } = await openPage();

    page.api.postMessage({
      command: "deleteSession",
      sessionId: "s-old",
      removeWorktree: false,
      requestId: "del-1",
    });
    await flush();

    const [frame] = page.socket.framesFor("destroy");
    // 信封 sessionId 指向被删的那条（不是页面当前那条），参数只有一个可选开关。
    expect(frame).toMatchObject({
      method: "destroy",
      sessionId: "s-old",
      params: { removeWorktree: false },
    });

    // 先重读列表，再回执：页面拿到「已删除」时列表已经是删完的那份。
    await page.answer("destroy", { worktreeRemoved: false });
    await page.answer("listDaemonSessions", {
      sessions: [SESSIONS[1]],
    });

    const commands = page.posted.map((message) => message.command);
    expect(commands).toContain("updateSessions");
    expect(
      page.posted
        .filter((message) => message.command === "updateSessions")
        .pop(),
    ).toMatchObject({ sessions: [expect.objectContaining({ id: "s-new" })] });
    expect(lastPosted(page)).toMatchObject({
      command: "sessionDeleted",
      requestId: "del-1",
      sessionId: "s-old",
      ok: true,
      worktreeRemoved: false,
    });
    // 删的不是当前这条：视图不动（不重拉消息、不换绑）。
    expect(page.requests("getMessages")).toBe(1);
  });

  test("carries removeWorktree when the row was a worktree session", async () => {
    const { page } = await openPage();

    page.api.postMessage({
      command: "deleteSession",
      sessionId: "s-new",
      removeWorktree: true,
      requestId: "del-2",
    });
    await flush();

    expect(page.socket.framesFor("destroy")[0]).toMatchObject({
      sessionId: "s-new",
      params: { removeWorktree: true },
    });
  });

  test("re-picks a live session after the current one is deleted, without navigating the page", async () => {
    const { page } = await openPage();

    page.api.postMessage({
      command: "deleteSession",
      sessionId: "s-new",
      removeWorktree: true,
      requestId: "del-3",
    });
    await flush();
    await page.answer("destroy", { worktreeRemoved: true });
    await page.answer("listDaemonSessions", { sessions: [SESSIONS[0]] });
    // 删掉的那条是当前这条：重挑一条活的并把视图重画（否则每次读都落到
    // Session not found），但**页面仍停在列表上**——不替用户跳进去。
    await page.answer("listDaemonSessions", { sessions: [SESSIONS[0]] });
    await page.answer("getSessionInfo", {
      sessionId: "s-old",
      permissionMode: "default",
    });
    await page.answer("getMessages", { messages: [SEED] });
    await page.answer("listPendingPermissions", { requests: [] });
    await page.answer("getWorkflowRuns", { runs: [] });

    expect(
      page.posted.filter((message) => message.command === "sessionDeleted"),
    ).toContainEqual(expect.objectContaining({ requestId: "del-3", ok: true }));
    expect(
      page.posted
        .filter((message) => message.command === "setInitialState")
        .pop(),
    ).toMatchObject({ session: expect.objectContaining({ id: "s-old" }) });
  });

  test("empties the page quietly when the last conversation is deleted", async () => {
    const { page } = await openPage();

    // 先删掉不是当前的那条，再删当前这条：机器上一条会话都不剩。
    page.api.postMessage({
      command: "deleteSession",
      sessionId: "s-old",
      requestId: "del-5",
    });
    await flush();
    await page.answer("destroy", { worktreeRemoved: false });
    await page.answer("listDaemonSessions", { sessions: [SESSIONS[1]] });

    const readsBefore = page.requests("getMessages");
    page.api.postMessage({
      command: "deleteSession",
      sessionId: "s-new",
      requestId: "del-6",
    });
    await flush();
    await page.answer("destroy", { worktreeRemoved: false });
    // 删完后的重读（`deleteSession` 自己那次）与重挑快照的读（`pickSession`）。
    await page.answer("listDaemonSessions", { sessions: [] });
    await page.answer("listDaemonSessions", { sessions: [] });

    // 没有会话可读时不能再去问 `getMessages`：机器会以「Session ID is required」
    // 拒掉，红色横幅就压在「电脑侧还没有正在跑的会话。」上面，看上去像删除出错。
    expect(page.requests("getMessages")).toBe(readsBefore);

    await page.answer("listPendingPermissions", { requests: [] });
    // 读文案里的那段文本，不读整行：这一行还带着动作与关闭（`×`）。
    expect(document.getElementById("remote-status-text")?.textContent).toBe(
      "电脑侧还没有正在跑的会话。",
    );
    // 视图仍要重画成空的那一份（消息清空、当前会话为空）。
    expect(
      page.posted
        .filter((message) => message.command === "setInitialState")
        .pop(),
    ).toMatchObject({ messages: [], currentSession: undefined });
  });

  test("says so when the machine refuses the delete", async () => {
    const { page } = await openPage();

    page.api.postMessage({
      command: "deleteSession",
      sessionId: "s-old",
      requestId: "del-4",
    });
    await flush();
    await page.refuse("destroy", "Session not found");

    expect(lastPosted(page)).toMatchObject({
      command: "sessionDeleted",
      requestId: "del-4",
      sessionId: "s-old",
      ok: false,
      error: "Session not found",
    });
  });

  test("reads a worktree's changes for the row, not a path the page names", async () => {
    const { page } = await openPage();

    page.api.postMessage({
      command: "getSessionWorktreeChanges",
      sessionId: "s-new",
      requestId: "wt-1",
    });
    await flush();

    const [frame] = page.socket.framesFor("getSessionWorktreeChanges");
    expect(frame).toMatchObject({
      method: "getSessionWorktreeChanges",
      sessionId: "s-new",
    });
    // 页面报不出路径：参数只有信封上的那条会话。
    expect(frame.params).toEqual({});

    await page.answer("getSessionWorktreeChanges", { files: 2, commits: 1 });
    expect(lastPosted(page)).toMatchObject({
      command: "sessionWorktreeChanges",
      requestId: "wt-1",
      sessionId: "s-new",
      changes: { files: 2, commits: 1 },
    });
  });

  test("a worktree it cannot inspect comes back as unknown, never as clean", async () => {
    const { page } = await openPage();

    page.api.postMessage({
      command: "getSessionWorktreeChanges",
      sessionId: "s-new",
      requestId: "wt-2",
    });
    await flush();
    await page.answer("getSessionWorktreeChanges", null);

    // `null` = 读不到：页面据此降级成泛警告，不许当成「没有改动」而静默删。
    expect(lastPosted(page)).toMatchObject({
      command: "sessionWorktreeChanges",
      requestId: "wt-2",
      changes: null,
    });
  });
});

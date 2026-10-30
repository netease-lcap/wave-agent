/**
 * 手机页点图片路径取图（spec `ui/remote-control.md`「点消息里的图片路径看原
 * 图」）在 shim 这一层的形状：一条命令进、一条中继请求出、一条回包交给页面。
 *
 * 与 `shimSessions.test.ts` 共用同一套驱动方式（真 shim.js + 假 WebSocket +
 * jsdom 的 `window`），但只装它需要的那几个 helper：这条链路不涉及会话列表
 * 的对齐逻辑，跑整套 `openPage` 反而会让用例看不出在验什么。
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

/** 中继那一端的替身：出帧记录下来，入帧推回去。 */
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

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(frame: Frame) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  framesFor(method: string): Frame[] {
    return this.sent
      .map((line) => JSON.parse(line) as Frame)
      .filter((frame) => frame.method === method);
  }
}

let messageListeners: Array<(event: MessageEvent) => void> = [];

/** 把页面装起来并走完握手；返回中继替身与页面收到的消息。 */
function startPage() {
  const posted: Frame[] = [];
  const listener = (event: MessageEvent) => posted.push(event.data as Frame);
  messageListeners.push(listener);
  window.addEventListener("message", listener);

  window.history.replaceState({}, "", "/remote/?host=h-1");
  window.localStorage.setItem("token", "sso-token");

  new Function(SHIM)();
  const socket = FakeSocket.opened[FakeSocket.opened.length - 1]!;
  socket.open();
  socket.receive({ type: "auth_ok" });

  return {
    socket,
    posted,
    api: (
      window as unknown as {
        acquireVsCodeApi(): { postMessage(msg: unknown): void };
      }
    ).acquireVsCodeApi(),
  };
}

async function flush() {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  FakeSocket.opened = [];
  messageListeners = [];
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

describe("手机页取图", () => {
  test("点图片路径 → 一条中继请求，回图带上页面给的 requestId", async () => {
    const page = startPage();
    await flush();

    page.api.postMessage({
      command: "getImagePreview",
      path: "/tmp/shots/before.png",
      requestId: "req-1",
    });
    await flush();

    const frames = page.socket.framesFor("getImagePreview");
    expect(frames).toHaveLength(1);
    expect(frames[0]!.params).toEqual({ path: "/tmp/shots/before.png" });

    page.socket.receive({
      id: frames[0]!.id,
      method: "result",
      params: {
        result: {
          path: "/tmp/shots/before.png",
          dataUrl: "data:image/png;base64,AAAA",
          mime: "image/png",
          width: 800,
          height: 600,
          scaled: true,
          bytes: 3,
        },
      },
    });
    await flush();

    expect(page.posted[page.posted.length - 1]).toMatchObject({
      command: "imagePreviewResponse",
      requestId: "req-1",
      dataUrl: "data:image/png;base64,AAAA",
      scaled: true,
    });
  });

  test("宿主拒绝时原样带回它那句原因（页面直接显示，不再套一层）", async () => {
    const page = startPage();
    await flush();

    page.api.postMessage({
      command: "getImagePreview",
      path: "/tmp/notes.png",
      requestId: "req-2",
    });
    await flush();

    const frame = page.socket.framesFor("getImagePreview")[0]!;
    page.socket.receive({
      id: frame.id,
      method: "error",
      params: {
        code: -32012,
        message: "/tmp/notes.png is not a supported image (svg)",
      },
    });
    await flush();

    expect(page.posted[page.posted.length - 1]).toMatchObject({
      command: "imagePreviewResponse",
      requestId: "req-2",
      error: "/tmp/notes.png is not a supported image (svg)",
    });
  });

  test("没有 scaled 字段时按 false 报（页面据此不说「这是缩过的」）", async () => {
    const page = startPage();
    await flush();

    page.api.postMessage({
      command: "getImagePreview",
      path: "/tmp/a.png",
      requestId: "req-3",
    });
    await flush();

    const frame = page.socket.framesFor("getImagePreview")[0]!;
    page.socket.receive({
      id: frame.id,
      method: "result",
      params: { result: { dataUrl: "data:image/png;base64,BBBB" } },
    });
    await flush();

    expect(page.posted[page.posted.length - 1]).toMatchObject({
      command: "imagePreviewResponse",
      requestId: "req-3",
      scaled: false,
    });
  });
});

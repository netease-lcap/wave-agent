/**
 * 手机页读文本（spec `remote/remote-web.md`「点消息里的文件路径看内容」）在 shim
 * 这一层的形状：一条命令进、一条中继请求出、一条回包交给页面；失败把宿主那句
 * 原因原样带回，缺字段时给安全默认。
 *
 * 与 `shimImagePreview.test.ts` 同一套驱动方式（真 `shim.js` + 假 WebSocket +
 * jsdom 的 `window`），只装这条链路需要的那几个 helper。
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

describe("手机页读文本", () => {
  test("点文本路径 → 一条中继请求，回包字段原样交给页面", async () => {
    const page = startPage();
    await flush();

    page.api.postMessage({
      command: "getTextPreview",
      path: "/tmp/build.log",
      requestId: "req-1",
    });
    await flush();

    const frames = page.socket.framesFor("getTextPreview");
    expect(frames).toHaveLength(1);
    expect(frames[0]!.params).toEqual({ path: "/tmp/build.log" });

    page.socket.receive({
      id: frames[0]!.id,
      method: "result",
      params: {
        result: {
          path: "/tmp/build.log",
          content: "build ok\n",
          bytes: 5_242_880,
          returnedBytes: 262_144,
          truncated: true,
          encodingIssue: false,
        },
      },
    });
    await flush();

    expect(page.posted[page.posted.length - 1]).toMatchObject({
      command: "textPreviewResponse",
      requestId: "req-1",
      content: "build ok\n",
      bytes: 5_242_880,
      returnedBytes: 262_144,
      truncated: true,
      encodingIssue: false,
    });
  });

  test("宿主拒绝时原样带回它那句原因（「不是文本文件」页面直接显示）", async () => {
    const page = startPage();
    await flush();

    page.api.postMessage({
      command: "getTextPreview",
      path: "/tmp/blob.bin",
      requestId: "req-2",
    });
    await flush();

    const frame = page.socket.framesFor("getTextPreview")[0]!;
    page.socket.receive({
      id: frame.id,
      method: "error",
      params: { code: -32016, message: "/tmp/blob.bin is not a text file" },
    });
    await flush();

    expect(page.posted[page.posted.length - 1]).toMatchObject({
      command: "textPreviewResponse",
      requestId: "req-2",
      error: "/tmp/blob.bin is not a text file",
    });
  });

  test("回包里缺 truncated / encodingIssue 时按 false 报（页面不说「截断了」）", async () => {
    const page = startPage();
    await flush();

    page.api.postMessage({
      command: "getTextPreview",
      path: "/tmp/a.md",
      requestId: "req-3",
    });
    await flush();

    const frame = page.socket.framesFor("getTextPreview")[0]!;
    page.socket.receive({
      id: frame.id,
      method: "result",
      params: { result: { content: "# t\n" } },
    });
    await flush();

    expect(page.posted[page.posted.length - 1]).toMatchObject({
      command: "textPreviewResponse",
      requestId: "req-3",
      content: "# t\n",
      truncated: false,
      encodingIssue: false,
    });
  });
});

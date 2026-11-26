/**
 * 预览面板取源码的请求器（spec desktop-preview.md「HTML 预览的源码视图」）。
 *
 * 它和远控页取图/取文本共用同一张待办表（`previewRequest.ts`），所以这里钉的是
 * 本通道自己的四条契约：
 * - 发的是 `desktopPreviewSource`，带路径与 requestId（宿主据此回包）；
 * - 回包按 requestId 对上号，交出内容 + 宿主的截断判定；
 * - 失败必须 resolve 成给人看的文案（面板据此画错误态，不能静默）；
 * - 宿主没回音时自己收场。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  requestPreviewSource,
  PREVIEW_SOURCE_TIMEOUT_MS,
  __resetPreviewSourceRequestsForTesting,
} from "../../src/utils/previewSourceRequest";

function fakePost() {
  const sent: Array<Record<string, unknown>> = [];
  return {
    sent,
    post: (message: Record<string, unknown>) => sent.push(message),
  };
}

function reply(payload: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent("message", { data: payload }));
}

beforeEach(() => {
  __resetPreviewSourceRequestsForTesting();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("requestPreviewSource", () => {
  it("发出 desktopPreviewSource，带上路径与 requestId", () => {
    const host = fakePost();
    void requestPreviewSource(host.post, "/work/a/index.html");

    expect(host.sent).toHaveLength(1);
    expect(host.sent[0]).toMatchObject({
      command: "desktopPreviewSource",
      path: "/work/a/index.html",
    });
    expect(typeof host.sent[0]!.requestId).toBe("string");
  });

  it("回包对上 requestId 后交出内容与截断标记", async () => {
    const host = fakePost();
    const pending = requestPreviewSource(host.post, "/work/a/index.html");
    const requestId = host.sent[0]!.requestId as string;

    reply({
      command: "desktopPreviewSourceResult",
      requestId,
      path: "/work/a/index.html",
      content: "<h1>hi</h1>",
      truncated: true,
    });

    await expect(pending).resolves.toEqual({
      content: "<h1>hi</h1>",
      truncated: true,
    });
  });

  it("宿主明确拒绝时原样交出它那句原因", async () => {
    const host = fakePost();
    const pending = requestPreviewSource(host.post, "/work/a/gone.html");
    const requestId = host.sent[0]!.requestId as string;

    reply({
      command: "desktopPreviewSourceResult",
      requestId,
      path: "/work/a/gone.html",
      error: "文件不存在：/work/a/gone.html",
    });

    await expect(pending).resolves.toEqual({
      error: "文件不存在：/work/a/gone.html",
    });
  });

  it("回包没有内容字段时给一句可见文案，而不是空白代码区", async () => {
    const host = fakePost();
    const pending = requestPreviewSource(host.post, "/work/a/a.html");
    const requestId = host.sent[0]!.requestId as string;

    reply({
      command: "desktopPreviewSourceResult",
      requestId,
      path: "/work/a/a.html",
    });

    await expect(pending).resolves.toEqual({
      error: "这台电脑没有回文件内容。",
    });
  });

  it("宿主没回音时按 15 秒自己收场", async () => {
    const host = fakePost();
    const pending = requestPreviewSource(host.post, "/work/a/slow.html");

    await vi.advanceTimersByTimeAsync(PREVIEW_SOURCE_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({
      error: "读取文件超时，请稍后重试。",
    });
  });
});

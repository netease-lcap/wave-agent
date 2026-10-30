/**
 * 页面侧的取文本请求器。它和取图共用同一张待办表（`previewRequest.ts`），所以
 * 除了「取文本自己的三条契约」之外，还要测住**两条通道互不串号**：
 * - 回包按 `requestId` 对上号，且只认自己那条命令的回包；
 * - 失败必须 resolve 成给人看的文案（打不开不能是静默的）；
 * - 宿主没回音时自己收场。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  requestTextPreview,
  TEXT_PREVIEW_TIMEOUT_MS,
  __resetTextPreviewRequestsForTesting,
} from "../../src/utils/textPreviewRequest";
import { requestImagePreview } from "../../src/utils/imagePreviewRequest";

function fakeHost() {
  const sent: Array<Record<string, unknown>> = [];
  return {
    sent,
    postMessage: (message: unknown) =>
      sent.push(message as Record<string, unknown>),
  };
}

function reply(payload: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent("message", { data: payload }));
}

beforeEach(() => {
  __resetTextPreviewRequestsForTesting();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("requestTextPreview", () => {
  it("发出 getTextPreview，带上路径与 requestId", async () => {
    const host = fakeHost();
    void requestTextPreview(host, "/tmp/build.log");

    expect(host.sent).toHaveLength(1);
    expect(host.sent[0]).toMatchObject({
      command: "getTextPreview",
      path: "/tmp/build.log",
    });
    expect(typeof host.sent[0]!.requestId).toBe("string");
  });

  it("回包对上 requestId 后交出内容与截断 / 编码两个标记", async () => {
    const host = fakeHost();
    const pending = requestTextPreview(host, "/tmp/build.log");
    const requestId = host.sent[0]!.requestId as string;

    reply({
      command: "textPreviewResponse",
      requestId,
      content: "build ok\n",
      bytes: 5_242_880,
      returnedBytes: 262_144,
      truncated: true,
      encodingIssue: true,
    });

    await expect(pending).resolves.toEqual({
      content: "build ok\n",
      bytes: 5_242_880,
      returnedBytes: 262_144,
      truncated: true,
      encodingIssue: true,
    });
  });

  it("宿主明确拒绝时原样交出它那句原因", async () => {
    const host = fakeHost();
    const pending = requestTextPreview(host, "/tmp/blob.bin");
    const requestId = host.sent[0]!.requestId as string;

    reply({
      command: "textPreviewResponse",
      requestId,
      error: "/tmp/blob.bin is not a text file",
    });

    await expect(pending).resolves.toEqual({
      error: "/tmp/blob.bin is not a text file",
    });
  });

  it("回包没有内容字段时给一句可见文案，而不是空弹层", async () => {
    const host = fakeHost();
    const pending = requestTextPreview(host, "/tmp/a.md");
    const requestId = host.sent[0]!.requestId as string;

    reply({ command: "textPreviewResponse", requestId });

    await expect(pending).resolves.toEqual({
      error: "这台电脑没有回文件内容。",
    });
  });

  it("宿主没回音时按 25 秒自己收场", async () => {
    const host = fakeHost();
    const pending = requestTextPreview(host, "/tmp/slow.log");

    await vi.advanceTimersByTimeAsync(TEXT_PREVIEW_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({
      error: "等了 25 秒还没拿到这份文件。它可能太大，或者这台电脑不支持预览。",
    });
  });

  it("与取图共用待办表也不串号：两条通道的 requestId 不同、各收各的回包", async () => {
    const host = fakeHost();
    const text = requestTextPreview(host, "/tmp/a.log");
    const image = requestImagePreview(host, "/tmp/a.png");
    const textId = host.sent[0]!.requestId as string;
    const imageId = host.sent[1]!.requestId as string;

    expect(textId).not.toBe(imageId);

    // 先回图，再回文本：谁先回来都不影响对方。
    reply({
      command: "imagePreviewResponse",
      requestId: imageId,
      dataUrl: "data:image/png;base64,AAAA",
      scaled: false,
    });
    reply({
      command: "textPreviewResponse",
      requestId: textId,
      content: "hello\n",
      bytes: 6,
      returnedBytes: 6,
      truncated: false,
      encodingIssue: false,
    });

    await expect(image).resolves.toEqual({
      dataUrl: "data:image/png;base64,AAAA",
      scaled: false,
    });
    await expect(text).resolves.toMatchObject({ content: "hello\n" });
  });
});

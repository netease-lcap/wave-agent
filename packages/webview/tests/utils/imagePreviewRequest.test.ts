/**
 * 页面侧的取图请求器。行为契约只有三条，但每条都对应一种「用户看着不对」：
 * - 回包必须按 `requestId` 对上号（连点两张图，晚到的那张不能顶掉新的）；
 * - 失败必须 resolve 成给人看的文案（弹不出图不能是静默的）；
 * - 宿主没回音时必须自己收场（否则用户对着「没有反应」等下去）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  requestImagePreview,
  IMAGE_PREVIEW_TIMEOUT_MS,
  __resetImagePreviewRequestsForTesting,
} from "../../src/utils/imagePreviewRequest";

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
  __resetImagePreviewRequestsForTesting();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("requestImagePreview", () => {
  it("发出 getImagePreview，带上路径与 requestId", async () => {
    const host = fakeHost();
    void requestImagePreview(host, "/tmp/shots/before.png");

    expect(host.sent).toHaveLength(1);
    expect(host.sent[0]).toMatchObject({
      command: "getImagePreview",
      path: "/tmp/shots/before.png",
    });
    expect(typeof host.sent[0]!.requestId).toBe("string");
  });

  it("回包对上 requestId 后交出 dataUrl 与是否压过", async () => {
    const host = fakeHost();
    const pending = requestImagePreview(host, "/tmp/a.png");
    const requestId = host.sent[0]!.requestId as string;

    reply({
      command: "imagePreviewResponse",
      requestId,
      dataUrl: "data:image/png;base64,AAAA",
      scaled: true,
    });

    await expect(pending).resolves.toEqual({
      dataUrl: "data:image/png;base64,AAAA",
      scaled: true,
    });
  });

  it("晚到的旧回复不串到新请求上（连点两张图）", async () => {
    const host = fakeHost();
    const first = requestImagePreview(host, "/tmp/a.png");
    const second = requestImagePreview(host, "/tmp/b.png");
    const [idA, idB] = host.sent.map((m) => m.requestId as string);

    // 顺序反着回：第二张先到，第一张后到。
    reply({
      command: "imagePreviewResponse",
      requestId: idB,
      dataUrl: "data:image/png;base64,BBBB",
    });
    reply({
      command: "imagePreviewResponse",
      requestId: idA,
      dataUrl: "data:image/png;base64,AAAA",
    });

    await expect(second).resolves.toEqual({
      dataUrl: "data:image/png;base64,BBBB",
      scaled: false,
    });
    await expect(first).resolves.toEqual({
      dataUrl: "data:image/png;base64,AAAA",
      scaled: false,
    });
  });

  it("宿主拒绝时把它的原话交出去，不再包一层", async () => {
    const host = fakeHost();
    const pending = requestImagePreview(host, "/tmp/notes.png");
    const requestId = host.sent[0]!.requestId as string;

    reply({
      command: "imagePreviewResponse",
      requestId,
      error: "/tmp/notes.png is not a supported image (svg)",
    });

    await expect(pending).resolves.toEqual({
      error: "/tmp/notes.png is not a supported image (svg)",
    });
  });

  it("回了但没有图（既无 dataUrl 也无 error）也不静默", async () => {
    const host = fakeHost();
    const pending = requestImagePreview(host, "/tmp/a.png");
    const requestId = host.sent[0]!.requestId as string;

    reply({ command: "imagePreviewResponse", requestId });

    const outcome = await pending;
    expect(outcome).toHaveProperty("error");
    expect((outcome as { error: string }).error).not.toBe("");
  });

  it("宿主没回音 → 到点自己收场，并说明是「等太久」", async () => {
    const host = fakeHost();
    const pending = requestImagePreview(host, "/tmp/a.png");

    await vi.advanceTimersByTimeAsync(IMAGE_PREVIEW_TIMEOUT_MS - 1);
    // 差一毫秒仍在等：此刻推进不足不能提前报超时。
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(1);
    const outcome = await pending;
    expect(outcome).toHaveProperty("error");
    expect((outcome as { error: string }).error).toContain("秒");
  });

  it("超时之后到的回包不再改写已经给出的结论", async () => {
    const host = fakeHost();
    const pending = requestImagePreview(host, "/tmp/a.png");
    const requestId = host.sent[0]!.requestId as string;

    await vi.advanceTimersByTimeAsync(IMAGE_PREVIEW_TIMEOUT_MS);
    const outcome = await pending;
    expect(outcome).toHaveProperty("error");

    reply({
      command: "imagePreviewResponse",
      requestId,
      dataUrl: "data:image/png;base64,AAAA",
    });
    // 没有第二份回包排队 → 只会 settle 一次，promise 已经定格。
    await expect(pending).resolves.toBe(outcome);
  });

  it("只认 imagePreviewResponse，别的命令被忽略", async () => {
    const host = fakeHost();
    const pending = requestImagePreview(host, "/tmp/a.png");
    const requestId = host.sent[0]!.requestId as string;

    reply({ command: "fileContent", requestId, content: "text" });
    reply({
      command: "imagePreviewResponse",
      requestId,
      dataUrl: "data:x/y;base64,AA",
    });

    await expect(pending).resolves.toEqual({
      dataUrl: "data:x/y;base64,AA",
      scaled: false,
    });
  });
});

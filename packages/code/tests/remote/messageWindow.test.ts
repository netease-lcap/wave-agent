import { describe, it, expect } from "vitest";
import {
  InvalidMessageWindowError,
  normalizeMessageWindow,
} from "../../src/remote/messageWindow.js";

/**
 * The window *validation* is the wire contract shared by every host that
 * answers `getMessages` (spec ui/remote-control.md §5). The paging arithmetic
 * moved into the SDK (`readTranscriptPage` covers the page walk, the anchor
 * rules and the byte budget), so what is left to pin here is the one thing a
 * caller cannot notice on its own: a malformed window must fail instead of
 * silently widening into a full read.
 */

describe("normalizeMessageWindow", () => {
  it("answers undefined when no window was asked for", () => {
    // 老宿主 / 老调用方走这条路径：没有窗口参数就是「全量」，不能被悄悄截成
    // 一页 —— 那是调用方察觉不到的失败。
    expect(normalizeMessageWindow(undefined)).toBeUndefined();
    expect(normalizeMessageWindow({})).toBeUndefined();
  });

  it("passes a window through untouched", () => {
    expect(normalizeMessageWindow({ before: "m3", limit: 20 })).toEqual({
      before: "m3",
      limit: 20,
    });
    // No `limit`: the SDK fills in its page size, so anchoring alone still
    // yields a bounded page rather than everything on one side of the anchor.
    expect(normalizeMessageWindow({ since: "m3" })).toEqual({ since: "m3" });
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "rejects limit=%s instead of silently widening the read",
    (limit) => {
      // 静默放宽读是调用方唯一察觉不到的失败方式：它要了一份有界页，拿回了
      // 整条会话。
      expect(() => normalizeMessageWindow({ limit })).toThrow(
        InvalidMessageWindowError,
      );
    },
  );
});

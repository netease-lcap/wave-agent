import { describe, it, expect } from "vitest";
import { formatMessageTime } from "../../src/utils/messageTime";

/**
 * 底部动作行里的时间（spec: ui/message-rendering-system.md「助手消息底部的时间戳」）。
 *
 * `now` 显式传入，否则「同一天」的判定会随跑测试的时刻漂移；时间戳用本地时间构造，
 * 避免 CI（UTC）与本机（+08）算出来的时分不一样。
 */
describe("formatMessageTime", () => {
  const now = new Date(2026, 10, 5, 14, 30);

  it("shows only the time when the message is from today", () => {
    const timestamp = new Date(2026, 10, 5, 9, 5).toISOString();
    expect(formatMessageTime(timestamp, now)).toEqual({
      iso: timestamp,
      label: "09:05",
      full: "2026年11月5日 09:05",
    });
  });

  it("adds the date when the message is from another day of the same year", () => {
    const timestamp = new Date(2026, 10, 3, 23, 59).toISOString();
    expect(formatMessageTime(timestamp, now)).toEqual({
      iso: timestamp,
      label: "11月3日 23:59",
      full: "2026年11月3日 23:59",
    });
  });

  it("adds the year when the message is from another year", () => {
    const timestamp = new Date(2025, 11, 31, 8, 0).toISOString();
    expect(formatMessageTime(timestamp, now)?.label).toBe(
      "2025年12月31日 08:00",
    );
  });

  it("keeps the raw timestamp for datetime, not the localized label", () => {
    const timestamp = "2025-07-09T10:30:01.000Z";
    // 可见文本随本地时区变，datetime 不变（场景 4 / 边界「跟着本地时区走」）。
    expect(formatMessageTime(timestamp, now)?.iso).toBe(timestamp);
  });

  it("returns null for a missing or unparseable timestamp", () => {
    // 场景 6：老数据没有该字段时整块不渲染，而不是显示 Invalid Date。
    expect(formatMessageTime(undefined, now)).toBeNull();
    expect(formatMessageTime("", now)).toBeNull();
    expect(formatMessageTime("not-a-date", now)).toBeNull();
  });
});

/**
 * Tests for the process-level host notice channel.
 *
 * The channel itself is stateless (de-duplication belongs to each source), so
 * these cases only cover the subscription contract: deliver to every current
 * subscriber, stop after unsubscribe, and never let a throwing subscriber break
 * the emitting flow.
 */

import { describe, it, expect } from "vitest";
import {
  emitHostNotice,
  onHostNotice,
  type HostNotice,
} from "../../src/services/hostNotice.js";

describe("hostNotice", () => {
  it("delivers the notice to a subscriber and stops after unsubscribe", () => {
    const seen: HostNotice[] = [];
    const off = onHostNotice((notice) => seen.push(notice));

    emitHostNotice({ kind: "authExpired", message: "登录已过期，请重新登录" });
    off();
    emitHostNotice({ kind: "authExpired", message: "登录已过期，请重新登录" });

    expect(seen).toEqual([
      { kind: "authExpired", message: "登录已过期，请重新登录" },
    ]);
  });

  it("delivers to every current subscriber", () => {
    const first: HostNotice[] = [];
    const second: HostNotice[] = [];
    const offFirst = onHostNotice((notice) => first.push(notice));
    const offSecond = onHostNotice((notice) => second.push(notice));

    try {
      emitHostNotice({
        kind: "configParseError",
        message: "设置文件解析失败：/tmp/settings.json（本轮忽略该文件）",
      });

      expect(first).toEqual(second);
      expect(first).toHaveLength(1);
      expect(first[0].kind).toBe("configParseError");
    } finally {
      offFirst();
      offSecond();
    }
  });

  it("only removes the unsubscribed subscriber", () => {
    const kept: HostNotice[] = [];
    const dropped: HostNotice[] = [];
    const offKept = onHostNotice((notice) => kept.push(notice));
    const offDropped = onHostNotice((notice) => dropped.push(notice));

    try {
      offDropped();
      emitHostNotice({ kind: "licenseBlocked", message: "产品尚未授权" });

      expect(kept).toHaveLength(1);
      expect(dropped).toHaveLength(0);
    } finally {
      offKept();
    }
  });

  it("keeps delivering when a subscriber throws", () => {
    const seen: HostNotice[] = [];
    const offThrowing = onHostNotice(() => {
      throw new Error("subscriber blew up");
    });
    const offHealthy = onHostNotice((notice) => seen.push(notice));

    try {
      emitHostNotice({ kind: "licenseBlocked", message: "产品尚未授权" });

      // 订阅者抛错不能打断发起方（一次 fetch / 一次 refresh / 一次配置加载）。
      expect(seen).toHaveLength(1);
    } finally {
      offThrowing();
      offHealthy();
    }
  });

  it("is a no-op when nobody is subscribed", () => {
    expect(() =>
      emitHostNotice({
        kind: "authExpired",
        message: "登录已过期，请重新登录",
      }),
    ).not.toThrow();
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  livePanelGroupKeys,
  parkGroup,
  parkedGroupsFor,
  pruneParkedGroups,
  releaseParkedGroups,
  resetParkedGroups,
  subscribeParkedGroups,
  unparkGroup,
} from "../../src/utils/previewGuestKeep";

/**
 * preview guest 跨会话保活的台账（spec desktop-right-panel.md「右侧面板 · preview
 * guest 跨会话保活」场景 3-4）。台账只是一个「谁停靠了哪些组」的集合：**没有数量
 * 上限、不做 LRU 逐出**（对齐 Claude 桌面端 Browser pane），销毁只发生在关 tab /
 * 删会话 / 关分屏 / 退出应用。
 */
describe("preview guest keep-alive ledger", () => {
  beforeEach(() => {
    resetParkedGroups();
  });

  it("hands each instance only its own groups", () => {
    const a = {};
    const b = {};
    parkGroup(a, "s1", 1);
    parkGroup(a, "s2", 1);
    parkGroup(b, "s3", 1);

    expect(parkedGroupsFor(a)).toEqual(["s1", "s2"]);
    expect(parkedGroupsFor(b)).toEqual(["s3"]);
  });

  it("returns a stable reference until something changes (useSyncExternalStore)", () => {
    const a = {};
    parkGroup(a, "s1", 1);
    const first = parkedGroupsFor(a);
    expect(parkedGroupsFor(a)).toBe(first);
    parkGroup(a, "s2", 1);
    expect(parkedGroupsFor(a)).not.toBe(first);
    expect(parkedGroupsFor(a)).toEqual(["s1", "s2"]);
  });

  it("does not duplicate a group that is parked again", () => {
    const a = {};
    parkGroup(a, "s1", 1);
    parkGroup(a, "s2", 1);
    const before = parkedGroupsFor(a);
    parkGroup(a, "s1", 1);
    expect(parkedGroupsFor(a)).toEqual(["s1", "s2"]);
    // 重复登记不该惊动订阅方（否则每次切会话都会白重渲染一次）。
    expect(parkedGroupsFor(a)).toBe(before);
  });

  it("does not keep an entry for a group with no preview guest", () => {
    const a = {};
    parkGroup(a, "s1", 0);
    expect(parkedGroupsFor(a)).toEqual([]);
  });

  it("keeps every parked group — no cap, no eviction", () => {
    const a = {};
    // 六个组、各自多个 preview tab：全部保活，最久未用的那个也不销毁。
    for (const group of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
      parkGroup(a, group, 3);
    }
    expect(parkedGroupsFor(a)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
    // 再切走第 7 个：前面一个都不掉。
    parkGroup(a, "s7", 3);
    expect(parkedGroupsFor(a)).toHaveLength(7);
    expect(parkedGroupsFor(a)).toContain("s1");
  });

  it("keeps the guests of every instance — the ledger is window-wide, not capped", () => {
    const a = {};
    const b = {};
    for (const group of ["s1", "s2", "s3", "s4", "s5"]) parkGroup(a, group, 1);
    for (const group of ["t1", "t2", "t3"]) parkGroup(b, group, 1);
    expect(parkedGroupsFor(a)).toHaveLength(5);
    expect(parkedGroupsFor(b)).toEqual(["t1", "t2", "t3"]);
  });

  it("moves ownership when another instance parks the same group", () => {
    const a = {};
    const b = {};
    parkGroup(a, "s1", 1);
    // 会话被移到另一个分屏：同一个组改由 b 渲染，台账里只能有一份（否则同一个
    // tab 会在两个 pane 的停靠层里各挂一个 guest）。
    parkGroup(b, "s1", 1);
    expect(parkedGroupsFor(a)).toEqual([]);
    expect(parkedGroupsFor(b)).toEqual(["s1"]);
  });

  it("drops a group when another instance brings it back to the foreground", () => {
    const a = {};
    const b = {};
    parkGroup(a, "s1", 1);
    // s1 在另一个分屏里被重新打开：guest 由那边渲染，台账条目整体摘掉（否则同一
    // 个 tab 会在两个 pane 的停靠层里各挂一个 guest）。
    unparkGroup("s1");
    expect(parkedGroupsFor(a)).toEqual([]);
    expect(parkedGroupsFor(b)).toEqual([]);
  });

  it("releases an instance's groups when it unmounts", () => {
    const a = {};
    const b = {};
    parkGroup(a, "s1", 1);
    parkGroup(b, "s2", 1);
    releaseParkedGroups(a);
    expect(parkedGroupsFor(a)).toEqual([]);
    // 别的分屏的停靠组不受影响。
    expect(parkedGroupsFor(b)).toEqual(["s2"]);
  });

  it("forgets groups whose session/pane is gone (same rule as sessionUi.prune)", () => {
    const a = {};
    parkGroup(a, "s1", 1);
    parkGroup(a, "s2", 1);
    pruneParkedGroups(new Set(["s2"]));
    expect(parkedGroupsFor(a)).toEqual(["s2"]);
  });

  it("notifies subscribers after the ledger changes", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeParkedGroups(listener);
    expect(listener).not.toHaveBeenCalled();

    parkGroup({}, "s1", 1);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    unparkGroup("s1");
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("livePanelGroupKeys", () => {
  it("keeps pane buckets, bound sessions and every session in the tree", () => {
    expect(
      livePanelGroupKeys(
        [
          {
            paneId: "pane-1",
            sessionId: "s1",
            row: 0,
            host: "local",
            width: 1,
          },
          { paneId: "pane-2", row: 0, host: "local", width: 1 },
        ],
        [
          {
            host: "local",
            workdir: "/work/a",
            sessions: [
              {
                sessionId: "s2",
                title: "s2",
                lastActiveAt: 0,
                hasWorktree: false,
              },
            ],
          },
        ],
      ),
    ).toEqual(new Set(["new:pane-1", "new:pane-2", "s1", "s2"]));
  });
});

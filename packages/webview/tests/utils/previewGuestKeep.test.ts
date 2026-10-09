import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  PREVIEW_GUEST_LIMIT,
  livePanelGroupKeys,
  parkGroup,
  parkedGroupsFor,
  pruneParkedGroups,
  releaseParkedGroups,
  reportLiveGuests,
  resetParkedGroups,
  subscribeParkedGroups,
  unparkGroup,
} from "../../src/utils/previewGuestKeep";

/**
 * preview guest 跨会话保活的台账（spec desktop-panels.md「右侧面板 · preview
 * guest 跨会话保活」场景 3-4、边界「preview guest 保活额度」）。额度是窗口级、
 * 跨分屏共享、含当前可见者，超出按最久未使用淘汰。
 */
describe("preview guest keep-alive ledger", () => {
  beforeEach(() => {
    resetParkedGroups();
  });

  it("keeps the MRU order and hands each instance only its own groups", () => {
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

  it("re-parks a group at the MRU end instead of duplicating it", () => {
    const a = {};
    parkGroup(a, "s1", 1);
    parkGroup(a, "s2", 1);
    parkGroup(a, "s1", 1);
    expect(parkedGroupsFor(a)).toEqual(["s2", "s1"]);
  });

  it("does not keep an entry for a group with no preview guest", () => {
    const a = {};
    parkGroup(a, "s1", 0);
    expect(parkedGroupsFor(a)).toEqual([]);
  });

  it("counts every preview tab of a group against the quota", () => {
    const a = {};
    parkGroup(a, "s1", 3);
    parkGroup(a, "s2", 1);
    // 3 + 1 = 4 → 恰好满额，两个都还在。
    expect(parkedGroupsFor(a)).toEqual(["s1", "s2"]);
    parkGroup(a, "s3", 1);
    // 5 > 4 → 最久未使用的 s1 整组（3 个 guest）一起销毁。
    expect(parkedGroupsFor(a)).toEqual(["s2", "s3"]);
  });

  it("evicts the least recently used group once the window quota is full", () => {
    const a = {};
    for (const group of ["s1", "s2", "s3", "s4"]) parkGroup(a, group, 1);
    expect(parkedGroupsFor(a)).toEqual(["s1", "s2", "s3", "s4"]);

    parkGroup(a, "s5", 1);
    expect(parkedGroupsFor(a)).toEqual(["s2", "s3", "s4", "s5"]);
    expect(PREVIEW_GUEST_LIMIT).toBe(4);
  });

  it("counts a group once even while it is both leaving and parked", () => {
    const a = {};
    reportLiveGuests(a, "s1", 1);
    // 刚切走的那一瞬间：s1 既是「上一刻的可见组」又刚登记为停靠组，只能算一份，
    // 否则额度凭空少一个、白白多淘汰一个会话。
    parkGroup(a, "s1", 1);
    reportLiveGuests(a, "s2", 1);
    parkGroup(a, "s2", 1);
    reportLiveGuests(a, "s3", 1);
    parkGroup(a, "s3", 1);
    // 三个组各 1 个 guest < 4 → 一个都不淘汰。
    expect(parkedGroupsFor(a)).toEqual(["s1", "s2", "s3"]);
  });

  it("counts the visible guests of every instance against the quota", () => {
    const a = {};
    const b = {};
    // 两个分屏各显示一个 preview（a 显示 s1、b 显示 s9，各 1 个可见 guest）。
    reportLiveGuests(a, "s1", 1);
    reportLiveGuests(b, "s9", 1);
    parkGroup(a, "s1", 1);
    parkGroup(a, "s2", 1);
    parkGroup(a, "s3", 1);
    // 可见 s9 + 停靠 s1/s2/s3 = 4，刚好。
    expect(parkedGroupsFor(a)).toEqual(["s1", "s2", "s3"]);

    // b 那一侧再多一个可见 guest：总量 5 > 4 → 淘汰最久未用的 s1。
    reportLiveGuests(b, "s9", 2);
    expect(parkedGroupsFor(a)).toEqual(["s2", "s3"]);

    // 可见数回落不恢复（被淘汰者已销毁，切回按记忆地址重新加载）。
    reportLiveGuests(b, "s9", 1);
    expect(parkedGroupsFor(a)).toEqual(["s2", "s3"]);
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

  it("releases an instance's groups and its live count when it unmounts", () => {
    const a = {};
    const b = {};
    parkGroup(a, "s1", 1);
    reportLiveGuests(a, "s1", 1);
    releaseParkedGroups(a);
    expect(parkedGroupsFor(a)).toEqual([]);

    // a 的可见额度已释放，b 再停靠一组不会因为 a 的残留计数被挤掉。
    reportLiveGuests(b, "s9", 3);
    parkGroup(b, "s2", 1);
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

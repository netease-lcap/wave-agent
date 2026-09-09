import { describe, it, expect, beforeEach } from "vitest";
import {
  sessionUi,
  emptySessionUiState,
  prunePanelGroupCache,
} from "../../src/utils/sessionUiStore";

describe("sessionUiStore", () => {
  beforeEach(() => {
    sessionUi.prune(new Set());
  });

  it("set + get round-trips a snapshot; missing keys read undefined", () => {
    expect(sessionUi.get("s1")).toBeUndefined();

    sessionUi.set("s1", {
      ...emptySessionUiState(),
      panelExpanded: true,
      planContent: "## plan",
    });
    expect(sessionUi.get("s1")?.panelExpanded).toBe(true);
    expect(sessionUi.get("s1")?.planContent).toBe("## plan");
  });

  it("patch merges into the existing snapshot (previewUrl write-back path)", () => {
    sessionUi.set("s1", {
      ...emptySessionUiState(),
      checked: [{ id: "p1", kind: "preview", previewUrl: "http://a" }] as never,
    });

    sessionUi.patch("s1", { panelExpanded: true });
    expect(sessionUi.get("s1")?.panelExpanded).toBe(true);
    expect(sessionUi.get("s1")?.checked).toHaveLength(1);

    // tab-level patch: update only the matching tab's URL, keep the rest
    const cached = sessionUi.get("s1")!;
    sessionUi.patch("s1", {
      checked: cached.checked.map((t) =>
        t.id === "p1" ? { ...t, previewUrl: "http://b" } : t,
      ),
    });
    expect(sessionUi.get("s1")?.checked[0]).toMatchObject({
      previewUrl: "http://b",
    });
  });

  it("patch creates an empty group when the key has no entry (forward 即时落缓存)", () => {
    sessionUi.patch("new:pane-1", {
      forward: {
        host: "local",
        remotePort: 5173,
        originalUrl: "http://localhost:5173",
        requestId: "fwd-1",
      },
    });
    const group = sessionUi.get("new:pane-1");
    expect(group?.forward?.requestId).toBe("fwd-1");
    // fields untouched by the patch start from the empty defaults
    expect(group?.panelWidth).toBe(420);
    expect(group?.panelExpanded).toBe(false);
  });

  it("move migrates the new-session bucket to the session id (swap effect)", () => {
    sessionUi.set("new:pane-1", {
      ...emptySessionUiState(),
      panelExpanded: true,
    });

    // no own entry → the bucket migrates and is returned
    const moved = sessionUi.move("new:pane-1", "s1");
    expect(moved?.panelExpanded).toBe(true);
    expect(sessionUi.get("s1")?.panelExpanded).toBe(true);
    expect(sessionUi.get("new:pane-1")).toBeUndefined();

    // an existing entry at the target wins (no clobber, source kept)
    sessionUi.set("new:pane-2", {
      ...emptySessionUiState(),
      planContent: "from",
    });
    sessionUi.set("s2", { ...emptySessionUiState(), planContent: "target" });
    expect(sessionUi.move("new:pane-2", "s2")?.planContent).toBe("target");
    expect(sessionUi.get("s2")?.planContent).toBe("target");
    expect(sessionUi.get("new:pane-2")?.planContent).toBe("from");
  });

  it("keyByForwardRequestId finds the owning session; unknown ids miss", () => {
    sessionUi.patch("s1", {
      forward: {
        host: "local",
        remotePort: 80,
        originalUrl: "http://x",
        requestId: "fwd-9",
      },
    });
    sessionUi.patch("s2", {
      forward: {
        host: "local",
        remotePort: 81,
        originalUrl: "http://y",
        requestId: "fwd-10",
      },
    });
    expect(sessionUi.keyByForwardRequestId("fwd-9")).toBe("s1");
    expect(sessionUi.keyByForwardRequestId("fwd-10")).toBe("s2");
    expect(sessionUi.keyByForwardRequestId("fwd-404")).toBeUndefined();
  });

  it("prune drops keys whose owner is gone and keeps live ones (失效规则)", () => {
    sessionUi.set("s-live", emptySessionUiState());
    sessionUi.set("s-deleted", emptySessionUiState());
    sessionUi.set("new:pane-live", emptySessionUiState());

    prunePanelGroupCache(new Set(["s-live", "new:pane-live"]));

    expect(sessionUi.get("s-live")).toBeDefined();
    expect(sessionUi.get("new:pane-live")).toBeDefined();
    expect(sessionUi.get("s-deleted")).toBeUndefined();
  });

  // ── projectSettings 快照区（workdir 维度，a3043966 stamp 迁入） ──

  it("projectSettings round-trips per workdir key; other directories miss", () => {
    expect(sessionUi.getProjectSettings("/proj/A")).toBeUndefined();

    sessionUi.setProjectSettings("/proj/A", {
      enabledPlugins: { "sdd@builtin": true },
    });
    expect(sessionUi.getProjectSettings("/proj/A")).toEqual({
      enabledPlugins: { "sdd@builtin": true },
    });
    // key = workdir：另一目录读不到 A 的快照（数据按项目作用域隔离）
    expect(sessionUi.getProjectSettings("/proj/B")).toBeUndefined();

    sessionUi.setProjectSettings("/proj/A", { enabledPlugins: {} });
    expect(sessionUi.getProjectSettings("/proj/A")).toEqual({
      enabledPlugins: {},
    });
  });

  it("projectSettings section is independent of the session-keyed cache (prune 不波及)", () => {
    sessionUi.setProjectSettings("/proj/A", { enabledPlugins: {} });
    sessionUi.set("s1", emptySessionUiState());

    sessionUi.prune(new Set());

    // workdir 维度条目不受会话键失效清理影响（寿命 = webview 实例）
    expect(sessionUi.getProjectSettings("/proj/A")).toEqual({
      enabledPlugins: {},
    });
  });
});

import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModManager } from "../../src/managers/modManager.js";
import { MOD_LIMITS } from "../../src/types/mods.js";
import type { ModPanelUpdatePayload } from "../../src/types/mods.js";
import type { Plugin } from "../../src/types/plugins.js";

/**
 * `ModManager` 是 mod 的宿主侧编排：编译 → 沙箱实例 → 事件 → 面板快照。
 *
 * 这里把两条外部依赖换成假的：esbuild（源码原样返回，测试 mod 直接写成 CJS，
 * 真转译由 `compile.test.ts` 覆盖）与文件系统（按路径喂源码 / store 内容）。
 * 剩下被测的是编排本身：谁拿到哪个面板、revision 怎么涨、关闭怎么通知、插件
 * 重载之后还活在不在。
 */

const probe = vi.hoisted(() => ({
  esbuild: undefined as unknown,
  files: new Map<string, string>(),
}));

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/utils/esbuild.js", () => ({
  getEsbuild: () => probe.esbuild,
}));

vi.mock("../../src/utils/atomicWrite.js", () => ({
  atomicWriteFileSync: vi.fn((file: string, data: string) => {
    probe.files.set(file, data);
  }),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn((file: string) => {
      const content = probe.files.get(file);
      if (content === undefined) {
        throw Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });
      }
      return content;
    }),
    mkdirSync: vi.fn(),
  };
});

const ROOT = path.resolve("/fake/plugin");
const STORE_ROOT = path.resolve("/fake/store");
const MOD_PATH = path.join(ROOT, "mods", "panel.tsx");

/** 假 esbuild：把源码原样当作 CJS 产物（测试 mod 都写成 CJS）。 */
const fakeEsbuild = {
  transform: vi.fn(async (source: string) => ({ code: source })),
};

/** 一个会开面板、点按钮自增、并持久化一个 kv 的 mod。 */
const COUNTER_MOD = `
exports.register = function ($, on) {
  on("session.start", function () {
    $.ui.open({ id: "p1", title: "计数器" });
  });
  on("ui.render", function () {
    var n = $.state.get("n") || 0;
    return __wave.h("Box", null,
      __wave.h("Text", null, "n=" + n),
      __wave.h("Button", { key: "inc", label: "+1", onPress: function () {
        $.state.set("n", n + 1);
        $.store.set("total", String(n + 1));
        $.ui.invalidate("p1");
      }})
    );
  });
  on("ui.close", function (e) {
    $.store.set("closed", e.origin.kind);
  });
};
`;

function plugin(mods: Array<{ id: string; path: string }>): Plugin {
  return {
    name: "todo",
    path: ROOT,
    mods: mods.map((mod) => ({
      ...mod,
      name: path.basename(mod.path),
      pluginRoot: ROOT,
    })),
  } as unknown as Plugin;
}

function createManager(
  modSources: Record<string, string> = { [MOD_PATH]: COUNTER_MOD },
): {
  manager: ModManager;
  updates: ModPanelUpdatePayload[];
} {
  probe.files.clear();
  for (const [file, source] of Object.entries(modSources)) {
    probe.files.set(path.resolve(file), source);
  }
  const updates: ModPanelUpdatePayload[] = [];
  const manager = new ModManager({
    sessionId: "s1",
    onPanelUpdate: (payload) => updates.push(payload),
    storeRoot: STORE_ROOT,
  });
  return { manager, updates };
}

function storeFile(name: string): string {
  return path.join(STORE_ROOT, `${name}.json`);
}

beforeEach(() => {
  probe.esbuild = fakeEsbuild;
  fakeEsbuild.transform.mockClear();
});

afterEach(() => {
  probe.files.clear();
  vi.useRealTimers();
});

describe("ModManager.loadFromPlugins", () => {
  it("没有 mod 的插件什么都不做", async () => {
    const { manager, updates } = createManager();
    await manager.loadFromPlugins([{ name: "plain", path: ROOT } as Plugin]);
    await manager.startSession();

    expect(fakeEsbuild.transform).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(manager.paneSnapshots()).toEqual([]);
  });

  it("esbuild 不可用时开一个错误面板（不静默降级）", async () => {
    probe.esbuild = undefined;
    const { manager, updates } = createManager();
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      modId: "todo:panel",
      paneId: "error",
      tree: null,
    });
    expect(updates[0].error).toContain("esbuild");
    expect(fakeEsbuild.transform).not.toHaveBeenCalled();
  });

  it("session.start 打开面板后发布第一帧（revision 1）", async () => {
    const { manager, updates } = createManager();
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    await vi.waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toMatchObject({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p1",
      title: "计数器",
      revision: 1,
    });
    expect(updates[0].tree).toMatchObject({
      type: "Box",
      children: [
        { type: "Text", props: {}, children: ["n=0"] },
        { type: "Button", props: { key: "inc", label: "+1" } },
      ],
    });
  });

  it("编译失败只影响那一个 mod", async () => {
    probe.esbuild = {
      transform: vi.fn(
        async (source: string, options?: { sourcefile?: string }) => {
          if (source.includes("BROKEN")) {
            throw {
              errors: [
                {
                  text: "Unexpected token",
                  location: {
                    file: options?.sourcefile,
                    line: 3,
                    column: 5,
                  },
                },
              ],
            };
          }
          return { code: source };
        },
      ),
    };
    const brokenPath = path.join(ROOT, "mods", "broken.tsx");
    const { manager, updates } = createManager({
      [MOD_PATH]: COUNTER_MOD,
      [brokenPath]: "// BROKEN",
    });

    await manager.loadFromPlugins([
      plugin([
        { id: "todo:panel", path: MOD_PATH },
        { id: "todo:broken", path: brokenPath },
      ]),
    ]);
    await manager.startSession();

    // 好的那个照常开自己的面板，坏的那个只有一行错误摘要。
    await vi.waitFor(() => expect(updates).toHaveLength(2));
    const good = updates.find((u) => u.modId === "todo:panel");
    const broken = updates.find((u) => u.modId === "todo:broken");
    expect(good).toMatchObject({ paneId: "p1" });
    expect(good?.error).toBeUndefined();
    expect(broken).toMatchObject({ paneId: "error", tree: null });
    expect(broken?.error).toContain(`${brokenPath}:3:5:`);
  });

  it("没有 register 的文件当作共享模块，不产生面板", async () => {
    const sharedPath = path.join(ROOT, "mods", "shared.ts");
    const { manager } = createManager({
      [MOD_PATH]: COUNTER_MOD,
      [sharedPath]: `exports.label = "x";`,
    });

    await manager.loadFromPlugins([
      plugin([
        { id: "todo:panel", path: MOD_PATH },
        { id: "todo:shared", path: sharedPath },
      ]),
    ]);
    await manager.startSession();

    await vi.waitFor(() =>
      expect(manager.paneSnapshots().map((pane) => pane.modId)).toEqual([
        "todo:panel",
      ]),
    );
  });
});

describe("ModManager.handlePanelEvent", () => {
  async function opened(): Promise<{
    manager: ModManager;
    updates: ModPanelUpdatePayload[];
  }> {
    const created = createManager();
    await created.manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await created.manager.startSession();
    await vi.waitFor(() => expect(created.updates).toHaveLength(1));
    return created;
  }

  it("点击走 mod 的回调，重画后 revision 递增", async () => {
    const { manager, updates } = await opened();

    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p1",
      key: "inc",
      kind: "press",
    });

    await vi.waitFor(() => expect(updates).toHaveLength(2));
    expect(updates[1].revision).toBe(2);
    expect(JSON.stringify(updates[1].tree)).toContain("n=1");
  });

  it("交互钩子抛错只污染那一帧，下一次成功渲染把错误清掉", async () => {
    // mod 在 vm 里抛的 Error 属于另一个 realm（`instanceof Error` 判假），所以
    // 摘要必须是裸的 message、不带 `Error: ` 前缀；而且用户误点一次报错按钮之后
    // 面板不能永久停在错误页 —— 成功的那一帧要能把它清掉。
    const throwing = `
exports.register = function ($, on) {
  on("session.start", function () {
    $.ui.open({ id: "p1", title: "会炸的面板" });
  });
  on("ui.render", function () {
    return __wave.h("Box", null,
      __wave.h("Button", { key: "boom", label: "炸", onPress: function () {
        throw new Error("boom");
      }}),
      __wave.h("Button", { key: "ok", label: "好", onPress: function () {
        $.ui.invalidate("p1");
      }})
    );
  });
};
`;
    const { manager, updates } = createManager({ [MOD_PATH]: throwing });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();
    await vi.waitFor(() => expect(updates).toHaveLength(1));

    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p1",
      key: "boom",
      kind: "press",
    });
    await vi.waitFor(() => expect(updates.at(-1)?.error).toBe("boom"));

    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p1",
      key: "ok",
      kind: "press",
    });
    await vi.waitFor(() => expect(updates.at(-1)?.error).toBeUndefined(), {
      timeout: MOD_LIMITS.invalidateIntervalMs * 10,
    });
    expect(updates.at(-1)?.tree).not.toBeNull();
  });

  it("100ms 内的多次 invalidate 合并成一帧", async () => {
    const { manager, updates } = await opened();

    // 三次点击各自 invalidate 一次；间隔远小于 MOD_LIMITS.invalidateIntervalMs。
    for (let i = 0; i < 3; i++) {
      await manager.handlePanelEvent({
        sessionId: "s1",
        modId: "todo:panel",
        paneId: "p1",
        key: "inc",
        kind: "press",
      });
    }

    await vi.waitFor(() => expect(updates).toHaveLength(2), {
      timeout: MOD_LIMITS.invalidateIntervalMs * 10,
    });
    // 观察窗口要够宽：合并之后不该再冒出第 3 帧。
    await new Promise((resolve) =>
      setTimeout(resolve, MOD_LIMITS.invalidateIntervalMs * 2),
    );
    expect(updates).toHaveLength(2);
  });

  it("关面板发 closed:true，并给 mod 一次 ui.close", async () => {
    const { manager, updates } = await opened();

    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p1",
      key: "",
      kind: "close",
      origin: "person",
    });

    await vi.waitFor(() => expect(updates).toHaveLength(2));
    expect(updates[1]).toMatchObject({
      paneId: "p1",
      closed: true,
      tree: null,
    });
    expect(manager.paneSnapshots()).toEqual([]);
    expect(probe.files.get(storeFile("todo"))).toContain('"closed": "person"');
  });

  it("未知 mod / 缺 key 的事件被忽略而不抛错", async () => {
    const { manager, updates } = await opened();

    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "ghost",
      paneId: "p1",
      key: "x",
      kind: "press",
    });
    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p1",
      key: "",
      kind: "press",
    });

    expect(updates).toHaveLength(1);
  });

  it("$store 跨面板持久化到插件名下的 JSON", async () => {
    const { manager } = await opened();

    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p1",
      key: "inc",
      kind: "press",
    });
    await vi.waitFor(() =>
      expect(probe.files.get(storeFile("todo"))).toContain('"total": "1"'),
    );

    // 新建一个 manager 读同一份 store：值要能读回来。
    const { manager: second } = createManager();
    probe.files.set(storeFile("todo"), '{"total":"1"}');
    await second.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await second.startSession();

    await vi.waitFor(() =>
      expect(second.paneSnapshots()[0]?.tree).toMatchObject({
        type: "Box",
      }),
    );
  });
});

describe("ModManager.reload / dispose", () => {
  it("插件重载之后 mod 仍然生效（dispose 是终态，不能拿来做重载）", async () => {
    const { manager, updates } = createManager();
    const plugins = [plugin([{ id: "todo:panel", path: MOD_PATH }])];

    await manager.loadFromPlugins(plugins);
    await manager.startSession();
    await vi.waitFor(() => expect(updates).toHaveLength(1));

    await manager.reload(plugins);

    // 旧面板先被关掉（closed:true），再由 session.start 重新打开。
    await vi.waitFor(() => expect(updates.length).toBeGreaterThanOrEqual(3));
    expect(updates[1]).toMatchObject({ paneId: "p1", closed: true });
    expect(updates.at(-1)).toMatchObject({ paneId: "p1", title: "计数器" });
    expect(manager.paneSnapshots()).toHaveLength(1);
  });

  it("dispose 之后一切静默（agent 已销毁）", async () => {
    const { manager, updates } = createManager();
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();
    await vi.waitFor(() => expect(updates).toHaveLength(1));

    await manager.dispose("unload");
    expect(updates.at(-1)).toMatchObject({ closed: true });
    expect(manager.paneSnapshots()).toEqual([]);
    // ui.close 的 origin 真的传给了 mod。
    expect(probe.files.get(storeFile("todo"))).toContain('"closed": "unload"');

    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p1",
      key: "inc",
      kind: "press",
    });
    expect(updates.at(-1)).toMatchObject({ closed: true });
  });
});

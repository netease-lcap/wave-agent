import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModManager } from "../../src/managers/modManager.js";
import { logger } from "../../src/utils/globalLogger.js";
import { MOD_LIMITS } from "../../src/types/mods.js";
import type { ModPanelUpdatePayload } from "../../src/types/mods.js";
import type { Plugin } from "../../src/types/plugins.js";

/**
 * `ModManager` 是 mod 的宿主侧编排：编译 → 沙箱实例 → 事件 → 面板元信息。
 *
 * 这里把两条外部依赖换成假的：esbuild（源码原样返回，测试 mod 直接写成 CJS，
 * 真转译由 `compile.test.ts` 覆盖）与文件系统（按路径喂源码 / store 内容）。
 * 剩下被测的是编排本身：谁拿到哪个面板、revision 怎么涨、关闭怎么通知、插件
 * 重载之后还活在不在、树怎么由 surface 拉取。
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

/** surface 拉一帧：这就是「树从哪来」的全部（宿主不推）。 */
function pull(manager: ModManager, paneId = "p1") {
  return manager.renderPane("todo:panel", paneId);
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
    });
    expect(updates[0].error).toContain("esbuild");
    expect(fakeEsbuild.transform).not.toHaveBeenCalled();
  });

  it("session.start 只登记面板并通知过期，树由 surface 拉取（revision 1）", async () => {
    const { manager, updates } = createManager();
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    await vi.waitFor(() => expect(updates).toHaveLength(1));
    // 元信息：新面板 + 该来要树了，**不带树**（宿主不缓存）。
    expect(updates[0]).toMatchObject({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p1",
      title: "计数器",
      stale: true,
    });
    expect(updates[0]).not.toHaveProperty("tree");

    // 每来一笔请求就真跑一次 `ui.render`。
    const frame = await pull(manager);
    expect(frame.revision).toBe(1);
    expect(frame.tree).toMatchObject({
      type: "Box",
      children: [
        { type: "Text", props: {}, children: ["n=0"] },
        { type: "Button", props: { key: "inc", label: "+1" } },
      ],
    });
    // 拉取是幂等的读：再要一次，revision 继续涨而不是回同一帧。
    expect((await pull(manager)).revision).toBe(2);
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
    expect(broken).toMatchObject({ paneId: "error" });
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
    // 先把这一帧真的渲染出来：元素回调（`onPress`）是在 `h()` 里登记进 mod 的
    // 处理表的，没渲染过就没有可点的东西。
    await pull(created.manager);
    return created;
  }

  it("点击走 mod 的回调，下一次拉取拿到新的一帧（revision 递增）", async () => {
    const { manager, updates } = await opened();

    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p1",
      key: "inc",
      kind: "press",
    });

    // invalidate 只发一条 stale 元信息，不自己渲染。
    await vi.waitFor(() => expect(updates).toHaveLength(2));
    expect(updates[1]).toMatchObject({ paneId: "p1", stale: true });
    expect(updates[1]).not.toHaveProperty("tree");

    const frame = await pull(manager);
    expect(frame.revision).toBe(2);
    expect(JSON.stringify(frame.tree)).toContain("n=1");
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
    await pull(manager);

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
    await vi.waitFor(() => expect(updates).toHaveLength(3), {
      timeout: MOD_LIMITS.invalidateIntervalMs * 10,
    });
    // 成功的这一帧把错误清掉：错误只活在失败的那一帧上，拉一次新的就没了。
    const frame = await pull(manager);
    expect(frame.error).toBeUndefined();
    expect(frame.tree).not.toBeNull();
  });

  it("拉取失败时回上一帧成功的树 + 错误摘要（面板不报废）", async () => {
    // 整棵树换成一行错误文字会让面板一次性报废：用户连别的按钮都点不到。
    const throwing = `
var broken = false;
exports.register = function ($, on) {
  on("session.start", function () {
    $.ui.open({ id: "p1", title: "会炸的面板" });
  });
  on("ui.render", function () {
    if (broken) throw new Error("render 炸了");
    return __wave.h("Box", null,
      __wave.h("Text", null, "ok"),
      __wave.h("Button", { key: "break", label: "炸", onPress: function () {
        broken = true;
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

    const first = await pull(manager);
    expect(first.tree).not.toBeNull();
    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p1",
      key: "break",
      kind: "press",
    });

    const failed = await pull(manager);
    expect(failed.error).toBe("render 炸了");
    // 失败不涨 revision（没有新帧），树仍是上一帧成功那份。
    expect(failed.revision).toBe(first.revision);
    expect(failed.tree).toEqual(first.tree);
  });

  it("面板关掉之后的拉取回「面板已关闭」", async () => {
    const { manager } = await opened();
    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p1",
      key: "",
      kind: "close",
      origin: "person",
    });

    expect(await pull(manager)).toMatchObject({
      revision: 0,
      tree: null,
      error: "面板已关闭",
    });
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

  it("关面板发 closed:true，mod 收不到通知", async () => {
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
    });
    expect(manager.paneSnapshots()).toEqual([]);
    // 一期没有「面板被关掉」事件（spec「事件」）：mod 侧不该被调用，store 里
    // 也就不会多出任何东西。
    expect(probe.files.has(storeFile("todo"))).toBe(false);
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

    const frame = await second.renderPane("todo:panel", "p1");
    expect(frame.tree).toMatchObject({ type: "Box" });
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

    await manager.dispose();
    expect(updates.at(-1)).toMatchObject({ closed: true });
    expect(manager.paneSnapshots()).toEqual([]);

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

describe("ModManager 的 $.clock", () => {
  const MIN = MOD_LIMITS.timerMinIntervalMs;

  /** 面板上两个按钮：`run` 里起定时器（`body` 决定起什么），`stop` 撤销。 */
  function clockMod(body: string): string {
    return `
var timer = null;
exports.register = function ($, on) {
  on("session.start", function () { $.ui.open({ id: "p1", title: "定时" }); });
  on("ui.render", function () {
    return __wave.h("Box", null,
      __wave.h("Button", { key: "run", label: "run", onPress: function () {
        ${body}
      }}),
      __wave.h("Button", { key: "stop", label: "stop", onPress: function () {
        if (timer) { timer.cancel(); timer = null; }
      }})
    );
  });
};
`;
  }

  /** mod 里 `$.store.get(name)` 的最新值（store 每次读写都走文件）。 */
  function stored(name: string): string | undefined {
    const raw = probe.files.get(storeFile("todo"));
    return raw === undefined
      ? undefined
      : (JSON.parse(raw) as Record<string, string>)[name];
  }

  function ticks(): number {
    return Number(stored("ticks") ?? 0);
  }

  /** 一个每拍把 `ticks` 加一的定时器源码。 */
  function counting(kind: "after" | "every", ms: number): string {
    return `timer = $.clock.${kind}(${ms}, function () {
        $.store.set("ticks", String(Number($.store.get("ticks") || 0) + 1));
      });`;
  }

  /** 建出来的 manager 都在这里登记：用例之间共用同一个 store 文件，漏掉一
   * 个就是上一个用例的定时器还在往这个用例的断言里写数。 */
  const managers: ModManager[] = [];

  afterEach(async () => {
    for (const manager of managers.splice(0)) await manager.dispose();
  });

  async function started(source: string): Promise<ModManager> {
    const { manager, updates } = createManager({ [MOD_PATH]: source });
    managers.push(manager);
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();
    await vi.waitFor(() => expect(updates).toHaveLength(1));
    // 同 `opened()`：按钮的回调只有渲染过才登记进 mod 的处理表。
    await pull(manager);
    return manager;
  }

  function press(manager: ModManager, key: string): Promise<void> {
    return manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p1",
      key,
      kind: "press",
    });
  }

  /** 负向断言的观察窗口：由间隔常量派生，不写死毫秒。 */
  function watch(intervals = 2): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, MIN * intervals));
  }

  it("every 按间隔重复触发，cancel 之后不再触发", async () => {
    const manager = await started(clockMod(counting("every", MIN)));

    await press(manager, "run");
    await vi.waitFor(() => expect(ticks()).toBeGreaterThanOrEqual(2), {
      timeout: MIN * 10,
    });

    await press(manager, "stop");
    const stopped = ticks();
    await watch();
    expect(ticks()).toBe(stopped);
  });

  it("after 只跑一次", async () => {
    const manager = await started(clockMod(counting("after", MIN)));

    await press(manager, "run");
    await vi.waitFor(() => expect(stored("ticks")).toBe("1"), {
      timeout: MIN * 10,
    });
    await watch();
    expect(stored("ticks")).toBe("1");
  });

  it("小于下限的间隔夹到下限，不会被打爆", async () => {
    const manager = await started(clockMod(counting("every", 0)));

    await press(manager, "run");
    await watch(3);
    // 3 个下限间隔最多 3~4 拍；没夹取的话这 600ms 里会是几百拍。
    expect(ticks()).toBeGreaterThanOrEqual(1);
    expect(ticks()).toBeLessThanOrEqual(4);
  });

  it("超量定时器报错，前 16 个照常登记", async () => {
    const manager = await started(
      clockMod(`
      var created = 0, message = "";
      for (var i = 0; i < ${MOD_LIMITS.maxTimersPerMod + 1}; i++) {
        try { $.clock.after(60000, function () {}); created++; }
        catch (error) { message = error.message; }
      }
      $.store.set("timers", created + "|" + message);
    `),
    );

    await press(manager, "run");
    await vi.waitFor(() => expect(stored("timers")).toContain("|"));
    expect(stored("timers")).toBe(
      `${MOD_LIMITS.maxTimersPerMod}|定时器上限 ${MOD_LIMITS.maxTimersPerMod} 个（todo:panel），先 cancel 掉不用的`,
    );
  });

  it("上一拍没跑完时跳过这一拍（async 回调也一样）", async () => {
    // 跨 realm：mod 在 vm 里 `new Promise` 不是宿主 realm 的 Promise，
    // 用 `instanceof` 判就会把它当成同步完成，串行语义整个失效。
    const manager = await started(
      clockMod(`
      var inFlight = 0, maxInFlight = 0, starts = 0;
      timer = $.clock.every(${MIN}, function () {
        starts++;
        inFlight++;
        if (inFlight > maxInFlight) maxInFlight = inFlight;
        return new Promise(function (resolve) {
          $.clock.after(${MIN * 2}, function () { inFlight--; resolve(); });
        });
      });
      $.clock.after(${MIN * 6}, function () {
        $.store.set("serial", starts + "|" + maxInFlight);
      });
    `),
    );

    await press(manager, "run");
    await vi.waitFor(() => expect(stored("serial")).toBeDefined(), {
      timeout: MIN * 20,
    });
    const [starts, maxInFlight] = (stored("serial") ?? "")
      .split("|")
      .map(Number);
    expect(starts).toBeGreaterThanOrEqual(1);
    expect(maxInFlight).toBe(1);
  });

  it("dispose 之后定时器全部停止", async () => {
    const manager = await started(clockMod(counting("every", MIN)));

    await press(manager, "run");
    await vi.waitFor(() => expect(ticks()).toBeGreaterThanOrEqual(1), {
      timeout: MIN * 10,
    });

    await manager.dispose();
    const stopped = ticks();
    await watch();
    expect(ticks()).toBe(stopped);
  });

  it("插件重载撤销旧实例的定时器", async () => {
    const plugins = [plugin([{ id: "todo:panel", path: MOD_PATH }])];
    const { manager, updates } = createManager({
      [MOD_PATH]: clockMod(counting("every", MIN)),
    });
    managers.push(manager);
    await manager.loadFromPlugins(plugins);
    await manager.startSession();
    await vi.waitFor(() => expect(updates).toHaveLength(1));
    await pull(manager);

    await press(manager, "run");
    await vi.waitFor(() => expect(ticks()).toBeGreaterThanOrEqual(1), {
      timeout: MIN * 10,
    });

    await manager.reload(plugins);
    const stopped = ticks();
    await watch();
    expect(ticks()).toBe(stopped);
  });
});

describe("ModManager 的 $.process / $.prompt", () => {
  /**
   * 一个 mod：起一个真子进程读一行输出，再把读到的东西作为 prompt 投进会话。
   *
   * 这正是「外部事件驱动对话」那条链路的最后一米（spec「把 prompt 送进对话」）。
   */
  function remoteMod(): string {
    return `
exports.register = function ($, on) {
  on("session.start", async function () {
    var lines = [];
    for await (var chunk of $.process.spawn({
      argv: [${JSON.stringify(process.execPath)}, "-e", "console.log('connected')"]
    })) {
      lines.push(chunk.text.trim());
    }
    $.ui.open({ id: "p1", title: "遥控" });
    await $.prompt.submit({ text: "远端已连接：" + lines.join(","), asUser: true });
  });
};
`;
  }

  it("子进程的输出经 $.prompt.submit 投进本会话", async () => {
    const { manager, updates } = createManager({ [MOD_PATH]: remoteMod() });
    const submit = vi.fn(async () => {});
    manager.setPromptSubmitter(submit);

    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    // 面板在投递之前就开了：子进程的输出先到，才轮到 prompt。
    expect(updates).toHaveLength(1);
    expect(submit).toHaveBeenCalledWith("远端已连接：connected");

    await manager.dispose();
  });

  it("宿主没接投递通道时 submit 报错，而不是静默吞掉", async () => {
    const { manager, updates } = createManager({ [MOD_PATH]: remoteMod() });

    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    // 面板开在 submit 之前，报错发生在最后一次 await 上，所以面板还在。
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ paneId: "p1" });
    // `session.start` 的失败只进日志（它没有面板可以叠错误条）。
    expect(vi.mocked(logger.warn).mock.calls.flat().join(" ")).toContain(
      "宿主没有接入 prompt 投递通道",
    );

    await manager.dispose();
  });

  it("dispose 之后不能再投递", async () => {
    const { manager } = createManager({ [MOD_PATH]: remoteMod() });
    const submit = vi.fn(async () => {});
    manager.setPromptSubmitter(submit);
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();
    await manager.dispose();

    await expect(
      // 直接打私有的投递路径：dispose 之后 mod 已经没有存活的实例了。
      (
        manager as unknown as {
          submitPrompt(modId: string, text: string): Promise<void>;
        }
      ).submitPrompt("todo:panel", "late"),
    ).rejects.toThrow(/会话已结束/);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

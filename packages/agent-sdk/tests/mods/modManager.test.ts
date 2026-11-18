import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModManager } from "../../src/managers/modManager.js";
import type { ModManagerOptions } from "../../src/managers/modManager.js";
import type { ModSessionFacts } from "../../src/managers/modManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import type { McpManager } from "../../src/managers/mcpManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolPlugin } from "../../src/tools/types.js";
import { Container } from "../../src/utils/container.js";
import { logger } from "../../src/utils/globalLogger.js";
import { MOD_BAND_INSTANCE_ID, MOD_LIMITS } from "../../src/types/mods.js";
import type {
  ModCommandBridge,
  ModCommandInfo,
  ModCommandRunOutcome,
  ModPanelUpdatePayload,
  ModStatusPayload,
  ModToastPayload,
  ModUiPane,
} from "../../src/types/mods.js";
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
        $.ui.invalidate("ui.render");
      }})
    );
  });
};
`;

describe("ModManager 的带、状态行与提示", () => {
  /** 只注册 `ui.render`、按 `e.component` 分叉的 mod（同一钩子两个站点）。 */
  const bandMod = (bandBody: string) => `
exports.register = function ($, on) {
  on("ui.render", function (e) {
    if (e.component !== "AbovePrompt") return __wave.h("Text", null, "pane");
    ${bandBody}
  });
};
`;

  it("带只问注册了 ui.render 的 mod，且携带 AbovePrompt 站点与固定 requestId", async () => {
    const withBand = path.join(ROOT, "mods", "band.tsx");
    const paneOnly = path.join(ROOT, "mods", "pane-only.tsx");
    const { manager } = createManager({
      [withBand]: bandMod(
        'return __wave.h("Text", null, e.surface + ":" + e.component + ":" + e.requestId);',
      ),
      [paneOnly]: `
exports.register = function ($, on) {
  on("session.start", function () { $.ui.open({ id: "p1", title: "面板" }); });
  on("ui.render", function () { return __wave.h("Text", null, "pane"); });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([
        { id: "todo:band", path: withBand },
        { id: "todo:pane-only", path: paneOnly },
      ]),
    ]);
    await manager.startSession();

    const bands = await manager.renderBand();
    // 只有一条：`todo:pane-only` 也注册了 ui.render，所以两条都会出现 ——
    // 但它是同一个站点，返回的是 "pane" 文本，照样占位置。
    expect(bands.map((b) => b.modId).sort()).toEqual([
      "todo:band",
      "todo:pane-only",
    ]);
    const band = bands.find((b) => b.modId === "todo:band");
    expect(band).toMatchObject({ plugin: "todo", revision: 1 });
    expect(band?.tree).toEqual({
      type: "Text",
      props: {},
      children: ["desktop:AbovePrompt:above-prompt"],
    });

    // 每次拉取 revision 都涨（surface 靠它丢晚到的旧帧）。
    const again = await manager.renderBand();
    expect(again.find((b) => b.modId === "todo:band")?.revision).toBe(2);

    await manager.dispose();
  });

  it("IDE 聊天面板：带与面板的 e.surface 都是 vscode，不是 desktop", async () => {
    const ideMod = path.join(ROOT, "mods", "ide.tsx");
    const { manager } = createManager(
      {
        [ideMod]: `
exports.register = function ($, on) {
  on("session.start", function () { $.ui.open({ id: "p1", title: "IDE" }); });
  on("ui.render", function (e) {
    return __wave.h("Text", null, e.surface + ":" + e.component);
  });
};
`,
      },
      { sessionFacts: factsWith({ surfaces: () => ["vscode"] as const }) },
    );
    await manager.loadFromPlugins([plugin([{ id: "todo:ide", path: ideMod }])]);
    await manager.startSession();

    const frame = await manager.renderPane("todo:ide", "p1");
    expect(frame.tree).toMatchObject({ children: ["vscode:Pane"] });
    const bands = await manager.renderBand();
    expect(bands[0]?.tree).toMatchObject({ children: ["vscode:AbovePrompt"] });

    await manager.dispose();
  });

  it("只画带的 mod 也能靠 invalidate 重画自己（它没有面板可挂）", async () => {
    const bandOnly = path.join(ROOT, "mods", "band-only.tsx");
    const { manager, updates } = createManager({
      [bandOnly]: `
var n = 0;
exports.register = function ($, on) {
  on("ui.render", function (e) {
    if (e.component !== "AbovePrompt") return undefined;
    return __wave.h("Box", null,
      __wave.h("Text", null, "n=" + n),
      __wave.h("Button", { key: "tick", label: "+1", onPress: function () {
        n = n + 1;
        $.ui.invalidate("ui.render");
      }})
    );
  });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:band", path: bandOnly }]),
    ]);
    await manager.startSession();
    // 先真的画一帧：元素回调是在 `h()` 里登记进 mod 处理表的。
    await manager.renderBand();

    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:band",
      paneId: MOD_BAND_INSTANCE_ID,
      key: "tick",
      kind: "press",
    });

    // 带不是 pane：这条 stale 的 `paneId` 是固定值，surface 收到只会重拉带。
    await vi.waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toMatchObject({
      modId: "todo:band",
      paneId: MOD_BAND_INSTANCE_ID,
      stale: true,
    });
    expect(updates[0]).not.toHaveProperty("tree");

    const [band] = await manager.renderBand();
    expect(band.revision).toBe(2);
    expect(JSON.stringify(band.tree)).toContain("n=1");
  });

  it("ui.render 的 props 按站点给：面板是 Pane 的那几个字段、带是 AbovePrompt 的", async () => {
    // 字段集与 Claude Code 的 render sites 表逐项对齐：`maxRows` / `hasSurvey` /
    // `isWorking` 是 `AbovePrompt` 的，`Pane` 没有它们（多给会让照 CC 写的 mod 在
    // 我们这里能跑、到 CC 上读不到，那就不是它的子集了）。
    const rows = path.join(ROOT, "mods", "rows.tsx");
    const { manager } = createManager({
      [rows]: `
exports.register = function ($, on) {
  on("session.start", function () { $.ui.open({ id: "p1", title: "行数" }); });
  on("ui.render", function (e) {
    return __wave.h("Text", null, e.component + ":" + Object.keys(e.props).sort().join(",") + ":" + e.props.scroll.bodyRows);
  });
};
`,
    });
    await manager.loadFromPlugins([plugin([{ id: "todo:rows", path: rows }])]);
    await manager.startSession();

    const pane = await manager.renderPane("todo:rows", "p1");
    // 面板高得多：插件按 24 行分页，一开始就不会溢出（surface 没报尺寸时用的
    // 保守缺省值 —— spec「ui.render 的 props」）。
    expect(pane.tree).toMatchObject({
      children: ["Pane:bodyColumns,isFocused,placement,scroll,title,view:24"],
    });

    const [band] = await manager.renderBand();
    expect(band?.tree).toMatchObject({
      children: [
        "AbovePrompt:bodyColumns,hasSurvey,isCollapsed,isWorking,maxRows,scroll,view:8",
      ],
    });

    await manager.dispose();
  });

  it("surface 报了尺寸就用它：视口进 e.viewport、pane 的宽进 bodyColumns、inline 12 行", async () => {
    const layout = path.join(ROOT, "mods", "layout.tsx");
    const { manager } = createManager({
      [layout]: `
exports.register = function ($, on) {
  on("session.start", function () { $.ui.open({ id: "p1", title: "版面" }); });
  on("ui.render", function (e) {
    // 用分隔符拼，避免断言依赖 JSON 的键序。
    return __wave.h("Text", null, [
      e.component,
      e.props.placement,
      e.props.bodyColumns,
      e.props.scroll.bodyRows,
      e.viewport.columns,
      e.viewport.rows,
      e.viewport.isFullscreen,
    ].join("|"));
  });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:layout", path: layout }]),
    ]);
    await manager.startSession();

    // dock：面板 24 行、视口 120×40、这一块正文 66 列。
    const dock = await manager.renderPane("todo:layout", "p1", {
      placement: "dock",
      isFullscreen: true,
      columns: 120,
      rows: 40,
      bodyColumns: 66,
    });
    expect(dock.tree).toMatchObject({
      children: ["Pane|dock|66|24|120|40|true"],
    });

    // inline：落在输入框上方，正文 12 行封顶（`scroll.bodyRows` 也是 12）。
    const inline = await manager.renderPane("todo:layout", "p1", {
      placement: "inline",
      columns: 60,
      rows: 30,
      bodyColumns: 58,
    });
    expect(inline.tree).toMatchObject({
      children: ["Pane|inline|58|12|60|30|false"],
    });

    // 什么都没报：摆法退回 dock，视口只剩 `isFullscreen: false`（不填 0 冒充量到）。
    const bare = await manager.renderPane("todo:layout", "p1");
    expect(bare.tree).toMatchObject({
      children: ["Pane|dock|100|24|||false"],
    });

    // 带同一条链路：`bodyColumns` 是带自己那列，行数固定 8。
    const [band] = await manager.renderBand({
      columns: 120,
      rows: 40,
      bodyColumns: 72,
    });
    expect(band?.tree).toMatchObject({
      children: ["AbovePrompt||72|8|120|40|false"],
    });

    await manager.dispose();
  });

  it("没有注册 ui.render 的 mod 不出现在带里", async () => {
    const noRender = path.join(ROOT, "mods", "silent.tsx");
    const { manager } = createManager({
      [noRender]: `exports.register = function ($, on) { on("session.start", function () {}); };`,
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:silent", path: noRender }]),
    ]);
    await manager.startSession();

    await expect(manager.renderBand()).resolves.toEqual([]);

    await manager.dispose();
  });

  /** 只画一行文字的最小带（`AbovePrompt` 站点），当排序器的素材。 */
  const rowMod = (label: string) => `
exports.register = function ($, on) {
  on("ui.render", { component: "AbovePrompt" }, function () {
    return __wave.h("Text", null, ${JSON.stringify(label)});
  });
};
`;

  /** 只注册 `AbovePromptList` 站点：`body` 里用 `rows` 拼出留下的那些行。 */
  const sorterMod = (body: string) => `
exports.register = function ($, on) {
  on("ui.render", { component: "AbovePromptList" }, function (e) {
    var rows = e.props.rows;
    ${body}
  });
};
`;

  /** 带的结果里只挑有树的那些按 pop 顺序记 modId（空树不占位置）。 */
  const bandOrder = (bands: Array<{ modId: string; tree: unknown }>) =>
    bands.filter((band) => band.tree !== null).map((band) => band.modId);

  /** 三个各画一行 a / b / c 的 mod + 一个排序器，装载完并画一帧带。 */
  const renderWithSorter = async (sorterBody: string) => {
    const rowA = path.join(ROOT, "mods", "row-a.tsx");
    const rowB = path.join(ROOT, "mods", "row-b.tsx");
    const rowC = path.join(ROOT, "mods", "row-c.tsx");
    const sorter = path.join(ROOT, "mods", "sorter.tsx");
    const { manager } = createManager({
      [rowA]: rowMod("a"),
      [rowB]: rowMod("b"),
      [rowC]: rowMod("c"),
      [sorter]: sorterMod(sorterBody),
    });
    await manager.loadFromPlugins([
      plugin([
        { id: "todo:row-a", path: rowA },
        { id: "todo:row-b", path: rowB },
        { id: "todo:row-c", path: rowC },
        { id: "todo:sorter", path: sorter },
      ]),
    ]);
    await manager.startSession();
    return { manager, bands: await manager.renderBand() };
  };

  it("AbovePromptList 留下的行就是核心叠的那些：可以重排", async () => {
    const { manager, bands } = await renderWithSorter(
      `return __wave.h("Box", null, rows[2].tree, rows[0].tree, rows[1].tree);`,
    );

    expect(bandOrder(bands)).toEqual([
      "todo:row-c",
      "todo:row-a",
      "todo:row-b",
    ]);
    // 排序器自己不画带（它只注册了 AbovePromptList 站点），也不占位置。
    expect(bands.find((band) => band.modId === "todo:sorter")).toMatchObject({
      tree: null,
    });

    await manager.dispose();
  });

  it("AbovePromptList 不放进树里的行被隐藏（重排之外的另一半语义）", async () => {
    const { manager, bands } = await renderWithSorter(
      `return __wave.h("Box", null, rows[1].tree);`,
    );

    expect(bandOrder(bands)).toEqual(["todo:row-b"]);

    await manager.dispose();
  });

  it("没在 matcher 里点名 AbovePromptList 的 mod 不被问（否则会藏掉别人的行）", async () => {
    const rowA = path.join(ROOT, "mods", "row-a.tsx");
    const noMatcher = path.join(ROOT, "mods", "no-matcher.tsx");
    const { manager } = createManager({
      [rowA]: rowMod("a"),
      // 「只画自己那一行」的插件：每个站点都回同一棵树，那棵树恰好等于它自己
      // 那一行 —— 按「留下哪些行」去读就等于把所有别人的行都隐藏了。
      [noMatcher]: `
exports.register = function ($, on) {
  on("ui.render", function () {
    return __wave.h("Text", null, "照旧");
  });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([
        { id: "todo:row-a", path: rowA },
        { id: "todo:no-matcher", path: noMatcher },
      ]),
    ]);
    await manager.startSession();

    expect(bandOrder(await manager.renderBand())).toEqual([
      "todo:row-a",
      "todo:no-matcher",
    ]);

    await manager.dispose();
  });

  it("AbovePromptList 抛错按原顺序画（失败不能把整条带弄没）", async () => {
    const { manager, bands } = await renderWithSorter(
      `throw new Error("排序器崩了");`,
    );

    expect(bandOrder(bands)).toEqual([
      "todo:row-a",
      "todo:row-b",
      "todo:row-c",
    ]);
    // 失败记一条 debug（静默吞掉的话没人能解释「为什么没重排」）。
    expect(vi.mocked(logger.debug)).toHaveBeenCalledWith(
      expect.stringContaining("AbovePromptList"),
    );

    await manager.dispose();
  });

  it("在 .catch 里答一棵不含行的树 = 把带清空（fail closed 的写法）", async () => {
    const rowA = path.join(ROOT, "mods", "row-a.tsx");
    const rowB = path.join(ROOT, "mods", "row-b.tsx");
    const sorter = path.join(ROOT, "mods", "sorter.tsx");
    const { manager } = createManager({
      [rowA]: rowMod("a"),
      [rowB]: rowMod("b"),
      [sorter]: `
exports.register = function ($, on) {
  on("ui.render", { component: "AbovePromptList" }, function () {
    throw new Error("拿不到行");
  }).catch(function () {
    return __wave.h("Box", null);
  });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([
        { id: "todo:row-a", path: rowA },
        { id: "todo:row-b", path: rowB },
        { id: "todo:sorter", path: sorter },
      ]),
    ]);
    await manager.startSession();

    expect(bandOrder(await manager.renderBand())).toEqual([]);

    await manager.dispose();
  });

  it("钩子返回 undefined 的带不占位置，失败时回上一帧成功的树 + 错误摘要", async () => {
    const flaky = path.join(ROOT, "mods", "flaky.tsx");
    const { manager } = createManager({
      [flaky]: `
exports.register = function ($, on) {
  on("ui.render", function (e) {
    var mode = $.state.get("mode") || "ok";
    if (mode === "throw") throw new Error("崩了");
    if (mode === "empty") return undefined;
    return __wave.h("Text", null, e.component);
  });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:flaky", path: flaky }]),
    ]);
    await manager.startSession();

    const first = await manager.renderBand();
    expect(first[0]).toMatchObject({ revision: 1 });
    expect(first[0].error).toBeUndefined();
    expect(first[0].tree).toMatchObject({ children: ["AbovePrompt"] });

    // 抛错：树还是上一帧那份，错误叠在上面（空白化这条带会让用户以为它没了）。
    const stateSet = (
      manager as unknown as {
        stateFor(modId: string): Map<string, unknown>;
      }
    ).stateFor("todo:flaky");
    stateSet.set("mode", "throw");
    const failed = await manager.renderBand();
    expect(failed[0]).toMatchObject({ revision: 1, error: "崩了" });
    expect(failed[0].tree).toMatchObject({ children: ["AbovePrompt"] });

    // 明确返回 undefined：这一帧没内容，revision 仍然涨（surface 据此换掉旧帧）。
    stateSet.set("mode", "empty");
    const empty = await manager.renderBand();
    expect(empty[0]).toMatchObject({ revision: 2, tree: null });
    expect(empty[0].error).toBeUndefined();

    await manager.dispose();
  });

  it("$.ui.status / $.ui.toast 带着插件名推到宿主，null 表示清除", async () => {
    const statusMod = path.join(ROOT, "mods", "status.tsx");
    const { manager, statuses, toasts } = createManager({
      [statusMod]: `
exports.register = function ($, on) {
  on("session.start", function () {
    $.ui.status("ctx 62%");
    $.ui.status(null);
    $.ui.toast("已保存");
    $.ui.toast("等一会儿", 1200);
  });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:status", path: statusMod }]),
    ]);
    await manager.startSession();

    // 署名是**插件**名而不是 modId：用户要能看出是谁贴的。
    expect(statuses).toEqual([
      {
        sessionId: "s1",
        modId: "todo:status",
        plugin: "todo",
        text: "ctx 62%",
      },
      { sessionId: "s1", modId: "todo:status", plugin: "todo", text: null },
    ]);
    expect(toasts).toEqual([
      {
        sessionId: "s1",
        modId: "todo:status",
        plugin: "todo",
        text: "已保存",
        timeoutMs: 4000,
      },
      {
        sessionId: "s1",
        modId: "todo:status",
        plugin: "todo",
        text: "等一会儿",
        timeoutMs: 1200,
      },
    ]);

    // 最后贴的是 null（已清除），所以快照里没有它：surface 挂上来时重放的
    // 是「此刻还挂着」的那几行，toast 一律不重放（瞬时消息，晚了就不该再弹）。
    expect(manager.statusSnapshots()).toEqual([]);

    await manager.dispose();
  });

  it("宿主没接状态行/提示的出口时，调用照常成功（CLI 不画这些）", async () => {
    const statusMod = path.join(ROOT, "mods", "status.tsx");
    const { manager } = createManager({
      [statusMod]: `
exports.register = function ($, on) {
  on("session.start", function () {
    $.ui.status("ctx 62%");
    $.ui.toast("已保存");
  });
};
`,
    });
    // 模拟 CLI：两个出口都不传。
    const bare = new ModManager({
      sessionId: "s1",
      onPanelUpdate: () => {},
      storeRoot: STORE_ROOT,
    });
    await bare.loadFromPlugins([
      plugin([{ id: "todo:status", path: statusMod }]),
    ]);
    await expect(bare.startSession()).resolves.toBeUndefined();
    await bare.dispose();
    await manager.dispose();
  });

  it("statusSnapshots 只回还挂着的那几行，dispose 之后清空", async () => {
    const a = path.join(ROOT, "mods", "a.tsx");
    const b = path.join(ROOT, "mods", "b.tsx");
    const { manager } = createManager({
      [a]: `exports.register = function ($, on) { on("session.start", function () { $.ui.status("甲"); }); };`,
      [b]: `exports.register = function ($, on) { on("session.start", function () { $.ui.status("乙"); }); };`,
    });
    await manager.loadFromPlugins([
      plugin([
        { id: "todo:a", path: a },
        { id: "todo:b", path: b },
      ]),
    ]);
    await manager.startSession();

    // 顺序是「谁先贴出来」；一条 mod 一行，互不覆盖。
    expect(manager.statusSnapshots()).toEqual([
      { sessionId: "s1", modId: "todo:a", plugin: "todo", text: "甲" },
      { sessionId: "s1", modId: "todo:b", plugin: "todo", text: "乙" },
    ]);

    await manager.dispose();
    expect(manager.statusSnapshots()).toEqual([]);
  });

  it("dispose 之后不再推带：surface 已经走了", async () => {
    const { manager } = createManager({
      [MOD_PATH]: bandMod('return __wave.h("Text", null, "hi");'),
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();
    await manager.dispose();

    await expect(manager.renderBand()).resolves.toEqual([]);
  });
});

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
  options: Partial<ModManagerOptions> = {},
): {
  manager: ModManager;
  updates: ModPanelUpdatePayload[];
  statuses: ModStatusPayload[];
  toasts: ModToastPayload[];
} {
  probe.files.clear();
  for (const [file, source] of Object.entries(modSources)) {
    probe.files.set(path.resolve(file), source);
  }
  const updates: ModPanelUpdatePayload[] = [];
  const statuses: ModStatusPayload[] = [];
  const toasts: ModToastPayload[] = [];
  const manager = new ModManager({
    sessionId: "s1",
    onPanelUpdate: (payload) => updates.push(payload),
    onStatus: (payload) => statuses.push(payload),
    onToast: (payload) => toasts.push(payload),
    storeRoot: STORE_ROOT,
    ...options,
  });
  return { manager, updates, statuses, toasts };
}

function storeFile(name: string): string {
  return path.join(STORE_ROOT, `${name}.json`);
}

/**
 * `tool.call` 的答复里只看「拦不拦」。
 *
 * `dispatchToolCall` 还会带回插件替**自己注册的工具**答的 `{ result }`（spec
 * 「把我们自己的工具交给模型」），那是另一组用例的事；守卫用例读的还是「拦下
 * 给了什么文本」。
 */
async function denyOf(
  manager: ModManager,
  event: Parameters<ModManager["dispatchToolCall"]>[0],
): Promise<string | undefined> {
  return (await manager.dispatchToolCall(event)).deny;
}

/** 一份「什么都读得到」的会话事实；默认入口是桌面端，按需覆盖。 */
function factsWith(overrides: Partial<ModSessionFacts> = {}): ModSessionFacts {
  return {
    sessionId: () => "s1",
    workspaceRoot: () => ROOT,
    model: () => "wave-pro",
    surfaces: () => ["desktop"] as const,
    env: () => undefined,
    settings: async (query) => (query.key === undefined ? {} : undefined),
    turns: () => 0,
    repo: () => null,
    version: () => ({ version: "1.6.6" }),
    configRows: () => [],
    toolInfos: () => [],
    agentInfos: () => [],
    sessionMessages: () => [],
    transcriptPath: () => path.join(ROOT, "transcript.jsonl"),
    permissionMode: () => "default",
    ...overrides,
  };
}

/** 只看面板那一条：一次 invalidate 之后带也会收到一条（`paneId` 固定值）。 */
function paneUpdates(
  updates: ModPanelUpdatePayload[],
): ModPanelUpdatePayload[] {
  return updates.filter((update) => update.paneId === "p1");
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

  it("ui.render 的事件带 surface / component / requestId，$.ui.resolve 靠它取元素表", async () => {
    // mod 不写死元素名字符串：这是 `$.ui.resolve(e)` 唯一的用法。
    // 事件里的三个维度都用一遍：surface 拿去换表，component / requestId 用来
    // 认出「这是哪一端的哪个面板」—— mod 靠它们分派，不用自己猜。
    const siteMod = `
exports.register = function ($, on) {
  on("session.start", function () { $.ui.open({ id: "p1", title: "站点" }); });
  on("ui.render", function (e) {
    var t = $.ui.resolve(e);
    return __wave.h(t.Text, null, e.surface + ":" + e.component + ":" + e.requestId);
  });
};
`;
    const { manager } = createManager();
    probe.files.set(path.resolve(MOD_PATH), siteMod);
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    const frame = await pull(manager);
    expect(frame.error).toBeUndefined();
    expect(frame.tree).toMatchObject({
      type: "Text",
      props: {},
      children: ["desktop:Pane:p1"],
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
    await vi.waitFor(() => expect(paneUpdates(updates)).toHaveLength(2));
    const paneStale = paneUpdates(updates)[1];
    expect(paneStale).toMatchObject({ paneId: "p1", stale: true });
    expect(paneStale).not.toHaveProperty("tree");
    // 一次 invalidate 管到这个 mod 的**所有**站点：带也各收到一条，`paneId` 是
    // 固定值（这是只画带的 mod 唯一的重画通道）。
    expect(updates.some((u) => u.paneId === MOD_BAND_INSTANCE_ID)).toBe(true);

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
        $.ui.invalidate("ui.render");
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
    await vi.waitFor(() => expect(paneUpdates(updates)).toHaveLength(3), {
      timeout: MOD_LIMITS.invalidateIntervalMs * 10,
    });
    // 成功的这一帧把错误清掉：错误只活在失败的那一帧上，拉一次新的就没了。
    const frame = await pull(manager);
    expect(frame.error).toBeUndefined();
    expect(frame.tree).not.toBeNull();
  });

  it("控件交互先给 mod 一条 ui.press / ui.input / ui.select（e 与 CC 的 Ui*Argument 同形）", async () => {
    // 名字与字段集都照 Claude Code：三个事件在控件的回调**之前**跑，`e.element`
    // 是那个控件的 `key`（`ui.input` 还带 `e.value` 与 `kind`）。只发给拥有这块
    // 面板的 mod —— CC 默认也只对自己画的控件触发。
    const interaction = `
var seen = [];
exports.register = function ($, on) {
  on("session.start", function () { $.ui.open({ id: "p1", title: "交互" }); });
  on("ui.press", function (e) {
    seen.push("press:" + e.element + "@" + e.plugin + "/" + e.component + "/" + e.requestId + "/" + e.surface);
  });
  on("ui.input", function (e) { seen.push("input:" + e.element + "=" + e.value + "/" + e.kind); });
  on("ui.select", function (e) {
    seen.push("select:" + e.element + "=" + e.value + "/" + (e.kind === undefined ? "-" : e.kind));
  });
  on("ui.render", function () {
    return __wave.h("Box", null,
      __wave.h("Button", { key: "run", label: "跑", onPress: function () {
        seen.push("callback:run");
      }}),
      __wave.h("Input", { key: "title", onSubmit: function () {
        seen.push("callback:title");
      }}),
      __wave.h("Select", { key: "size", options: [{ value: "sm" }, { value: "lg" }], onSelect: function () {
        seen.push("callback:size");
      }}),
      __wave.h("Text", null, seen.join(","))
    );
  });
};
`;
    const { manager } = createManager({ [MOD_PATH]: interaction });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();
    // 先真画一帧：元素回调是在 `h()` 里登记进 mod 处理表的。
    await pull(manager);

    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p1",
      key: "run",
      kind: "press",
    });
    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p1",
      key: "title",
      kind: "input",
      value: "周报",
    });
    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p1",
      key: "size",
      kind: "select",
      value: "lg",
    });
    // 同一条带上的控件：`component` 换成那个站点（`requestId` 是它的固定实例）。
    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: MOD_BAND_INSTANCE_ID,
      key: "run",
      kind: "press",
    });

    const frame = await pull(manager);
    const text = JSON.stringify(frame.tree);
    // 每条都是「钩子先、回调后」；钩子的字段集与 CC 的 `Ui*Argument` 同形
    // （`plugin` / `element` / `component` / `requestId` / `surface`，`ui.input`
    // 多 `kind` 与 `value`、`ui.select` 多 `value`）。
    expect(text).toContain(
      [
        "press:run@todo/Pane/p1/desktop",
        "callback:run",
        "input:title=周报/submit",
        "callback:title",
        "select:size=lg/-",
        "callback:size",
        "press:run@todo/AbovePrompt/above-prompt/desktop",
        "callback:run",
      ].join(","),
    );

    await manager.dispose();
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

    await vi.waitFor(() => expect(paneUpdates(updates)).toHaveLength(2), {
      timeout: MOD_LIMITS.invalidateIntervalMs * 10,
    });
    // 观察窗口要够宽：合并之后不该再冒出第 3 帧。
    await new Promise((resolve) =>
      setTimeout(resolve, MOD_LIMITS.invalidateIntervalMs * 2),
    );
    expect(paneUpdates(updates)).toHaveLength(2);
    // 带也合并在同一次里（一个 mod 一条）。
    expect(
      updates.filter((u) => u.paneId === MOD_BAND_INSTANCE_ID),
    ).toHaveLength(1);
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

  it("$store 的值原样落成 JSON（对象不当字符串压平）", async () => {
    // 社区插件存的是对象（`set("last", { at, count })`）。只收字符串会把它变成
    // "[object Object]"，读回来永远救不出去。
    const SOURCE = `
exports.register = function ($, on) {
  on("session.start", async function () {
    await $.store.set("state", { count: 2, tags: ["a", "b"] });
    $.ui.open({ id: "p1", title: "状态" });
  });
  on("ui.render", async function () {
    return __wave.h("Text", null, JSON.stringify(await $.store.get("state")));
  });
};
`;
    const { manager } = createManager({ [MOD_PATH]: SOURCE });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    const frame = await pull(manager);
    expect(frame.tree).toMatchObject({
      children: ['{"count":2,"tags":["a","b"]}'],
    });
    // 落盘的就是嵌套 JSON，不是转义过的字符串。
    expect(probe.files.get(storeFile("todo"))).toContain('"tags": [');
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
  function stored(name: string): unknown {
    const raw = probe.files.get(storeFile("todo"));
    return raw === undefined
      ? undefined
      : (JSON.parse(raw) as Record<string, unknown>)[name];
  }

  function ticks(): number {
    return Number(stored("ticks") ?? 0);
  }

  /** 一个每拍把 `ticks` 加一的定时器源码。 */
  function counting(kind: "after" | "every", ms: number): string {
    return `timer = $.clock.${kind}(${ms}, function () {
        return $.store.get("ticks").then(function (n) {
          return $.store.set("ticks", Number(n || 0) + 1);
        });
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
    await vi.waitFor(() => expect(stored("ticks")).toBe(1), {
      timeout: MIN * 10,
    });
    await watch();
    expect(stored("ticks")).toBe(1);
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
    const [starts, maxInFlight] = String(stored("serial") ?? "")
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

  it(
    "定时器回调里的同步死循环也被打断，不会把进程卡死",
    { timeout: 30_000 },
    async () => {
      // 定时器回调不在钩子链上，由宿主的 `setTimeout` 触发 —— 不经过沙箱那一跳
      // 就是裸调，`while (true) {}` 一样能卡死整个 `wave --stdio`。
      const manager = await started(
        clockMod(
          `timer = $.clock.after(${MIN}, function () { while (true) {} });`,
        ),
      );

      await press(manager, "run");
      await vi.waitFor(
        () =>
          expect(vi.mocked(logger.warn).mock.calls.flat().join(" ")).toContain(
            "同步执行超过",
          ),
        { timeout: 20_000 },
      );
    },
  );
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

  /** 在 `session.start` 里填一次草稿的 mod（spec「把草稿填进输入框」）。 */
  const fillMod = `
exports.register = function ($, on) {
  on("session.start", function () {
    return $.prompt.fill({ text: "基于这个再改一版", mode: "append" });
  });
};
`;

  it("$.prompt.fill 把文本与 mode 交给接上的填草稿通道", async () => {
    const { manager } = createManager({ [MOD_PATH]: fillMod });
    const fill = vi.fn(async () => true);
    manager.setPromptFiller(fill);

    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    expect(fill).toHaveBeenCalledWith({
      text: "基于这个再改一版",
      mode: "append",
    });

    await manager.dispose();
  });

  it("宿主没接填草稿通道时 $.prompt.fill 答 false，不抛错", async () => {
    // 终端 CLI、没挂 surface 的宿主就是这一种：填不上是正常结果（spec 场景 4）。
    const { manager } = createManager({ [MOD_PATH]: fillMod });

    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    // `session.start` 正常结束，没有任何错误摘要被推出来。
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();

    await manager.dispose();
  });

  it("dispose 之后 $.prompt.fill 一律答 false", async () => {
    const { manager } = createManager();
    const fill = vi.fn(async () => true);
    manager.setPromptFiller(fill);
    await manager.dispose();

    await expect(
      (
        manager as unknown as {
          fillPrompt(request: {
            text: string;
            mode: "replace" | "append" | "insert";
          }): Promise<boolean>;
        }
      ).fillPrompt({ text: "late", mode: "replace" }),
    ).resolves.toBe(false);
    expect(fill).not.toHaveBeenCalled();
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

describe("ModManager 的 $.session.usage", () => {
  /** 把快照摊平画成一行的 mod：只读快照，spec「会话用量」。 */
  const USAGE_MOD = `
exports.register = function ($, on) {
  on("session.start", function () {
    $.ui.open({ id: "p1", title: "用量" });
  });
  on("ui.render", function () {
    var u = $.session.usage();
    return __wave.h("Text", null,
      u.context.percent + "%|" + u.context.tokens + "/" + u.context.window +
      "|" + u.tokens.prompt + "+" + u.tokens.completion +
      "+" + u.tokens.cacheRead + "+" + u.tokens.cacheCreation +
      "|" + u.model);
  });
};
`;

  it("接上取数点后 mod 拿到真实数字", async () => {
    const { manager } = createManager({ [MOD_PATH]: USAGE_MOD });
    manager.setSessionUsageProvider(() => ({
      startedAt: 1_700_000_000_000,
      context: { tokens: 83_500, window: 200_000, percent: 50 },
      tokens: { prompt: 300, completion: 30, cacheRead: 40, cacheCreation: 5 },
      rateLimits: [],
      model: "some-model",
    }));
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    const frame = await pull(manager);
    expect(frame.tree).toEqual({
      type: "Text",
      props: {},
      children: ["50%|83500/200000|300+30+40+5|some-model"],
    });

    await manager.dispose();
  });

  it("session.measure 的载荷里带一份用量快照（spec「用量的变化」）", async () => {
    const measureMod = `
exports.register = function ($, on) {
  on("session.measure", function (e) {
    $.ui.status(
      e.changed.join("+") + "|" + e.context.tokens + "|" +
      e.tokens.prompt + "|" + e.rateLimits.length + "|" + e.startedAt);
  });
};
`;
    const { manager, statuses } = createManager({ [MOD_PATH]: measureMod });
    manager.setSessionUsageProvider(() => ({
      startedAt: 1_700_000_000_000,
      context: { tokens: 42_000, window: 200_000, percent: 25 },
      tokens: { prompt: 700, completion: 70, cacheRead: 500, cacheCreation: 0 },
      rateLimits: [],
    }));
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    // 调用方（`AIManager`）只报「刚量到一次」，其余字段由 ModManager 补齐 ——
    // 社区 mod 在这个事件里直接读 `e.context` / `e.tokens`，缺一个就是 undefined。
    manager.notifyMods("session.measure", { changed: ["context", "tokens"] });

    await vi.waitFor(() =>
      expect(statuses.at(-1)?.text).toBe(
        "context+tokens|42000|700|0|1700000000000",
      ),
    );

    await manager.dispose();
  });

  it("没接上取数点时给全 0 快照，不抛错", async () => {
    const { manager } = createManager({ [MOD_PATH]: USAGE_MOD });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    const frame = await pull(manager);
    expect(frame.tree).toEqual({
      type: "Text",
      props: {},
      children: ["0%|0/0|0+0+0+0|undefined"],
    });

    await manager.dispose();
  });
});

describe("ModManager 的只读观察事件", () => {
  /** 收到事件就把载荷贴成状态行（状态行是测试观察 mod 内部最容易的出口）。 */
  const OBSERVER_MOD = `
exports.register = function ($, on) {
  on("turn.complete", function (e) {
    $.ui.status("turn:" + e.isAborted + ":" + e.durationMs + ":" + e.answer + ":" + e.usage.prompt + "+" + e.usage.completion);
  });
  on("classic.PermissionRequest", function (e) {
    $.ui.status("ask:" + e.hook_event_name + ":" + e.tool_name + ":" + e.tool_input.command);
  });
  on("tool.call", function (e) {
    $.ui.status("tool:" + e.tool + ":" + e.input.file_path);
    return { deny: "blocked:" + e.file_path };
  });
};
`;

  const TURN_USAGE = {
    prompt: 0,
    completion: 0,
    cacheRead: 0,
    cacheCreation: 0,
  };

  it("三个事件都派发到注册了它们的 mod，载荷原样", async () => {
    const { manager, statuses } = createManager({
      [MOD_PATH]: OBSERVER_MOD,
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    manager.notifyMods("turn.complete", {
      turnId: "turn-1",
      isAborted: false,
      durationMs: 42,
      answer: "done",
      usage: { ...TURN_USAGE, prompt: 1200, completion: 300 },
    });
    await vi.waitFor(() =>
      expect(statuses.at(-1)?.text).toBe("turn:false:42:done:1200+300"),
    );

    // 审批事件用 Claude Code 的 `classic.<Event>` 名字，载荷是那份 stdin JSON。
    manager.notifyMods("classic.PermissionRequest", {
      session_id: "s1",
      transcript_path: path.join(ROOT, "transcript.jsonl"),
      cwd: ROOT,
      permission_mode: "default",
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: { command: "rm -rf build" },
    });
    await vi.waitFor(() =>
      expect(statuses.at(-1)?.text).toBe(
        "ask:PermissionRequest:Bash:rm -rf build",
      ),
    );

    // `tool.call` 是决策型事件：参数在顶层也铺一份（社区读写的是 `e.file_path`），
    // 返回 `{ deny }` 拦下这次调用 —— 由 `ToolManager` 决定怎么报。
    const deny = await denyOf(manager, {
      ...{ file_path: "a.ts", content: "x" },
      tool: "Write",
      tool_use_id: "call-1",
      input: { file_path: "a.ts", content: "x" },
    });
    expect(deny).toBe("blocked:a.ts");
    await vi.waitFor(() =>
      expect(statuses.at(-1)?.text).toBe("tool:Write:a.ts"),
    );

    await manager.dispose();
  });

  it("影子事件的公共五字段由 ModManager 补齐，hook_event_name 不带前缀", async () => {
    // spec「影子事件」：载荷是 CC 的 hook stdin 形状，`session_id` /
    // `transcript_path` / `cwd` / `permission_mode` / `hook_event_name` 每条都带
    // —— 调用点只写自己那几个字段（`source` / `model` / `previous_cwd`）。
    // `permission_mode` 是**每条** classic 事件都有的（CC 的 base hook input 就
    // 这么铺），社区守卫靠它判断「有没有人会被问到」。
    const shadowMod = `
exports.register = function ($, on) {
  on("classic.SessionStart", function (e) {
    $.ui.status([e.session_id, e.hook_event_name, e.source, e.cwd, e.transcript_path, e.permission_mode].join("|"));
  });
  on("classic.PostModelSwitch", function (e) {
    $.ui.status([e.hook_event_name, e.from_model, e.to_model, String(e.context_tokens), String(e.cache_ttl)].join("|"));
  });
  on("classic.CwdChanged", function (e) {
    $.ui.status([e.hook_event_name, e.old_cwd, e.new_cwd, e.cwd].join("|"));
  });
};
`;
    const { manager, statuses } = createManager(
      { [MOD_PATH]: shadowMod },
      {
        workdir: () => ROOT,
        sessionFacts: {
          sessionId: () => "s-live",
          workspaceRoot: () => ROOT,
          model: () => "",
          surfaces: () => ["desktop"] as const,
          env: () => undefined,
          settings: async () => ({}),
          turns: () => 0,
          repo: () => null,
          version: () => ({ version: "" }),
          configRows: () => [],
          toolInfos: () => [],
          agentInfos: () => [],
          sessionMessages: () => [],
          // 会话 id 取「现取的」那个：`/clear` 之后它变了，镜像不该报旧值。
          transcriptPath: () => path.join(ROOT, "session.jsonl"),
          permissionMode: () => "acceptEdits",
        },
      },
    );
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    manager.notifyMods("classic.SessionStart", { source: "startup" });
    await vi.waitFor(() =>
      expect(statuses.at(-1)?.text).toBe(
        `s-live|SessionStart|startup|${ROOT}|${path.join(ROOT, "session.jsonl")}|acceptEdits`,
      ),
    );

    // `cache_ttl` 恒 `null`：我们不做提示词缓存的 TTL 记账。换模型报的是
    // `from_model` / `to_model` 两个名字（曾经只有一个自造的 `model`）。
    manager.notifyMods("classic.PostModelSwitch", {
      from_model: "wave-lite",
      to_model: "wave-pro",
      context_tokens: 12_000,
      cache_ttl: null,
    });
    await vi.waitFor(() =>
      expect(statuses.at(-1)?.text).toBe(
        "PostModelSwitch|wave-lite|wave-pro|12000|null",
      ),
    );

    // `old_cwd` / `new_cwd` 是 CC 的名字；公共字段 `cwd` 跟着 `new_cwd` 走。
    manager.notifyMods("classic.CwdChanged", {
      old_cwd: path.resolve("/fake/before"),
      new_cwd: path.resolve("/fake/after"),
    });
    await vi.waitFor(() =>
      expect(statuses.at(-1)?.text).toBe(
        `CwdChanged|${path.resolve("/fake/before")}|${path.resolve("/fake/after")}|${ROOT}`,
      ),
    );

    await manager.dispose();
  });

  it("turn.complete.usage 带上 Claude Code 的别名（input_tokens 不含缓存）", async () => {
    const aliasMod = `
exports.register = function ($, on) {
  on("turn.complete", function (e) {
    var u = e.usage;
    $.ui.status(
      u.input_tokens + "|" + u.output_tokens + "|" +
      u.cache_read_input_tokens + "|" + u.cache_creation_input_tokens + "|" + u.model);
  });
};
`;
    const { manager, statuses } = createManager({ [MOD_PATH]: aliasMod });
    manager.setSessionUsageProvider(() => ({
      startedAt: 1_700_000_000_000,
      context: { tokens: 0, window: 200_000, percent: 0 },
      tokens: { prompt: 0, completion: 0, cacheRead: 0, cacheCreation: 0 },
      rateLimits: [],
      model: "some-model",
    }));
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    // 我们的 `prompt` 含缓存命中（1200 = 900 缓存读 + 100 缓存写 + 200 未命中），
    // 社区的 `input_tokens` 不含 —— 差值是减出来的，不是改名。
    manager.notifyMods("turn.complete", {
      turnId: "turn-1",
      isAborted: false,
      durationMs: 42,
      answer: "done",
      usage: {
        prompt: 1200,
        completion: 300,
        cacheRead: 900,
        cacheCreation: 100,
      },
    });

    await vi.waitFor(() =>
      expect(statuses.at(-1)?.text).toBe("200|300|900|100|some-model"),
    );

    await manager.dispose();
  });

  it("是 fire-and-forget：不等钩子，钩子抛错只记一条 warn", async () => {
    const hangForever = path.join(ROOT, "mods", "hangs.tsx");
    const boom = path.join(ROOT, "mods", "boom.tsx");
    const { manager } = createManager({
      [hangForever]: `
exports.register = function ($, on) {
  on("turn.complete", function () { return new Promise(function () {}); });
};
`,
      [boom]: `
exports.register = function ($, on) {
  on("turn.complete", function () { throw new Error("boom"); });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([
        { id: "todo:hangs", path: hangForever },
        { id: "todo:boom", path: boom },
      ]),
    ]);
    await manager.startSession();

    // 钩子永不 resolve：调用方仍然立刻拿到返回（没有 Promise 可等）。
    expect(
      manager.notifyMods("turn.complete", {
        turnId: "turn-1",
        isAborted: false,
        durationMs: 1,
        answer: "",
        usage: TURN_USAGE,
      }),
    ).toBeUndefined();

    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("todo:boom 的 turn.complete 失败"),
      ),
    );

    await manager.dispose();
  });

  it("没有注册这三个钩子的 mod 不受影响", async () => {
    const { manager, statuses } = createManager({ [MOD_PATH]: COUNTER_MOD });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    manager.notifyMods("turn.complete", {
      turnId: "turn-1",
      isAborted: true,
      durationMs: 5,
      answer: "",
      usage: TURN_USAGE,
    });
    // 冲刷一轮事件循环：派发是异步的，这里要给它机会真的跑完再断言「什么都没发生」。
    await new Promise((resolve) => setImmediate(resolve));
    expect(statuses).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();

    await manager.dispose();
  });
});

/**
 * 命令表的替身：记住每条命令的 `run` 回调，调用它就等于「用户执行了这条命令」。
 * 真命令表在 `slashCommandManager.test.ts` 里被测。
 */
function createCommandBridge(): {
  bridge: ModCommandBridge;
  rows: Map<
    string,
    {
      info: ModCommandInfo;
      run: (args: string) => Promise<ModCommandRunOutcome | undefined>;
    }
  >;
  removed: string[];
} {
  const rows = new Map<
    string,
    {
      info: ModCommandInfo;
      run: (args: string) => Promise<ModCommandRunOutcome | undefined>;
    }
  >();
  const removed: string[] = [];
  const bridge: ModCommandBridge = {
    register: (input) => {
      if (rows.has(input.name)) {
        return { ok: false, reason: `/${input.name} 已经被注册了` };
      }
      rows.set(input.name, {
        info: {
          name: input.name,
          description: input.description,
          source: "plugin",
          plugin: input.plugin,
        },
        run: input.run,
      });
      return { ok: true };
    },
    unregister: (name) => {
      rows.delete(name);
      removed.push(name);
    },
    list: () => [...rows.values()].map((row) => row.info),
    run: async () => {},
  };
  return { bridge, rows, removed };
}

describe("ModManager 的 $.ui.log 与 $.command", () => {
  it("$.ui.log 交到对话流的写入口，首尾空白被裁掉", async () => {
    const logMod = path.join(ROOT, "mods", "log.tsx");
    const { manager } = createManager({
      [logMod]: `
exports.register = function ($, on) {
  on("session.start", function () { $.ui.log("  standup 该开了  "); });
};
`,
    });
    const lines: string[] = [];
    manager.setLogSink((text) => lines.push(text));
    await manager.loadFromPlugins([plugin([{ id: "todo:log", path: logMod }])]);
    await manager.startSession();

    expect(lines).toEqual(["standup 该开了"]);

    await manager.dispose();
  });

  it("没有落点时不抛错，只记一条 debug", async () => {
    const logMod = path.join(ROOT, "mods", "log.tsx");
    const { manager } = createManager({
      [logMod]: `
exports.register = function ($, on) {
  on("session.start", function () { $.ui.log("x"); });
};
`,
    });
    await manager.loadFromPlugins([plugin([{ id: "todo:log", path: logMod }])]);
    await expect(manager.startSession()).resolves.toBeUndefined();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("$.ui.log 没有落点"),
    );

    await manager.dispose();
  });

  it("$.command.register 进命令表，执行时回到自己的 command.run 钩子", async () => {
    const commandMod = path.join(ROOT, "mods", "cmd.tsx");
    const { manager } = createManager({
      [commandMod]: `
exports.register = function ($, on) {
  on("session.start", function () {
    $.command.register({
      name: "standup",
      description: "站会摘要",
      argumentHint: "[日期]",
    });
  });
  on("command.run", { command: "/standup" }, function (e) {
    return { text: "总结 " + e.args + " 的提交" };
  });
};
`,
    });
    const { bridge, rows } = createCommandBridge();
    manager.setCommandBridge(bridge);
    await manager.loadFromPlugins([
      plugin([{ id: "todo:cmd", path: commandMod }]),
    ]);
    await manager.startSession();

    expect([...rows.keys()]).toEqual(["standup"]);
    expect(rows.get("standup")?.info).toMatchObject({
      description: "站会摘要",
      plugin: "todo",
      source: "plugin",
    });
    // 命令表执行它时问回注册者：钩子答的那段文字就是要送进会话的 prompt。
    await expect(rows.get("standup")?.run("上周")).resolves.toEqual({
      text: "总结 上周 的提交",
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("$.command.register (todo): /standup listed"),
    );

    await manager.dispose();
  });

  it("command.run 答 `{}` 是本地动作（解析成空对象，不是「没人回答」）", async () => {
    // spec「注册命令」：`/diff` 这种只开面板的命令返回 `{}`，命令表据此不发消息。
    const quietMod = path.join(ROOT, "mods", "quiet.tsx");
    const { manager } = createManager({
      [quietMod]: `
exports.register = function ($, on) {
  on("session.start", function () {
    $.command.register({ name: "diff", description: "看差异" });
  });
  on("command.run", { command: "/diff" }, function () {
    return {};
  });
};
`,
    });
    const { bridge, rows } = createCommandBridge();
    manager.setCommandBridge(bridge);
    await manager.loadFromPlugins([
      plugin([{ id: "todo:quiet", path: quietMod }]),
    ]);
    await manager.startSession();

    await expect(rows.get("diff")?.run("")).resolves.toEqual({});

    await manager.dispose();
  });

  it("命令表的拒绝原样抛回 mod，每个 mod 最多 32 条", async () => {
    const { manager, statuses } = createManager({
      [MOD_PATH]: `
exports.register = function ($, on) {
  on("session.start", function () {
    $.command.register({ name: "dup", description: "重名的那条" });
  });
  on("turn.complete", function () {
    for (var i = 0; i < 33; i++) {
      try {
        $.command.register({ name: "c" + i, description: "x" });
      } catch (e) {
        $.ui.status("err:" + e.message);
      }
    }
  });
};
`,
    });
    const { bridge, rows } = createCommandBridge();
    bridge.register({
      name: "dup",
      description: "别处注册的",
      plugin: "other",
      run: async () => undefined,
    });
    manager.setCommandBridge(bridge);
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    // 重名拒在注册那一刻抛回 mod：钩子失败，原因进日志。
    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("/dup 已经被注册了"),
      ),
    );

    // 上限拒在 33 条里的最后一条：前 32 条真的进了命令表。
    manager.notifyMods("turn.complete", {
      turnId: "turn-1",
      isAborted: false,
      durationMs: 1,
      answer: "",
      usage: { prompt: 0, completion: 0, cacheRead: 0, cacheCreation: 0 },
    });
    await vi.waitFor(() =>
      expect(statuses.at(-1)?.text).toMatch(/最多注册 32 条/),
    );
    expect(rows.size).toBe(1 + 32);

    await manager.dispose();
  });

  it("同一个 mod 重复注册同一个名字是幂等的", async () => {
    const { manager } = createManager({
      [MOD_PATH]: `
exports.register = function ($, on) {
  on("session.start", function () {
    $.command.register({ name: "standup", description: "站会摘要" });
    $.command.register({ name: "standup", description: "站会摘要" });
  });
};
`,
    });
    const { bridge, rows } = createCommandBridge();
    manager.setCommandBridge(bridge);
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    // 与 CC 同款：命令表里只有一条，第二次注册不报错。
    expect([...rows.keys()]).toEqual(["standup"]);
    const listed = vi
      .mocked(logger.info)
      .mock.calls.filter(([line]) => String(line).includes("/standup listed"));
    expect(listed).toHaveLength(1);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("unchanged; not re-registered"),
    );

    await manager.dispose();
  });

  it("dispose 撤销这个 mod 注册过的命令", async () => {
    const commandMod = path.join(ROOT, "mods", "cmd.tsx");
    const { manager } = createManager({
      [commandMod]: `
exports.register = function ($, on) {
  on("session.start", function () {
    $.command.register({ name: "standup", description: "站会摘要" });
  });
  on("command.run", { command: "/standup" }, function () { return { text: "x" }; });
};
`,
    });
    const { bridge, removed } = createCommandBridge();
    manager.setCommandBridge(bridge);
    await manager.loadFromPlugins([
      plugin([{ id: "todo:cmd", path: commandMod }]),
    ]);
    await manager.startSession();

    await manager.dispose();
    expect(removed).toEqual(["standup"]);
  });
});

describe("ModManager 的 $.clock.sleep（spec「时钟：等待」）", () => {
  const MIN = MOD_LIMITS.timerMinIntervalMs;

  /** `$.store.set` 写过的最新值（store 每次读写都走文件）。 */
  function stored(name: string): unknown {
    const raw = probe.files.get(storeFile("todo"));
    return raw === undefined
      ? undefined
      : (JSON.parse(raw) as Record<string, unknown>)[name];
  }

  /** 一个按钮触发一次 `body` 的 mod；面板开着，回调才登记得进去。 */
  function sleepMod(body: string): string {
    return `
exports.register = function ($, on) {
  on("session.start", function () { $.ui.open({ id: "p1", title: "等" }); });
  on("ui.render", function () {
    return __wave.h("Button", { key: "run", label: "run", onPress: function () {
      ${body}
    }});
  });
};
`;
  }

  async function started(source: string): Promise<ModManager> {
    const { manager } = createManager({ [MOD_PATH]: source });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();
    await pull(manager);
    return manager;
  }

  function press(manager: ModManager, key = "run"): Promise<void> {
    return manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p1",
      key,
      kind: "press",
    });
  }

  it("到点才 resolve，比下限短的等待被夹到下限", async () => {
    const manager = await started(
      sleepMod(`
      var started = $.clock.now();
      $.clock.sleep(0).then(
        function () { $.store.set("woke", String($.clock.now() - started)); },
        function (e) { $.store.set("woke", "error:" + e.name); }
      );
    `),
    );

    await press(manager);
    // 不是同步 resolve：夹到下限之后要等一个真定时器。
    expect(stored("woke")).toBeUndefined();
    await vi.waitFor(() => expect(stored("woke")).toBeDefined(), {
      timeout: MIN * 10,
    });
    const waited = Number(stored("woke"));
    expect(waited).toBeGreaterThanOrEqual(MIN - 5);
    expect(waited).toBeLessThan(MIN * 5);

    await manager.dispose();
  });

  it("传了 { signal } 时 abort 让 Promise reject 成 AbortError", async () => {
    const manager = await started(
      sleepMod(`
      var controller = new AbortController();
      $.clock.sleep(${MIN * 100}, { signal: controller.signal }).then(
        function () { $.store.set("signal", "resolved"); },
        function (e) { $.store.set("signal", "rejected:" + e.name); }
      );
      controller.abort();
    `),
    );

    await press(manager);
    await vi.waitFor(() =>
      expect(stored("signal")).toBe("rejected:AbortError"),
    );

    await manager.dispose();
  });

  it("超过同时未完成的上限时 sleep 报错，前 16 个照常挂着", async () => {
    const manager = await started(
      sleepMod(`
      var created = 0, message = "";
      for (var i = 0; i < ${MOD_LIMITS.maxSleepsPerMod + 1}; i++) {
        try {
          $.clock.sleep(60000).catch(function () {});
          created++;
        } catch (e) { message = e.message; }
      }
      $.store.set("sleeps", created + "|" + message);
    `),
    );

    await press(manager);
    await vi.waitFor(() => expect(stored("sleeps")).toContain("|"));
    expect(stored("sleeps")).toBe(
      `${MOD_LIMITS.maxSleepsPerMod}|$.clock.sleep 同时未完成的等待最多 ${MOD_LIMITS.maxSleepsPerMod} 个`,
    );

    await manager.dispose();
  });

  it("会话销毁时未完成的等待 reject（不是永远挂着）", async () => {
    const manager = await started(
      sleepMod(`
      $.clock.sleep(60000).then(
        function () { $.store.set("end", "resolved"); },
        function (e) { $.store.set("end", "rejected:" + e.name); }
      );
    `),
    );

    await press(manager);
    expect(stored("end")).toBeUndefined();
    await manager.dispose();
    expect(stored("end")).toBe("rejected:AbortError");
  });

  it("插件重载时旧实例的等待一并 reject", async () => {
    const plugins = [plugin([{ id: "todo:panel", path: MOD_PATH }])];
    const manager = await started(
      sleepMod(`
      $.clock.sleep(60000).then(
        function () { $.store.set("reload", "resolved"); },
        function (e) { $.store.set("reload", "rejected:" + e.name); }
      );
    `),
    );

    await press(manager);
    expect(stored("reload")).toBeUndefined();
    await manager.reload(plugins);
    expect(stored("reload")).toBe("rejected:AbortError");

    await manager.dispose();
  });
});

describe("ModManager 的只读事实（spec「会话事实」「环境变量与设置」）", () => {
  /** 面板上摊平画一行的 mod：只读入口各取一个值。 */
  const FACTS_MOD = `
exports.register = function ($, on) {
  on("session.start", function () { $.ui.open({ id: "p1", title: "事实" }); });
  on("ui.render", async function () {
    var id = await $.session.id();
    var root = await $.session.root();
    var model = await $.session.model();
    var watch = await $.env.get("WATCH");
    var merged = await $.settings.read();
    var keyed = await $.settings.read({ source: "project", key: "model" });
    var surfaces = await $.session.surfaces();
    return __wave.h("Text", null,
      [id, root, model, String(watch), String(merged.owner), String(keyed), surfaces.join(",")].join("|"));
  });
};
`;

  it("接上数据源后 mod 读得到三个事实、env 与设置", async () => {
    const { manager } = createManager(
      { [MOD_PATH]: FACTS_MOD },
      {
        sessionFacts: {
          sessionId: () => "s-9",
          workspaceRoot: () => path.resolve("/fake/root"),
          model: () => "wave-pro",
          surfaces: () => ["desktop"] as const,
          env: (name) => (name === "WATCH" ? "1" : undefined),
          settings: async (query) =>
            query.key === undefined
              ? { owner: "me", model: "wave-pro" }
              : "wave-pro",
          turns: () => 4,
          repo: () => ({
            root: path.resolve("/fake/root"),
            remote: null,
            internal: false,
            name: null,
          }),
          version: () => ({ version: "1.6.6" }),
          configRows: () => [],
          toolInfos: () => [],
          agentInfos: () => [],
          sessionMessages: () => [],
          transcriptPath: () => "",
          permissionMode: () => "default",
        },
      },
    );
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    const frame = await pull(manager);
    expect(frame.tree).toEqual({
      type: "Text",
      props: {},
      children: [
        `s-9|${path.resolve("/fake/root")}|wave-pro|1|me|wave-pro|desktop`,
      ],
    });

    await manager.dispose();
  });

  it("没接数据源时给兜底值，不抛错", async () => {
    const { manager } = createManager({ [MOD_PATH]: FACTS_MOD });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    // 兜底：会话 id 用构造时那个、工作根用「会动」的目录（这里没配，落到
    // 进程 cwd）、模型空串、env 与设置读不到、没有界面（surfaces 空数组）——
    // 宿主没接线不该让 mod 报错。
    const frame = await pull(manager);
    const flat = String((frame.tree as { children: string[] }).children[0]);
    expect(flat.split("|")[0]).toBe("s1");
    expect(flat.split("|")[2]).toBe("");
    expect(flat.endsWith("|undefined|undefined|undefined|")).toBe(true);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();

    await manager.dispose();
  });
});

describe("ModManager 的清单、草稿、工具行与剪贴板（spec「配了哪些、能调什么、有谁在跑」「输入框里现在有什么」「工具行下面的一行」「剪贴板」）", () => {
  const PANEL_MOD = `
exports.register = function ($, on) {
  on("session.start", function () { $.ui.open({ id: "p1", title: "面板" }); });
  on("ui.render", function () {
    var rows = $.config.list().map(function (row) { return row.key + "=" + row.value + (row.isLocked ? "(锁)" : ""); });
    var tools = $.tool.list().map(function (tool) { return tool.name + (tool.mcp ? "(mcp)" : ""); });
    var agents = $.agent.list().map(function (agent) { return agent.id + "@" + agent.status; });
    return __wave.h("Text", null, [rows.join(","), tools.join(","), agents.join(",")].join("|"));
  });
};
`;

  it("三份清单从会话事实来，面板上摊平成一行", async () => {
    const { manager } = createManager(
      { [MOD_PATH]: PANEL_MOD },
      {
        sessionFacts: {
          sessionId: () => "s1",
          workspaceRoot: () => path.resolve("/fake/root"),
          model: () => "",
          surfaces: () => ["desktop"] as const,
          env: () => undefined,
          settings: async () => ({}),
          turns: () => 0,
          repo: () => null,
          version: () => ({ version: "" }),
          configRows: () => [
            {
              key: "model",
              label: "模型",
              kind: "text",
              value: "wave-pro",
              provider: { plugin: "engine", tier: "core" },
              isLocked: true,
            },
          ],
          toolInfos: () => [
            { name: "Bash", description: "跑命令", mcp: false },
            { name: "mcp__fs__read", description: "读文件", mcp: true },
          ],
          agentInfos: () => [
            {
              id: "a1",
              description: "查资料",
              type: "Explore",
              status: "running",
            },
          ],
          sessionMessages: () => [],
          transcriptPath: () => "",
          permissionMode: () => "default",
        },
      },
    );
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    const frame = await pull(manager);
    expect(String((frame.tree as { children: string[] }).children[0])).toBe(
      "model=wave-pro(锁)|Bash,mcp__fs__read(mcp)|a1@running",
    );

    await manager.dispose();
  });

  it("没接剪贴板 / 输入框通道时按「没人接」作答，不抛错", async () => {
    const { manager } = createManager(
      {
        [MOD_PATH]: `
        exports.register = function ($, on) {
          on("session.start", function () { $.ui.open({ id: "p1", title: "面板" }); });
          on("ui.render", async function () {
            var draft = await $.prompt.read();
            var copied = await $.ui.copy({ text: "hi" });
            return __wave.h("Text", null,
              [draft.text, String(draft.cursor), due(copied)].join("|"));
          });
        };
        function due(copied) { return String(copied.isCopied) + ":" + String(copied.reason); }
        `,
      },
      {},
    );
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    const frame = await pull(manager);
    expect(String((frame.tree as { children: string[] }).children[0])).toBe(
      "|0|false:no-surface",
    );

    await manager.dispose();
  });

  it("$.ui.notice 带上插件名转发到出口；没接线时调用照样成功", async () => {
    const notices: Array<[string, string, string | null]> = [];
    const { manager } = createManager(
      {
        [MOD_PATH]: `
        exports.register = function ($, on) {
          on("session.start", function () {
            $.ui.notice("tool-1", "3 个文件");
            $.ui.notice("tool-1", undefined);
          });
        };
        `,
      },
      {},
    );
    manager.setNoticeSink((pluginName, toolUseId, text) =>
      notices.push([pluginName, toolUseId, text]),
    );
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    await vi.waitFor(() =>
      expect(notices).toEqual([
        ["todo", "tool-1", "3 个文件"],
        ["todo", "tool-1", null],
      ]),
    );

    await manager.dispose();
  });

  it("草稿读取接上之后原样把输入框内容交回 mod", async () => {
    const { manager } = createManager(
      {
        [MOD_PATH]: `
        exports.register = function ($, on) {
          on("session.start", function () { $.ui.open({ id: "p1", title: "面板" }); });
          on("ui.render", async function () {
            var draft = await $.prompt.read();
            return __wave.h("Text", null, draft.text + "@" + draft.cursor);
          });
        };
        `,
      },
      {},
    );
    manager.setPromptDraftReader(async () => ({ text: "半句话", cursor: 3 }));
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    const frame = await pull(manager);
    expect(String((frame.tree as { children: string[] }).children[0])).toBe(
      "半句话@3",
    );

    await manager.dispose();
  });
});

/**
 * 工具行上那一行的收口（spec「工具行下面的一行」）：工具结束由宿主撤，插件不必
 * 自己清理。所以宿主得记「哪个 tool_use_id 上是谁贴的」—— 同一个工具可以被几个
 * mod 各贴一行，收口时要逐条发 `text: null`；插件自己撤掉的那条不能再撤一遍。
 */
describe("ModManager 自动撤除工具行上的 notice", () => {
  /** 在 `session.start` 里贴一行的 mod。 */
  const noticeAtStart = (line: string) => `
exports.register = function ($, on) {
  on("session.start", function () {
    ${line}
  });
};
`;

  /** 接上 notice 出口的 manager：`sources` 是「插件名 → 这个插件的 mod 源码」。 */
  async function sinkManager(sources: Record<string, string>) {
    const notices: Array<[string, string, string | null]> = [];
    const files: Record<string, string> = {};
    const plugins: Plugin[] = [];
    for (const [name, source] of Object.entries(sources)) {
      const file = path.join(ROOT, "mods", `${name}.tsx`);
      files[file] = source;
      plugins.push(namedPlugin(name, [{ id: `${name}:panel`, path: file }]));
    }
    const { manager } = createManager(files);
    manager.setNoticeSink((pluginName, toolUseId, text) =>
      notices.push([pluginName, toolUseId, text]),
    );
    await manager.loadFromPlugins(plugins);
    await manager.startSession();
    return { manager, notices };
  }

  it("工具结束时逐条撤：同一个工具上两个插件各收到一条 null", async () => {
    const { manager, notices } = await sinkManager({
      todo: noticeAtStart('$.ui.notice("tool-1", "todo 贴的");'),
      guard: noticeAtStart('$.ui.notice("tool-1", "guard 贴的");'),
    });
    await vi.waitFor(() => expect(notices).toHaveLength(2));

    manager.clearToolNotices("tool-1");

    // 顺序跟着记账的迭代走，不按下标断言：按内容认。
    const cleared = notices.slice(2);
    expect(cleared).toHaveLength(2);
    expect(cleared).toEqual(
      expect.arrayContaining([
        ["todo", "tool-1", null],
        ["guard", "tool-1", null],
      ]),
    );

    await manager.dispose();
  });

  it("没有贴过的工具、以及清完再清一次：都不发 null（幂等）", async () => {
    const { manager, notices } = await sinkManager({
      todo: noticeAtStart('$.ui.notice("tool-1", "已校验");'),
    });
    await vi.waitFor(() => expect(notices).toHaveLength(1));

    manager.clearToolNotices("tool-2");
    expect(notices).toHaveLength(1);

    manager.clearToolNotices("tool-1");
    expect(notices).toHaveLength(2);

    manager.clearToolNotices("tool-1");
    expect(notices).toHaveLength(2);

    await manager.dispose();
  });

  it("插件自己先撤掉的那一行，收口时不会多出一条 null", async () => {
    const { manager, notices } = await sinkManager({
      todo: noticeAtStart(
        '$.ui.notice("tool-1", "已校验"); $.ui.notice("tool-1", undefined);',
      ),
    });
    await vi.waitFor(() => expect(notices).toHaveLength(2));

    manager.clearToolNotices("tool-1");

    expect(notices).toEqual([
      ["todo", "tool-1", "已校验"],
      ["todo", "tool-1", null],
    ]);

    await manager.dispose();
  });
});

describe("ModManager 的轮次事件（turn.start / turn.step / session.compact）", () => {
  const TIMELINE_MOD = `
exports.register = function ($, on) {
  on("turn.start", function (e) { $.ui.status("start:" + e.step + ":" + e.turnId); });
  on("turn.step", function (e) { $.ui.status("step:" + e.index + ":" + e.turnId + ":" + e.model); });
  on("session.compact", function (e) {
    $.ui.status("compact:" + e.trigger + ":" + e.tokensBefore + ">" + e.tokensAfter);
  });
};
`;

  it("三个事件都派发到注册了它们的 mod，载荷原样", async () => {
    const { manager, statuses } = createManager({ [MOD_PATH]: TIMELINE_MOD });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    manager.notifyMods("turn.start", { turnId: "t-9" });
    await vi.waitFor(() =>
      expect(statuses.at(-1)?.text).toBe("start:undefined:t-9"),
    );

    const stepped = await manager.dispatchTurnStep({
      turnId: "t-9",
      index: 3,
      messageCount: 7,
      model: "claude-sonnet-4",
    });
    await vi.waitFor(() =>
      expect(statuses.at(-1)?.text).toBe("step:3:t-9:claude-sonnet-4"),
    );
    // 没改就是原样带回来。
    expect(stepped).toMatchObject({
      turnId: "t-9",
      index: 3,
      messageCount: 7,
      model: "claude-sonnet-4",
    });

    manager.notifyMods("session.compact", {
      trigger: "auto",
      tokensBefore: 180_000,
      tokensAfter: 20_000,
    });
    await vi.waitFor(() =>
      expect(statuses.at(-1)?.text).toBe("compact:auto:180000>20000"),
    );

    await manager.dispose();
  });

  it("生成器形状：turn.step 的 mod 用 yield* next(e) 转发、用 return 换模型", async () => {
    const STEPGEN_MOD = `
exports.register = function ($, on) {
  on("turn.step", async function* (e, next) {
    $.ui.status("outer:" + e.model);
    const below = yield* next(e);
    return { ...below, model: "claude-opus-4" };
  });
  on("turn.step", async function* (e, next) {
    $.ui.status("inner:" + e.model);
    const below = yield* next({ ...e, effort: "high" });
    return { ...below, effort: "high" };
  });
};
`;
    const { manager, statuses } = createManager({ [MOD_PATH]: STEPGEN_MOD });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    const stepped = await manager.dispatchTurnStep({
      turnId: "t-1",
      index: 0,
      messageCount: 2,
      model: "claude-sonnet-4",
    });

    // 外层先跑、下游再跑，最终模型由最外层决定，推理强度由内层加。
    expect(statuses.map((status) => status.text)).toEqual([
      "outer:claude-sonnet-4",
      "inner:claude-sonnet-4",
    ]);
    expect(stepped).toMatchObject({
      turnId: "t-1",
      index: 0,
      messageCount: 2,
      model: "claude-opus-4",
      effort: "high",
    });

    await manager.dispose();
  });

  it("mod 里的 model 不是非空字符串时按没改", async () => {
    const BAD_MOD = `
exports.register = function ($, on) {
  on("turn.step", function (e) { return { ...e, model: "  ", index: 99 }; });
};
`;
    const { manager } = createManager({ [MOD_PATH]: BAD_MOD });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    const stepped = await manager.dispatchTurnStep({
      turnId: "t-2",
      index: 1,
      messageCount: 0,
      model: "claude-sonnet-4",
    });
    // 轮次与序号是宿主的事实，mod 改不动。
    expect(stepped).toMatchObject({
      turnId: "t-2",
      index: 1,
      model: "claude-sonnet-4",
    });

    await manager.dispose();
  });
});

describe("ModManager.endSession（spec「轮次内外的事件」）", () => {
  it("等所有 mod 的 session.end 跑完；失败的只记 warn，不影响别人", async () => {
    const ok = path.join(ROOT, "mods", "ok.tsx");
    const boom = path.join(ROOT, "mods", "boom.tsx");
    const { manager } = createManager({
      [ok]: `
exports.register = function ($, on) {
  on("session.end", function () { $.store.set("ended", $.session.cwd ? "1" : "0"); });
};
`,
      [boom]: `
exports.register = function ($, on) {
  on("session.end", function () { throw new Error("boom"); });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([
        { id: "todo:ok", path: ok },
        { id: "todo:boom", path: boom },
      ]),
    ]);
    await manager.startSession();

    // 返回的是 Promise：宿主（`Agent.destroy`）真的会 await 它。
    await expect(manager.endSession()).resolves.toBeUndefined();
    const raw = probe.files.get(storeFile("todo"));
    expect(raw === undefined ? undefined : JSON.parse(raw).ended).toBe("1");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("todo:boom 的 session.end 失败"),
    );

    await manager.dispose();
  });

  it("dispose 之后不再派发（实例已经没了）", async () => {
    const { manager } = createManager({ [MOD_PATH]: COUNTER_MOD });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();
    await manager.dispose();

    vi.mocked(logger.warn).mockClear();
    await expect(manager.endSession()).resolves.toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("ModManager.collectPromptContext（prompt.submit）", () => {
  /** 两个 mod：各自往本轮塞一条上下文。 */
  function contextMod(...items: string[]): string {
    return `
exports.register = function ($, on) {
  on("prompt.submit", function (e) {
    ${items.length === 0 ? "return undefined;" : `return { context: ${JSON.stringify(items)} };`}
  });
};
`;
  }

  async function hooked(sources: Record<string, string>): Promise<{
    manager: ModManager;
    mods: Array<{ id: string; path: string }>;
  }> {
    const mods = Object.keys(sources).map((file, index) => ({
      id: `todo:m${index}`,
      path: file,
    }));
    const { manager } = createManager(sources);
    await manager.loadFromPlugins([plugin(mods)]);
    await manager.startSession();
    return { manager, mods };
  }

  it("按插件顺序合并各 mod 的 context，空白条目丢掉", async () => {
    const first = path.join(ROOT, "mods", "first.tsx");
    const second = path.join(ROOT, "mods", "second.tsx");
    const { manager } = await hooked({
      [first]: contextMod("A", "  ", "B"),
      [second]: contextMod("C"),
    });

    await expect(manager.collectPromptContext("用户原话")).resolves.toEqual([
      "A",
      "B",
      "C",
    ]);

    await manager.dispose();
  });

  it("返回值里的 text / drop 被忽略并记 warn（不改写、不丢弃用户的 prompt）", async () => {
    const rewrite = path.join(ROOT, "mods", "rewrite.tsx");
    const { manager } = await hooked({
      [rewrite]: `
exports.register = function ($, on) {
  on("prompt.submit", function () { return { text: "被改写", drop: true }; });
};
`,
    });

    await expect(manager.collectPromptContext("原文")).resolves.toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("只支持 { context }"),
    );

    await manager.dispose();
  });

  it("非数组 / 非字符串的 context 被忽略并记 warn", async () => {
    const bad = path.join(ROOT, "mods", "bad.tsx");
    const { manager } = await hooked({
      [bad]: `
exports.register = function ($, on) {
  on("prompt.submit", function () { return { context: "一条字符串" }; });
};
`,
    });

    await expect(manager.collectPromptContext("原文")).resolves.toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("context 必须是字符串数组"),
    );

    await manager.dispose();
  });

  it("条数与字数超限的部分丢掉并记一条 warn", async () => {
    const many = path.join(ROOT, "mods", "many.tsx");
    const items = Array.from(
      { length: MOD_LIMITS.promptContextMaxItems + 4 },
      (_, index) => `item-${index}`,
    );
    const { manager } = await hooked({ [many]: contextMod(...items) });

    const context = await manager.collectPromptContext("原文");
    expect(context).toHaveLength(MOD_LIMITS.promptContextMaxItems);
    expect(context[0]).toBe("item-0");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `只用了前 ${MOD_LIMITS.promptContextMaxItems} 条`,
      ),
    );

    await manager.dispose();
  });

  it("钩子抛错只记 warn，别的 mod 的 context 照样进本轮", async () => {
    const good = path.join(ROOT, "mods", "good.tsx");
    const boom = path.join(ROOT, "mods", "boom.tsx");
    const { manager } = await hooked({
      [good]: contextMod("保留"),
      [boom]: `
exports.register = function ($, on) {
  on("prompt.submit", function () { throw new Error("boom"); });
};
`,
    });

    await expect(manager.collectPromptContext("原文")).resolves.toEqual([
      "保留",
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("prompt.submit 失败"),
    );

    await manager.dispose();
  });

  it("prompt.submit 收到的就是用户敲的原文", async () => {
    const echo = path.join(ROOT, "mods", "echo.tsx");
    const { manager } = await hooked({
      [echo]: `
exports.register = function ($, on) {
  on("prompt.submit", function (e) { return { context: ["echo:" + e.text] }; });
};
`,
    });

    await expect(
      manager.collectPromptContext("部署到测试环境"),
    ).resolves.toEqual(["echo:部署到测试环境"]);

    await manager.dispose();
  });
});

describe("ModManager 的 ui.close（spec「事件」）", () => {
  const CLOSE_MOD = `
exports.register = function ($, on) {
  on("session.start", function () { $.ui.open({ id: "p1", title: "面板" }); });
  on("ui.close", function (e) { $.ui.status("closed:" + e.id); });
  on("session.end", function () { $.ui.status("end"); });
};
`;

  it("关掉一个 pane 时通知打开它的 mod（拦不下关闭）", async () => {
    const { manager, updates, statuses } = createManager({
      [MOD_PATH]: CLOSE_MOD,
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p1",
      key: "",
      kind: "close",
    });
    await vi.waitFor(() => expect(statuses.at(-1)?.text).toBe("closed:p1"));
    // 界面那条关 tab 的指令照旧发（`closed: true`），通知 mod 不改变它。
    expect(paneUpdates(updates).at(-1)?.closed).toBe(true);

    await manager.dispose();
  });

  it("插件重载时旧实例收到 ui.close，会话销毁只发 session.end", async () => {
    const plugins = [plugin([{ id: "todo:panel", path: MOD_PATH }])];
    const { manager, statuses } = createManager({ [MOD_PATH]: CLOSE_MOD });
    await manager.loadFromPlugins(plugins);
    await manager.startSession();

    await manager.reload(plugins);
    await vi.waitFor(() => expect(statuses.at(-1)?.text).toBe("closed:p1"));

    statuses.length = 0;
    await manager.dispose();
    // 销毁不逐条发 ui.close：只剩一条 session.end（没进状态行，所以没有新行）。
    expect(statuses).toEqual([]);
  });
});

describe("ModManager 的工具决议链（tool.call）", () => {
  /** 一条守卫：Bash 的 `rm -rf` 直接拦，其它交下去。 */
  const GUARD_MOD = `
exports.register = function (on) {
  on("tool.call", { tool: "Bash" }, async function ($, e, next) {
    if (e.command === "rm -rf /") return { deny: "删库跑路？先别" };
    return next(e);
  });
};
`;

  /** 第二个守卫：什么都不拦，只是把事件记进状态行。 */
  const OBSERVER_GUARD = `
exports.register = function (on) {
  on("tool.call", async function ($, e, next) {
    $.ui.status("seen:" + e.tool + ":" + e.command);
    return next(e);
  });
};
`;

  function bashEvent(command: string) {
    return {
      ...{ command },
      tool: "Bash",
      tool_use_id: "call-1",
      input: { command },
    };
  }

  it("返回 { deny } 就拦下；matcher 不命中的工具交给下一个", async () => {
    const { manager, statuses } = createManager({
      [MOD_PATH]: GUARD_MOD,
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    expect(await denyOf(manager, bashEvent("rm -rf /"))).toBe("删库跑路？先别");
    // matcher 是 `{ tool: "Bash" }`：换一个工具就不该被这条钩子看见。
    expect(
      await denyOf(manager, {
        ...{ file_path: "a.ts" },
        tool: "Edit",
        tool_use_id: "call-2",
        input: { file_path: "a.ts" },
      }),
    ).toBeUndefined();
    // 无害命令交下去，链尾没人拦。
    expect(await denyOf(manager, bashEvent("ls"))).toBeUndefined();
    expect(statuses).toEqual([]);

    await manager.dispose();
  });

  it("matcher 的值可以是 RegExp（对字符串 test），跨 realm 也认", async () => {
    // 社区 mod 真这么写：`{ command: /git\s+commit/ }`（FunnyQ 的 chronicle）。
    // matcher 在沙箱里造出来，`instanceof RegExp` 在宿主这边是假的，所以按
    // `[object RegExp]` 判。带 `g` 的那条再跑一遍，证明 `lastIndex` 不会串。
    const { manager } = createManager({
      [MOD_PATH]: `
exports.register = function (on) {
  on("tool.call", { tool: "Bash", command: /git\\s+commit/ }, function ($, e) {
    return { deny: "先开分支再提交" };
  });
  on("tool.call", { tool: "Bash", command: /rm -rf/g }, function ($, e) {
    return { deny: "别删" };
  });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    expect(await denyOf(manager, bashEvent("git commit -m x"))).toBe(
      "先开分支再提交",
    );
    expect(await denyOf(manager, bashEvent("ls"))).toBeUndefined();
    expect(await denyOf(manager, bashEvent("rm -rf build"))).toBe("别删");
    // 同一个 `g` 正则第二次命中：`test` 的 `lastIndex` 已归零。
    expect(await denyOf(manager, bashEvent("rm -rf dist"))).toBe("别删");

    await manager.dispose();
  });

  it("事件字段是对象时，matcher 里的对象按偏匹配比", async () => {
    const { manager } = createManager({
      [MOD_PATH]: `
exports.register = function (on) {
  on("tool.call", { tool: "Bash", input: { command: "git status" } }, function ($, e) {
    return { deny: "状态我来看" };
  });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    expect(await denyOf(manager, bashEvent("git status"))).toBe("状态我来看");
    expect(await denyOf(manager, bashEvent("git log"))).toBeUndefined();

    await manager.dispose();
  });

  it("两个 mod 按加载顺序串行：前一个 next 之后才轮到后一个，deny 从链上传回来", async () => {
    const second = path.join(ROOT, "mods", "second.tsx");
    const { manager, statuses } = createManager({
      [MOD_PATH]: OBSERVER_GUARD,
      [second]: `
exports.register = function (on) {
  on("tool.call", { tool: "Bash" }, function ($, e) {
    return { deny: "第二个 mod 说不" };
  });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([
        { id: "todo:panel", path: MOD_PATH },
        { id: "todo:second", path: second },
      ]),
    ]);
    await manager.startSession();

    // 前一个 mod `return next(e)`：后一个的 deny 原样上去。
    expect(await denyOf(manager, bashEvent("ls"))).toBe("第二个 mod 说不");
    await vi.waitFor(() => expect(statuses.at(-1)?.text).toBe("seen:Bash:ls"));

    await manager.dispose();
  });

  it("前一个 mod await next(e) 之后忘掉返回值，后一个的 deny 也不丢", async () => {
    const second = path.join(ROOT, "mods", "second.tsx");
    const { manager } = createManager({
      [MOD_PATH]: `
exports.register = function (on) {
  on("tool.call", async function ($, e, next) {
    await next(e);
    $.ui.status("passthrough");
  });
};
`,
      [second]: `
exports.register = function (on) {
  on("tool.call", function () {
    return { deny: "还是不" };
  });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([
        { id: "todo:panel", path: MOD_PATH },
        { id: "todo:second", path: second },
      ]),
    ]);
    await manager.startSession();

    expect(await denyOf(manager, bashEvent("ls"))).toBe("还是不");

    await manager.dispose();
  });

  it("钩子抛错时 fail-open：记一条 warn 并放行", async () => {
    const { manager } = createManager({
      [MOD_PATH]: `
exports.register = function (on) {
  on("tool.call", function () {
    throw new Error("boom");
  });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();
    vi.mocked(logger.warn).mockClear();

    expect(await denyOf(manager, bashEvent("ls"))).toBeUndefined();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("tool.call"),
    );

    await manager.dispose();
  });

  it(".catch 里按 next.called 做 fail-closed：没调过 next 就自己 deny", async () => {
    const { manager } = createManager({
      [MOD_PATH]: `
exports.register = function (on) {
  on("tool.call", function () {
    throw new Error("guard 挂了");
  }).catch(function ($, e, next) {
    return next.called ? next(e) : { deny: "守卫失效，先不放行" };
  });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    expect(await denyOf(manager, bashEvent("ls"))).toBe("守卫失效，先不放行");

    await manager.dispose();
  });

  it("tool.call：没注册任何钩子时照样执行一次，链尾给出结果", async () => {
    const { manager } = createManager({});
    await manager.loadFromPlugins([]);
    await manager.startSession();

    const run = vi.fn(async () => ({ success: true }));
    expect(await manager.dispatchToolCall(bashEvent("ls"), { run })).toEqual({
      result: { success: true },
    });
    expect(run).toHaveBeenCalledOnce();

    await manager.dispose();
  });

  it("tool.call：next(e) 就是执行，它 resolve 之后那几行跑在工具结束之后", async () => {
    const { manager, statuses } = createManager({
      [MOD_PATH]: `
exports.register = function (on) {
  on("tool.call", { tool: "Bash" }, async function ($, e, next) {
    $.ui.status("before");
    var below = await next(e);
    $.ui.status("after:" + below.result.ok);
    return below;
  });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    const run = vi.fn(async () => ({ ok: 7 }));
    expect(await manager.dispatchToolCall(bashEvent("ls"), { run })).toEqual({
      result: { ok: 7 },
    });
    expect(run).toHaveBeenCalledOnce();
    // 「before」在工具之前、「after」在它之后 —— 顺序就是钩子里的源码顺序。
    await vi.waitFor(() =>
      expect(statuses.map((line) => line.text)).toEqual(["before", "after:7"]),
    );

    await manager.dispose();
  });

  it("classic.PreToolUse 拿到同一份信封，{ deny } 照样拦下", async () => {
    // spec「影子事件」：社区插件（chronicle、FlowCTL）只写 CC 那个名字。信封是
    // `tool.call` 的那份（`tool` / `tool_use_id` / `input` + 顶层铺开的参数），
    // **不带** `hook_event_name` —— CC 在自己 mods 面里就是这个形状。
    const { manager, statuses } = createManager({
      [MOD_PATH]: `
exports.register = function (on) {
  on("classic.PreToolUse", { tool: "Bash" }, function ($, e) {
    $.ui.status([
      e.tool,
      e.tool_use_id,
      e.command,
      String(e.input.command),
      String(e.hook_event_name),
    ].join("|"));
    if (e.command === "rm -rf /") return { deny: "这条不许跑" };
    return {};
  });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    expect(await denyOf(manager, bashEvent("rm -rf /"))).toBe("这条不许跑");
    await vi.waitFor(() =>
      expect(statuses.at(-1)?.text).toBe(
        "Bash|call-1|rm -rf /|rm -rf /|undefined",
      ),
    );
    // matcher 是 `{ tool: "Bash" }`：别的工具不该被它看见。
    expect(
      await denyOf(manager, {
        ...{ file_path: "a.ts" },
        tool: "Edit",
        tool_use_id: "call-2",
        input: { file_path: "a.ts" },
      }),
    ).toBeUndefined();

    await manager.dispose();
  });

  it("tool.call 已经拦下时不再问 classic.PreToolUse", async () => {
    const second = path.join(ROOT, "mods", "second.tsx");
    const { manager, statuses } = createManager({
      [MOD_PATH]: GUARD_MOD,
      [second]: `
exports.register = function (on) {
  on("classic.PreToolUse", function ($, e) {
    $.ui.status("classic:asked");
    return { deny: "第二个名字说不" };
  });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([
        { id: "todo:panel", path: MOD_PATH },
        { id: "todo:second", path: second },
      ]),
    ]);
    await manager.startSession();

    // 前一个名字已经拒了：这条链到此为止，第二个名字连问都不问。
    expect(await denyOf(manager, bashEvent("rm -rf /"))).toBe("删库跑路？先别");
    expect(statuses).toEqual([]);
    // 前一个名字放行时才轮到它。
    expect(await denyOf(manager, bashEvent("ls"))).toBe("第二个名字说不");
    await vi.waitFor(() =>
      expect(statuses.map((line) => line.text)).toContain("classic:asked"),
    );

    await manager.dispose();
  });

  it("classic.PreToolUse 的 allow/ask/updatedInput 不生效，但要点名", async () => {
    // 只支持 `{ deny }`（spec「交付分层」）：静默忽略会让作者以为放行生效了。
    const { manager } = createManager({
      [MOD_PATH]: `
exports.register = function (on) {
  on("classic.PreToolUse", function () {
    return { allow: true };
  });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();
    vi.mocked(logger.warn).mockClear();

    // 放行 ≠ 拦截：调用照常放下去（`undefined`）。
    expect(await denyOf(manager, bashEvent("ls"))).toBeUndefined();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("allow/ask/updatedInput"),
    );

    await manager.dispose();
  });
  it("next.trace 跨 mod：外层跑完之后看得到下游那个 mod 的那一层", async () => {
    // Claude Code 的 trace 是整条链的一份（跨插件都算），社区用 `next.trace`
    // 回答「下面是谁炸的」。我们的链是 `ModManager` 逐个 mod 串起来的，每个 mod
    // 是**不同的** `ModRuntime` 实例，所以这条用例钉住「跨实例仍是同一份」。
    //
    // 只收「已经跑完」的层：内层读的时候外层还挂在 `await next(e)` 上，所以内层
    // 看到的是 0 条；外层 `await` 回来才看得到内层那一条。
    const second = path.join(ROOT, "mods", "second.tsx");
    const { manager, statuses } = createManager({
      [MOD_PATH]: `
exports.register = function (on) {
  on("tool.call", async function ($, e, next) {
    var below = await next(e);
    var layer = next.trace[0];
    $.ui.status("outer:" + next.trace.length + ":" + layer.index + ":" +
      layer.plugin + ":" + layer.tier + ":" + layer.event + ":" + layer.outcome);
    return below;
  });
};
`,
      [second]: `
exports.register = function (on) {
  on("tool.call", async function ($, e, next) {
    $.ui.status("inner:" + next.trace.length);
    return next(e);
  });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([
        { id: "todo:panel", path: MOD_PATH },
        { id: "todo:second", path: second },
      ]),
    ]);
    await manager.startSession();

    expect(await denyOf(manager, bashEvent("ls"))).toBeUndefined();
    await vi.waitFor(() => expect(statuses.length).toBe(2));
    expect(statuses.map((line) => line.text)).toEqual([
      "inner:0",
      "outer:1:0:todo:user:tool.call:returned",
    ]);

    await manager.dispose();
  });
});

describe("ModManager 的 $.turn.abort", () => {
  const abortMod = (turnId: string) => `
exports.register = function (on) {
  on("session.start", async function ($) {
    await $.turn.abort({ turnId: "${turnId}" });
  });
};
`;

  async function buildAbort(turnId = "t-1") {
    const { manager } = createManager({ [MOD_PATH]: abortMod(turnId) });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    return manager;
  }

  it("把 turnId 交给宿主接上的那条通道", async () => {
    const manager = await buildAbort("t-42");
    const aborted: string[] = [];
    manager.setTurnAborter((turnId) => aborted.push(turnId));

    await manager.startSession();

    expect(aborted).toEqual(["t-42"]);
    await manager.dispose();
  });

  it("宿主没接通道时抛错（钩子 fail-open，落到 warn 上）", async () => {
    // spec「收掉一轮」：静默成功会让插件以为自己叫停了，所以这条必须抛。
    const manager = await buildAbort();
    vi.mocked(logger.warn).mockClear();

    await manager.startSession();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("没有接入轮次中断通道"),
    );

    await manager.dispose();
  });
});

describe("ModManager 的 $.ui.ask", () => {
  const ASK_MOD = `
exports.register = function (on) {
  on("tool.call", { tool: "Bash" }, async function ($, e, next) {
    try {
      var answer = await $.ui.ask("要跑吗？\\n" + e.command, ["允许一次", "拒绝"]);
      return answer === "允许一次" ? next(e) : { deny: "用户拒绝" };
    } catch (error) {
      return { deny: "没人能确认" };
    }
  });
};
`;

  async function buildAsk(
    answer: string | Error,
  ): Promise<{ manager: ModManager; asked: unknown[] }> {
    const asked: unknown[] = [];
    const { manager } = createManager({ [MOD_PATH]: ASK_MOD });
    manager.setAskUser(async (question, options) => {
      asked.push({ question, options });
      if (answer instanceof Error) throw answer;
      return answer;
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();
    return { manager, asked };
  }

  const event = {
    ...{ command: "git push --force" },
    tool: "Bash",
    tool_use_id: "call-1",
    input: { command: "git push --force" },
  };

  it("选中「允许一次」就放行，问题与选项原样交给宿主", async () => {
    const { manager, asked } = await buildAsk("允许一次");

    expect(await denyOf(manager, event)).toBeUndefined();
    expect(asked).toEqual([
      {
        question: "要跑吗？\ngit push --force",
        options: {
          labels: ["允许一次", "拒绝"],
          header: "todo",
        },
      },
    ]);

    await manager.dispose();
  });

  it("用户选了拒绝就 deny", async () => {
    const { manager } = await buildAsk("拒绝");
    expect(await denyOf(manager, event)).toBe("用户拒绝");
    await manager.dispose();
  });

  it("没人能答（宿主 reject）时守卫按「没人能确认」处理", async () => {
    const { manager } = await buildAsk(new Error("没有界面"));
    expect(await denyOf(manager, event)).toBe("没人能确认");
    await manager.dispose();
  });
});

describe("ModManager 的 classic.Stop 返回值", () => {
  /** 收到 `classic.Stop` 记一行状态（观察 `e` 的形状），再按 body 返回。 */
  const stopMod = (body: string) => `
exports.register = function ($, on) {
  on("classic.Stop", function (e) {
    $.ui.status([e.hook_event_name, String(e.stop_hook_active), e.permission_mode, e.background_tasks.length].join("|"));
    ${body}
  });
};
`;

  it("按加载顺序拍平 additionalContext，公共五字段与 stop_hook_active 原样", async () => {
    // spec「一轮收尾时的非错误反馈」：插件要说的话按加载顺序拍平，空串丢掉；
    // `e` 仍是影子事件的形状（`stop_hook_active` 由调用方给）。
    const first = path.join(ROOT, "mods", "first.tsx");
    const second = path.join(ROOT, "mods", "second.tsx");
    const { manager, statuses } = createManager({
      [first]: stopMod(
        `return { additionalContext: [" 先跑测试 ", "", "再看 diff"] };`,
      ),
      [second]: stopMod(`return { additionalContext: ["第二个插件"] };`),
    });
    await manager.loadFromPlugins([
      plugin([
        { id: "todo:first", path: first },
        { id: "todo:second", path: second },
      ]),
    ]);
    await manager.startSession();

    await expect(
      manager.collectStopContext({
        background_tasks: [],
        stop_hook_active: true,
      }),
    ).resolves.toEqual(["先跑测试", "再看 diff", "第二个插件"]);
    await vi.waitFor(() =>
      expect(statuses.at(-1)?.text).toBe("Stop|true|default|0"),
    );

    await manager.dispose();
  });

  it("decision / preventContinuation 不支持：忽略并记一条 warn", async () => {
    const { manager } = createManager({
      [MOD_PATH]: stopMod(
        `return { decision: "block", reason: "还没完", additionalContext: ["照收"] };`,
      ),
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    await expect(
      manager.collectStopContext({
        background_tasks: [],
        stop_hook_active: false,
      }),
    ).resolves.toEqual(["照收"]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("只支持 { additionalContext }"),
    );

    await manager.dispose();
  });

  it("非字符串数组的 additionalContext 被丢掉并记一条 warn", async () => {
    const { manager } = createManager({
      [MOD_PATH]: stopMod(`return { additionalContext: [1, 2] };`),
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    await expect(
      manager.collectStopContext({
        background_tasks: [],
        stop_hook_active: false,
      }),
    ).resolves.toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("additionalContext 必须是字符串数组"),
    );

    await manager.dispose();
  });

  it("一个 mod 抛错只影响自己：另一个 mod 的反馈照收", async () => {
    const boom = path.join(ROOT, "mods", "boom.tsx");
    const ok = path.join(ROOT, "mods", "ok.tsx");
    const { manager } = createManager({
      [boom]: `
exports.register = function ($, on) {
  on("classic.Stop", function () { throw new Error("boom"); });
};
`,
      [ok]: stopMod(`return { additionalContext: ["还好我没事"] };`),
    });
    await manager.loadFromPlugins([
      plugin([
        { id: "todo:boom", path: boom },
        { id: "todo:ok", path: ok },
      ]),
    ]);
    await manager.startSession();

    await expect(
      manager.collectStopContext({
        background_tasks: [],
        stop_hook_active: false,
      }),
    ).resolves.toEqual(["还好我没事"]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("todo:boom 的 classic.Stop 失败"),
    );

    await manager.dispose();
  });

  it("没有 mod 注册这条事件时返回空数组（没人说话就照常收尾）", async () => {
    const { manager } = createManager();
    await manager.loadFromPlugins([{ name: "plain", path: ROOT } as Plugin]);
    await manager.startSession();

    await expect(
      manager.collectStopContext({
        background_tasks: [],
        stop_hook_active: false,
      }),
    ).resolves.toEqual([]);

    await manager.dispose();
  });
});

describe("ModManager 的 classic.SubagentStop 返回值", () => {
  /** 收到 `classic.SubagentStop` 记一行状态（观察 `e` 的形状），再按 body 返回。 */
  const subagentStopMod = (body: string) => `
exports.register = function ($, on) {
  on("classic.SubagentStop", function (e) {
    $.ui.status([e.hook_event_name, e.agent_id, e.agent_type, String(e.stop_hook_active), String(e.background_tasks)].join("|"));
    ${body}
  });
};
`;

  it("派发 classic.SubagentStop 并收集 additionalContext（子代理那一份载荷）", async () => {
    // spec「一轮收尾时的非错误反馈」：子代理那一轮和主会话同一条通道，只是事件
    // 名字与载荷换成子代理的（没有 `background_tasks` / `session_crons` 这两格）。
    const { manager, statuses } = createManager({
      [MOD_PATH]: subagentStopMod(
        `return { additionalContext: ["先把测试补上"] };`,
      ),
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    await expect(
      manager.collectSubagentStopContext({
        agent_id: "sub-1",
        agent_type: "reporter",
        stop_hook_active: false,
      }),
    ).resolves.toEqual(["先把测试补上"]);
    await vi.waitFor(() =>
      expect(statuses.at(-1)?.text).toBe(
        "SubagentStop|sub-1|reporter|false|undefined",
      ),
    );

    await manager.dispose();
  });

  it("两个名字互不串台：classic.Stop 的收集不会打到 SubagentStop 钩子上", async () => {
    const { manager } = createManager({
      [MOD_PATH]: subagentStopMod(
        `return { additionalContext: ["子代理专属"] };`,
      ),
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    await expect(
      manager.collectStopContext({
        background_tasks: [],
        stop_hook_active: false,
      }),
    ).resolves.toEqual([]);

    await manager.dispose();
  });
});

describe("插件自己的工具、子代理与模型通道", () => {
  /** 交一个自己的工具、并在 `tool.call` 里把结果答掉（spec「把我们自己的工具交给模型」）。 */
  const LOOKUP_MOD = `
exports.register = function ($, on) {
  on("tool.register", function () {
    $.tool.register({
      name: "lookup_ticket",
      description: "查工单",
      inputSchema: { type: "object", properties: { id: { type: "number" } } }
    });
  });
  on("tool.call", { tool: "mcp__todo__lookup_ticket" }, function (e) {
    return { result: { id: e.input.id, title: "登录坏了" } };
  });
};
`;

  it("tool.register 归一成 mcp__<plugin>__<name>，tool.call 的 { result } 就是那次调用的结果", async () => {
    const { manager } = createManager({ [MOD_PATH]: LOOKUP_MOD });
    const registered: Array<{
      name: string;
      description: string;
      plugin: string;
    }> = [];
    const unregister = vi.fn();
    manager.setToolBridge({
      register: (spec) => {
        registered.push(spec);
        return { ok: true };
      },
      unregister,
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();
    await manager.dispatchToolRegister();

    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({
      name: "mcp__todo__lookup_ticket",
      description: "查工单",
      plugin: "todo",
    });
    expect(manager.ownsTool("mcp__todo__lookup_ticket")).toBe(true);

    await expect(
      manager.dispatchToolCall({
        ...{ id: 7 },
        tool: "mcp__todo__lookup_ticket",
        tool_use_id: "call-1",
        input: { id: 7 },
      }),
    ).resolves.toEqual({ result: { id: 7, title: "登录坏了" } });

    // 重载要把工具摘掉：工具表里留着指向旧沙箱的钩子，模型下一次调用就打到
    // 一个已经没人的实例上。
    await manager.reload([{ name: "plain", path: ROOT } as Plugin]);
    expect(unregister).toHaveBeenCalledWith("mcp__todo__lookup_ticket");
    expect(manager.ownsTool("mcp__todo__lookup_ticket")).toBe(false);

    await manager.dispose();
  });

  it("isDeferred 跟着规格透传：false 才平铺，缺省不带这一位（= 进池）", async () => {
    const { manager } = createManager({
      [MOD_PATH]: `
exports.register = function ($, on) {
  on("tool.register", function () {
    $.tool.register({
      name: "flat_one",
      description: "平铺的",
      isDeferred: false
    });
    $.tool.register({ name: "pooled_one", description: "进池的" });
  });
};
`,
    });
    const registered: Array<{ name: string; isDeferred?: boolean }> = [];
    manager.setToolBridge({
      register: (spec) => {
        registered.push(spec);
        return { ok: true };
      },
      unregister: vi.fn(),
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();
    await manager.dispatchToolRegister();

    expect(registered).toHaveLength(2);
    expect(registered[0]).toMatchObject({
      name: "mcp__todo__flat_one",
      isDeferred: false,
    });
    // 缺省不编造这一位：默认延迟由工具表那边判（与 MCP 同一条默认）。
    expect("isDeferred" in registered[1]).toBe(false);

    await manager.dispose();
  });

  it("isDeferred 不是布尔时当场失败，不挂进工具表", async () => {
    const { manager } = createManager({
      [MOD_PATH]: `
exports.register = function ($, on) {
  on("tool.register", function () {
    // await + catch：错误要是「当场抛」，而不是悄悄放过这一位。
    return $.tool.register({
      name: "bad_one",
      description: "写错了的",
      isDeferred: "yes"
    }).then(
      function () { return "registered"; },
      function (error) { return error.message; }
    );
  });
};
`,
    });
    const register = vi.fn().mockReturnValue({ ok: true });
    manager.setToolBridge({ register, unregister: vi.fn() });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();
    await manager.dispatchToolRegister();

    expect(register).not.toHaveBeenCalled();
    expect(manager.ownsTool("mcp__todo__bad_one")).toBe(false);

    await manager.dispose();
  });

  it("对任何工具返回 { result } 都算这次调用的结果（CC 同口径）", async () => {
    // `next(e)` 真的执行之后，mod 拿到结果再改写是正常写法；自己造一份同样是
    // CC 允许的。宿主只看「这次调用的结果是什么」，不再按工具归属筛。
    const { manager } = createManager({
      [MOD_PATH]: `
exports.register = function (on) {
  on("tool.call", { tool: "Bash" }, function () {
    return { result: { pretend: "ran" } };
  });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    await expect(
      manager.dispatchToolCall({
        ...{ command: "ls" },
        tool: "Bash",
        tool_use_id: "call-1",
        input: { command: "ls" },
      }),
    ).resolves.toEqual({ result: { pretend: "ran" } });

    await manager.dispose();
  });

  it("tool.call 的 next(e) 走到链尾时真执行，mod 拿得到结果", async () => {
    const { manager } = createManager({
      [MOD_PATH]: `
exports.register = function ($, on) {
  on("tool.call", { tool: "Bash" }, async function (e, next) {
    const below = await next(e);
    return { result: { ...below.result, seen: true } };
  });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    const run = vi.fn(async () => ({
      success: true,
      content: "file.txt",
    }));
    const decision = await manager.dispatchToolCall(
      {
        tool: "Bash",
        tool_use_id: "call-2",
        input: { command: "ls" },
      },
      { run },
    );

    // 执行体只跑一次，mod 在后处理里看得到它的结果。
    expect(run).toHaveBeenCalledTimes(1);
    expect(decision).toEqual({
      result: { success: true, content: "file.txt", seen: true },
    });

    await manager.dispose();
  });

  it("$.agent.spawn 交到桥上，把 model 与 agentId 还给 mod（不等它跑完）", async () => {
    const { manager, statuses } = createManager({
      [MOD_PATH]: `
exports.register = function ($, on) {
  on("session.start", async function () {
    var r = await $.agent.spawn({ prompt: "跑一下", subagentType: "runner" });
    $.ui.status("spawned:" + r.model + ":" + r.agentId);
  });
};
`,
    });
    // 子代理永远不结束：证明 `spawn` 的 resolve 与它的结局无关。
    const settled = new Promise<void>(() => {});
    const spawn = vi.fn(async () => ({
      model: "test-model",
      agentId: "agent-7",
      settled,
    }));
    manager.setAgentBridge({ spawn });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    await vi.waitFor(() =>
      expect(statuses.at(-1)?.text).toBe("spawned:test-model:agent-7"),
    );
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "跑一下",
        subagentType: "runner",
        plugin: "todo",
        modId: "todo:panel",
      }),
    );

    await manager.dispose();
  });

  it("$.model.complete 把答案还给 mod；额度用完当场 reject（不混进 aborted）", async () => {
    const { manager, statuses } = createManager({
      [MOD_PATH]: `
exports.register = function ($, on) {
  on("session.start", async function () {
    var first = await $.model.complete({ model: "fast", prompt: "q1" });
    $.ui.status("first:" + (first.isAnswered ? first.text : first.reason));
    try {
      await $.model.complete({ model: "fast", prompt: "q2" });
    } catch (error) {
      $.ui.status("err:" + error.message);
    }
  });
};
`,
    });
    const complete = vi.fn(async () => ({
      isAnswered: true as const,
      text: "答了",
      usage: {
        prompt: 1,
        completion: 1,
        cacheRead: 0,
        cacheCreation: 0,
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }));
    manager.setModelBridge({ complete });
    // `as const` 只冻类型，运行时还是可写的：压到 1 次让第二次调用越界。
    const limits = MOD_LIMITS as unknown as {
      modModelCallsPerSession: number;
    };
    const original = limits.modModelCallsPerSession;
    limits.modModelCallsPerSession = 1;
    try {
      await manager.loadFromPlugins([
        plugin([{ id: "todo:panel", path: MOD_PATH }]),
      ]);
      await manager.startSession();

      await vi.waitFor(() =>
        expect(statuses.map((entry) => entry.text)).toEqual([
          "first:答了",
          expect.stringContaining("最多 1 次"),
        ]),
      );
      expect(complete).toHaveBeenCalledTimes(1);
      expect(complete).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "fast",
          plugin: "todo",
          maxTokens: 1024,
        }),
      );
    } finally {
      limits.modModelCallsPerSession = original;
      await manager.dispose();
    }
  });

  it("agent.spawn 的 matcher 用事件自己的键 { subagentType }，别的类型不命中", async () => {
    // 事件里叫 `subagentType`（CC 的 `agent.spawn` 事件字段也是这个），matcher
    // 写同一把钥匙；`{ agent }` 是 `agent.offer` 的键，不跨事件别名。
    const { manager, statuses } = createManager({
      [MOD_PATH]: `
exports.register = function ($, on) {
  on("agent.spawn", { subagentType: "Explore" }, function (e) {
    $.ui.status("seen:" + e.subagentType);
    return { deny: "只许只读子代理" };
  });
};
`,
    });
    const tail = vi.fn(async () => ({ model: "test-model" }));
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    await expect(
      manager.dispatchAgentSpawn(
        { prompt: "p", subagentType: "general-purpose" },
        tail,
      ),
    ).resolves.toEqual({ value: { model: "test-model" } });
    expect(statuses).toEqual([]);

    await expect(
      manager.dispatchAgentSpawn(
        { prompt: "p", subagentType: "Explore" },
        tail,
      ),
    ).resolves.toEqual({ deny: "只许只读子代理" });
    expect(statuses.map((entry) => entry.text)).toEqual(["seen:Explore"]);
    expect(tail).toHaveBeenCalledTimes(1);

    await manager.dispose();
  });
});

/** 与 {@link plugin} 一样，只是插件注册名可换（跨 mod 的 matcher 要靠它区分）。 */
function namedPlugin(
  name: string,
  mods: Array<{ id: string; path: string }>,
): Plugin {
  return {
    name,
    path: ROOT,
    mods: mods.map((mod) => ({
      ...mod,
      name: path.basename(mod.path),
      pluginRoot: ROOT,
    })),
  } as unknown as Plugin;
}

/** 一个画面板、三种控件各一个，并把「回调结果」与「钩子看到的」画出来的 mod。 */
function controlsMod(hooks: string): string {
  return `
exports.register = function ($, on) {
  on("session.start", function () {
    $.ui.open({ id: "p1", title: "控件" });
  });
  on("ui.render", function () {
    var callback = $.state.get("callback") || "none";
    var seen = $.state.get("seen") || "none";
    return __wave.h("Box", null,
      __wave.h("Button", { key: "go", label: "走", onPress: function () {
        $.state.set("callback", "go");
      }}),
      __wave.h("Button", { key: "other", label: "别的", onPress: function () {
        $.state.set("callback", "other");
      }}),
      __wave.h("Input", { key: "tag", onSubmit: function (value) {
        $.state.set("callback", "input:" + value);
      }}),
      __wave.h("Text", null, "callback=" + callback + " seen=" + seen)
    );
  });
  ${hooks}
};
`;
}

describe("ModManager 的控件交互事件（ui.press / ui.input / ui.select）", () => {
  async function opened(hooks: string) {
    const created = createManager({ [MOD_PATH]: controlsMod(hooks) });
    await created.manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await created.manager.startSession();
    await vi.waitFor(() => expect(created.updates).toHaveLength(1));
    // 元素回调是在 `h()` 里登记进 mod 的处理表的：没渲染过就没有可点的东西。
    await pull(created.manager);
    return created;
  }

  /** 一次交互 → 重画一帧，看 mod 自己画出来的那两个观察值。 */
  async function interact(
    manager: ModManager,
    payload: { key: string; kind: "press" | "input"; value?: string },
  ): Promise<string> {
    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p1",
      ...payload,
    });
    const frame = await pull(manager);
    return JSON.stringify(frame.tree);
  }

  it("钩子跑在控件回调之前，能看见 component / element / requestId", async () => {
    const { manager } = await opened(`
  on("ui.press", function (e) {
    $.state.set("seen", [e.component, e.element, e.requestId, $.state.get("callback") || "none"].join("|"));
  });
`);

    expect(await interact(manager, { key: "go", kind: "press" })).toContain(
      // `callback` 还是 none：钩子跑的时候控件自己的 `onPress` 还没跑。
      // `component` 是站点（`Pane`），不是控件类型 —— 与 CC 的 `UiPressArgument` 一致。
      "callback=go seen=Pane|go|p1|none",
    );

    await manager.dispose();
  });

  it("返回 { value } 换掉回调收到的值", async () => {
    const { manager } = await opened(`
  on("ui.input", function (e) { return { value: e.value + "!" }; });
`);

    expect(
      await interact(manager, { key: "tag", kind: "input", value: "dev" }),
    ).toContain("callback=input:dev!");

    await manager.dispose();
  });

  it("返回 { element } 把这次交互改派给另一个控件", async () => {
    const { manager } = await opened(`
  on("ui.press", function () { return { element: "other" }; });
`);

    // 点的是 `go`，跑的是 `other` 的回调。
    expect(await interact(manager, { key: "go", kind: "press" })).toContain(
      "callback=other",
    );

    await manager.dispose();
  });

  it("非字符串 value 被丢掉、记一条 warn，回调拿原值", async () => {
    vi.mocked(logger.warn).mockClear();
    const { manager } = await opened(`
  on("ui.input", function () { return { value: 42 }; });
`);

    expect(
      await interact(manager, { key: "tag", kind: "input", value: "dev" }),
    ).toContain("callback=input:dev");
    expect(vi.mocked(logger.warn).mock.calls.flat().join(" ")).toContain(
      "非字符串的 value",
    );

    await manager.dispose();
  });

  it("不写 matcher 只收到自己画的控件；写 { plugin } 才能跨 mod", async () => {
    // 观察者在**另一个插件**里：它画的控件跟这次点击毫无关系，只有 matcher
    // 才能让它被叫起来。
    const watchPath = path.join(ROOT, "other", "watch.tsx");
    const watchMod = (matcher: string) => `
exports.register = function ($, on) {
  on("ui.press", ${matcher}function (e) {
    $.ui.status("beta:" + e.element);
  });
};
`;

    const bare = createManager({
      [MOD_PATH]: controlsMod(""),
      [watchPath]: watchMod(""),
    });
    await bare.manager.loadFromPlugins([
      namedPlugin("alpha", [{ id: "alpha:panel", path: MOD_PATH }]),
      namedPlugin("beta", [{ id: "beta:watch", path: watchPath }]),
    ]);
    await bare.manager.startSession();
    await vi.waitFor(() => expect(bare.updates).toHaveLength(1));
    await bare.manager.renderPane("alpha:panel", "p1");
    await bare.manager.handlePanelEvent({
      sessionId: "s1",
      modId: "alpha:panel",
      paneId: "p1",
      key: "go",
      kind: "press",
    });
    // 没写 matcher = 只对自己画的控件：别人的按钮点了不叫它。
    expect(bare.statuses).toEqual([]);
    await bare.manager.dispose();

    const pinned = createManager({
      [MOD_PATH]: controlsMod(""),
      [watchPath]: watchMod('{ plugin: "alpha" }, '),
    });
    await pinned.manager.loadFromPlugins([
      namedPlugin("alpha", [{ id: "alpha:panel", path: MOD_PATH }]),
      namedPlugin("beta", [{ id: "beta:watch", path: watchPath }]),
    ]);
    await pinned.manager.startSession();
    await vi.waitFor(() => expect(pinned.updates).toHaveLength(1));
    await pinned.manager.renderPane("alpha:panel", "p1");
    await pinned.manager.handlePanelEvent({
      sessionId: "s1",
      modId: "alpha:panel",
      paneId: "p1",
      key: "go",
      kind: "press",
    });
    expect(pinned.statuses.map((entry) => entry.text)).toEqual(["beta:go"]);

    await pinned.manager.dispose();
  });

  it("关面板不触发任何控件事件", async () => {
    const { manager, statuses } = await opened(`
  on("ui.press", function (e) { $.ui.status("pressed:" + e.element); });
`);

    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p1",
      key: "",
      kind: "close",
      origin: "person",
    });

    expect(statuses).toEqual([]);

    await manager.dispose();
  });
});

describe("$.tool.check / $.tool.call", () => {
  /** 两个方向各问一次，把结果贴成状态行（mod 自己看得到答案）。 */
  function probeMod(hooks: string): string {
    return `
exports.register = function ($, on) {
  on("session.start", function () {
    $.tool.check({ tool: "Bash", input: { command: "npm publish" } }).then(function (r) {
      $.ui.status("check=" + r.decision + (r.reason ? ":" + r.reason : ""));
    }, function (e) {
      $.ui.status("check-error=" + e.message);
    });
    $.tool.call({ tool: "Bash", input: { command: "ls" } }).then(function (r) {
      $.ui.status("call=" + (r.deny ? "deny:" + r.deny : "ok"));
    }, function (e) {
      $.ui.status("call-error=" + e.message);
    });
  });
  ${hooks}
};
`;
  }

  async function startedSource(source: string) {
    const created = createManager({ [MOD_PATH]: source });
    await created.manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await created.manager.startSession();
    // 两个询问都是 promise，状态行在 `then` 里贴。
    await vi.waitFor(() => expect(created.statuses).toHaveLength(2));
    // `text: null` 是「撤掉这行」，这里只关心贴出来的那些。
    const texts = created.statuses.map((entry) => entry.text ?? "");
    await created.manager.dispose();
    return texts;
  }

  // 两条询问各自是一条 promise，谁先 resolve 不定 —— 断言按内容认，不按顺序。
  function pick(texts: string[], prefix: string): string {
    const found = texts.find((text) => text.startsWith(prefix));
    if (found === undefined) throw new Error(`没有 ${prefix} 状态行：${texts}`);
    return found;
  }

  it("没人拦时 tool.check 是 allow、tool.call 是放行", async () => {
    const texts = await startedSource(probeMod(""));

    expect(pick(texts, "check=")).toBe("check=allow");
    expect(pick(texts, "call=")).toBe("call=ok");
  });

  it("tool.check 钩子的决定就是答案；tool.call 只回这条链的 deny", async () => {
    const deniedCheck = await startedSource(
      probeMod(`
  on("tool.check", function () { return { decision: "deny", reason: "要先问人" }; });
`),
    );
    expect(pick(deniedCheck, "check=")).toBe("check=deny:要先问人");
    expect(pick(deniedCheck, "call=")).toBe("call=ok");

    const deniedCall = await startedSource(
      probeMod(`
  on("tool.call", function () { return { deny: "只读策略" }; });
`),
    );
    expect(pick(deniedCall, "check=")).toBe("check=allow");
    expect(pick(deniedCall, "call=")).toBe("call=deny:只读策略");
  });

  it("在自家钩子里重入同一个询问会 reject（不能把整条链重跑一遍）", async () => {
    const texts = await startedSource(
      probeMod(`
  on("tool.check", function () {
    return $.tool.check({ tool: "Bash" }).then(function (inner) {
      return { decision: inner.decision };
    });
  });
`),
    );

    // 钩子炸了按拒绝收（tool.check 是唯一 fail-closed 的一条），理由是那句错误。
    const check = pick(texts, "check=");
    expect(check).toContain("check=deny:");
    expect(check).toContain("不能在 tool.check 钩子里调用");
  });

  it("参数不合法时当场 reject，不跑链", async () => {
    const texts = await startedSource(`
exports.register = function ($, on) {
  on("session.start", function () {
    $.tool.check({}).then(function () {
      $.ui.status("no-error");
    }, function (e) {
      $.ui.status("bad=" + e.message);
    });
    $.tool.call({ tool: "  " }).then(function () {
      $.ui.status("no-error");
    }, function (e) {
      $.ui.status("bad=" + e.message);
    });
  });
};
`);

    // 两条都拒了：没有一条贴出 `no-error`。
    expect(texts).toHaveLength(2);
    for (const text of texts) {
      expect(text).toContain("bad=");
      expect(text).toContain("tool 必须是非空字符串");
    }
  });
});

/**
 * 跨 mod 的链由 `ModManager` 自己用 `for` 循环驱动（`runtime.callHook` 只问一个
 * mod），所以「谁发起了这次派发」只能由入口一路传下去 —— `next.origin` 就是它。
 *
 * 两档：引擎自己发起（执行工具、算提示词段、摆建议）是 `{ engine, core }`；
 * mod 用 `$` 主动进链是它自己（`{ <插件名>, user }`）。链上的守卫靠这个值区分
 * 「引擎在干活」和「插件自己来问」。
 *
 * 别和事件体里的 `e.origin` 混：那是 `prompt.suggest` 的「谁提的建议」。
 */
describe("跨 mod 链的 next.origin", () => {
  /** 每条链的钩子都把 `next.origin` 贴成一行状态（发起者 + 哪一层）。 */
  const reportHook = (label: string) =>
    `  on("${label}", function (e, next) {
    $.ui.status("${label}:" + next.origin.plugin + "/" + next.origin.tier);
  });`;

  it("引擎发起时是 { engine, core }", async () => {
    const { manager, statuses } = createManager({
      [MOD_PATH]: `
exports.register = function ($, on) {
${["tool.check", "tool.call", "prompt.suggest"]
  .map((name) => reportHook(name))
  .join("\n")}
};
`,
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    // 三条都是宿主的入口：审批时装工具表、执行工具、把建议摆进输入框。
    await manager.dispatchToolCheck({
      tool: "Bash",
      tool_use_id: "call-1",
      input: { command: "ls" },
      decision: "allow",
    });
    await manager.dispatchToolCall({
      tool: "Bash",
      tool_use_id: "call-1",
      input: { command: "ls" },
    });
    await manager.dispatchPromptSuggest(
      { text: "收尾", origin: { kind: "suggestion" } },
      async () => ({ isShown: true }),
    );

    expect(statuses.map((entry) => entry.text).sort()).toEqual([
      "prompt.suggest:engine/core",
      "tool.call:engine/core",
      "tool.check:engine/core",
    ]);

    await manager.dispose();
  });

  it("mod 用 $.tool.check / $.tool.call / $.agent.spawn 主动进链时是它自己 + user", async () => {
    const { manager, statuses } = createManager({
      [MOD_PATH]: `
exports.register = function ($, on) {
${["tool.check", "tool.call", "agent.spawn"]
  .map((name) => reportHook(name))
  .join("\n")}
  on("session.start", function () {
    $.tool.check({ tool: "Bash" });
    $.tool.call({ tool: "Bash" });
    $.agent.spawn({ prompt: "跑一下" });
  });
};
`,
    });
    // 子代理永远不结束：证明 `spawn` 的 resolve 与它的结局无关（同别的用例）。
    manager.setAgentBridge({
      spawn: vi.fn(async () => ({
        model: "test-model",
        agentId: "agent-1",
        settled: new Promise<void>(() => {}),
      })),
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    await vi.waitFor(() => expect(statuses).toHaveLength(3));
    // 发起者是**这个 mod**（`todo` 插件），不是引擎 —— 三条链都一样。
    expect(statuses.map((entry) => entry.text).sort()).toEqual([
      "agent.spawn:todo/user",
      "tool.call:todo/user",
      "tool.check:todo/user",
    ]);

    await manager.dispose();
  });
});

/**
 * `tool.describe` 的答案：描述是文本，`isDeferred` 是放置裁决。
 */
describe("tool.describe 的答案", () => {
  it("isDeferred 跟着答案付出去；没给就不编造这一位", async () => {
    const { manager } = createManager({
      [MOD_PATH]: `
exports.register = function ($, on) {
  on("tool.describe", { tool: "mcp__todo__flat" }, function () {
    return { description: "改过的", isDeferred: false };
  });
};
`,
    });
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    await expect(
      manager.collectToolDescription({
        name: "mcp__todo__flat",
        description: "宿主给的",
      }),
    ).resolves.toEqual({ description: "改过的", isDeferred: false });
    // 没人接的工具原样返回，不带 isDeferred —— 默认延迟由判定表给。
    await expect(
      manager.collectToolDescription({
        name: "Bash",
        description: "宿主给的",
      }),
    ).resolves.toEqual({ description: "宿主给的" });

    await manager.dispose();
  });
});

/**
 * `$.ui.invalidate("tool.describe")`：插件声明「我给的描述过期了」。
 *
 * describe 缓存是会话级的（工具表由 `ToolManager` 拼），所以这条要连着真的
 * `ToolManager` 一起验：光看 `ModManager` 记了几次账证明不了「真的重问」。
 */
describe('$.ui.invalidate("tool.describe")', () => {
  it("下一次组装请求前重问描述，新答案当次生效", async () => {
    const container = new Container();
    container.register("PermissionManager", {
      isToolDenied: () => false,
      getCurrentEffectiveMode: () => "default",
    });
    container.register("McpManager", {
      getMcpToolsConfig: () => [],
      getMcpToolPlugins: () => [],
      getMcpToolOutputSchemas: () => new Map(),
    } as unknown as McpManager);
    const turns = { value: 1 };
    container.register("MessageManager", {
      countUserTurns: () => turns.value,
    } as unknown as MessageManager);

    const { manager } = createManager({
      [MOD_PATH]: `
exports.register = function ($, on) {
  on("session.start", function () {
    // 换一个答案再声明过期：重问要能看见「新值」，不能只看见「又问了一次」。
    $.state.set("desc", 1);
    $.ui.invalidate("tool.describe");
  });
  on("tool.describe", function (e) {
    return { description: e.description + "#" + ($.state.get("desc") || 0) };
  });
};
`,
    });
    // 装配处（真实运行时是 `containerSetup`）把两边接进同一个容器：
    // `ToolManager` 靠它找到「该问哪个 mod 的钩子」。
    container.register("ModManager", manager);
    const toolManager = new ToolManager({ container });
    toolManager.register({
      name: "FakeTool",
      config: {
        type: "function",
        function: {
          name: "FakeTool",
          description: "宿主的描述",
          parameters: {},
        },
      } as ToolPlugin["config"],
      prompt: () => "宿主的描述",
      execute: vi.fn(),
    });
    const asked = vi.spyOn(manager, "collectToolDescription");
    const descriptionOf = () =>
      toolManager
        .getToolsConfig()
        .find((tool) => tool.function.name === "FakeTool")?.function
        .description;

    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    // 会话里先拼过一次表（早于这次组装）：宿主的原文。
    expect(descriptionOf()).toBe("宿主的描述");
    // 组装请求前 `await`：问一次，答案这一次请求就生效。
    await toolManager.prepareToolDescriptions();
    expect(asked).toHaveBeenCalledTimes(1);
    expect(descriptionOf()).toBe("宿主的描述#0");

    // 再拼一次表也不重问：描述是会话级缓存。
    await toolManager.prepareToolDescriptions();
    expect(asked).toHaveBeenCalledTimes(1);

    // 插件声明过期（`session.start` 里就是这句）。
    await manager.startSession();
    expect(manager.toolDescribeInvalidationCount()).toBe(1);

    // 下一次组装前重问一遍，新答案当次生效（不是再等一轮）。
    await toolManager.prepareToolDescriptions();
    expect(asked).toHaveBeenCalledTimes(2);
    expect(descriptionOf()).toBe("宿主的描述#1");

    await manager.dispose();
  });
});

describe("ModManager 的面板显示与焦点（$.ui.panes）", () => {
  /** 开两块、并把 `$.ui.panes()` 原样画成一格文本 —— mod 只有这一个入口看得到。 */
  const PANES_MOD = `
exports.register = function ($, on) {
  on("session.start", function () {
    $.ui.open({ id: "p1", title: "一" });
    $.ui.open({ id: "p2", title: "二" });
  });
  on("ui.render", async function () {
    return __wave.h("Text", null, JSON.stringify(await $.ui.panes()));
  });
};
`;

  async function opened(facts: ModSessionFacts = factsWith()) {
    const created = createManager(
      { [MOD_PATH]: PANES_MOD },
      { sessionFacts: facts },
    );
    await created.manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await created.manager.startSession();
    return created;
  }

  /** 从 mod 那一侧读一眼台账：渲染一帧，再把那格 JSON 解回来。 */
  async function panesSeenByMod(manager: ModManager): Promise<ModUiPane[]> {
    const frame = await manager.renderPane("todo:panel", "p1");
    const node = frame.tree as unknown as { children?: unknown[] };
    return JSON.parse(String(node.children?.[0]));
  }

  it("没人上报过时 isShown / isFocused 都是 false；新开的那块自带 shown", async () => {
    const { manager } = await opened();

    // 打开第二块时键盘还没人持着 ⇒ 它就是摊开的那个（与 CC 的
    // `shownId: focusedId ?? 新 id` 同一条）；`isFocused` 不猜，等 surface 报。
    expect(await panesSeenByMod(manager)).toEqual([
      {
        id: "p1",
        title: "一",
        isPlaced: true,
        isShown: false,
        isFocused: false,
      },
      {
        id: "p2",
        title: "二",
        isPlaced: true,
        isShown: true,
        isFocused: false,
      },
    ]);
  });

  it("surface 上报是全量快照：换一个 tab 就翻转，键盘回输入框只动 isFocused", async () => {
    const { manager } = await opened();

    manager.setPaneView({
      shown: { modId: "todo:panel", paneId: "p1" },
      focused: { modId: "todo:panel", paneId: "p1" },
    });
    expect(await panesSeenByMod(manager)).toMatchObject([
      { id: "p1", isShown: true, isFocused: true },
      { id: "p2", isShown: false, isFocused: false },
    ]);

    // 终端 Esc：面板还摊着，只是键盘回到输入框（`focused: null`）。
    manager.setPaneView({
      shown: { modId: "todo:panel", paneId: "p1" },
      focused: null,
    });
    expect(await panesSeenByMod(manager)).toMatchObject([
      { id: "p1", isShown: true, isFocused: false },
      { id: "p2", isShown: false, isFocused: false },
    ]);
  });

  it("台账里没有的 ref 一律归 null：迟到的上报不会把刚关掉的那块说活", async () => {
    const { manager } = await opened();
    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p2",
      key: "",
      kind: "close",
      origin: "person",
    });

    manager.setPaneView({
      shown: { modId: "todo:panel", paneId: "p2" },
      focused: { modId: "todo:panel", paneId: "p2" },
    });
    expect(await panesSeenByMod(manager)).toEqual([
      {
        id: "p1",
        title: "一",
        isPlaced: true,
        isShown: false,
        isFocused: false,
      },
    ]);

    // 名字撞上但 mod 不对也算「不在台账里」：两个字段各管各的，不互相顶。
    manager.setPaneView({
      shown: { modId: "ghost", paneId: "p1" },
      focused: { modId: "todo:panel", paneId: "p1" },
    });
    expect(await panesSeenByMod(manager)).toMatchObject([
      { id: "p1", isShown: false, isFocused: true },
    ]);
  });

  it("`e.props.isFocused` 与 `$.ui.panes()` 同源：只在持键盘的那块上是 true", async () => {
    // 渲染站点给的面板事实里也有这一项（spec「`ui.render` 的 `e.props`」）。它
    // 不能是常量：社区里那条用法就是「键盘在面板里时才提示按 Esc 返回对话」。
    const renderFocusMod = `
exports.register = function ($, on) {
  on("session.start", function () {
    $.ui.open({ id: "p1", title: "一" });
    $.ui.open({ id: "p2", title: "二" });
  });
  on("ui.render", function (e) {
    return __wave.h("Text", null, e.requestId + ":" + e.props.isFocused);
  });
};
`;
    const seen = async (manager: ModManager, paneId: string) => {
      const frame = await manager.renderPane("todo:panel", paneId);
      const node = frame.tree as unknown as { children?: unknown[] };
      return String(node.children?.[0]);
    };
    const { manager } = createManager(
      { [MOD_PATH]: renderFocusMod },
      { sessionFacts: factsWith() },
    );
    await manager.loadFromPlugins([
      plugin([{ id: "todo:panel", path: MOD_PATH }]),
    ]);
    await manager.startSession();

    // 还没人报过：不编值。
    expect(await seen(manager, "p1")).toBe("p1:false");
    expect(await seen(manager, "p2")).toBe("p2:false");

    // 键盘落在 p2 ⇒ 只有 p2 那一帧是 true（按 pane 各算各的）。
    manager.setPaneView({
      shown: { modId: "todo:panel", paneId: "p2" },
      focused: { modId: "todo:panel", paneId: "p2" },
    });
    expect(await seen(manager, "p1")).toBe("p1:false");
    expect(await seen(manager, "p2")).toBe("p2:true");

    // Esc 把键盘交回输入框：下一帧又回到 false（surface 会在这一刻补拉一帧）。
    manager.setPaneView({
      shown: { modId: "todo:panel", paneId: "p2" },
      focused: null,
    });
    expect(await seen(manager, "p2")).toBe("p2:false");
  });

  it("迟到的上报不会在重新打开之后「活过来」", async () => {
    const { manager } = await opened();
    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p2",
      key: "",
      kind: "close",
      origin: "person",
    });
    // 关掉之后还有一条迟到的上报，说它还持着键盘。
    manager.setPaneView({
      shown: { modId: "todo:panel", paneId: "p2" },
      focused: { modId: "todo:panel", paneId: "p2" },
    });

    // mod 重新打开它（`session.start` 再来一次是真实路径：插件重载）。
    await manager.startSession();

    // 新开的那块是 shown（没人持着键盘），但**不是** focused —— 没人说它在。
    expect(await panesSeenByMod(manager)).toMatchObject([
      { id: "p1", isShown: false, isFocused: false },
      { id: "p2", isShown: true, isFocused: false },
    ]);
  });

  it("关掉摊开的那块：两个标记都清空，不自动顶到相邻 tab", async () => {
    const { manager } = await opened();
    manager.setPaneView({
      shown: { modId: "todo:panel", paneId: "p2" },
      focused: { modId: "todo:panel", paneId: "p2" },
    });

    await manager.handlePanelEvent({
      sessionId: "s1",
      modId: "todo:panel",
      paneId: "p2",
      key: "",
      kind: "close",
      origin: "person",
    });

    // 剩下那块也报 false：谁也没说它是摊开的，不替 surface 猜。
    expect(await panesSeenByMod(manager)).toEqual([
      {
        id: "p1",
        title: "一",
        isPlaced: true,
        isShown: false,
        isFocused: false,
      },
    ]);
  });

  it("isPlaced 跟「这一帧有没有表面在画」走，不是登记成功没", async () => {
    const { manager } = await opened(
      factsWith({ surfaces: () => [] as const }),
    );
    expect(
      (await panesSeenByMod(manager)).map((pane) => pane.isPlaced),
    ).toEqual([false, false]);
  });
});

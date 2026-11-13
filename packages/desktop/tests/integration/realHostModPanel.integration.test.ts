/**
 * Real-host integration suite — plugin MODS panels.
 *
 * Covers the cross-process seam the unit layers cannot: a real plugin's TSX mod
 * is compiled and run inside the `wave --stdio` child process, and its panel
 * snapshot must travel CLI → stdio notification → `DesktopHost` → webview
 * message, with a click travelling back the other way.
 *
 * The webview half (rendering the tree, posting `modPanelEvent`) is covered by
 * `packages/webview/tests/webview/modPanel.test.tsx`; this file only asserts the
 * payloads that cross the process boundary.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  REALHOST_HOME,
  assertNoUnexpectedRejections,
  clearFakeModelEndpoint,
  createRealHost,
  resetRealHostState,
  startFakeModelServer,
  useFakeModelEndpoint,
  type FakeModelServer,
  type RealHost,
} from "./realHostHarness";

// `webviewReady` (the path this suite uses to simulate a rebuilt renderer) also
// fires the once-per-launch update check, which in a real install talks to the
// codechat feed. That is Electron shell business — stubbed here like the rest of
// the shell — and on a machine without that route the request just sits on a
// network timeout, making the suite slow and noisy.
vi.mock("electron-updater", () => ({
  autoUpdater: {
    checkForUpdates: async () => null,
    downloadUpdate: async () => [],
    setFeedURL: () => {},
    quitAndInstall: () => {},
    on: () => {},
    autoDownload: true,
  },
}));

let ctx: RealHost;
let model: FakeModelServer;
let dirA: string;

/**
 * Install a local plugin whose only capability is a TSX panel. It is written the
 * way a plugin author would write it — `import ... from "wave-agent-sdk/mods"`,
 * no `__wave`, no `require` — so this also covers the compiler pragma wiring and
 * the sandbox's `wave-agent-sdk/mods` entry in a real process.
 */
function installModPlugin(): void {
  const root = path.join(REALHOST_HOME, ".wave", "plugins", "todo-demo");
  fs.mkdirSync(path.join(root, ".wave-plugin"), { recursive: true });
  fs.mkdirSync(path.join(root, "mods"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".wave-plugin", "plugin.json"),
    // `name` + `description` are what `PluginLoader.validateManifest` requires;
    // a manifest missing either fails the load with only a cli.log line, which
    // is invisible from the host — the mod would silently never appear.
    JSON.stringify(
      { name: "todo-demo", version: "0.1.0", description: "待办面板示例" },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(root, "mods", "panel.tsx"),
    `
import { Box, Text, Button } from "wave-agent-sdk/mods";

export function register($, on) {
  on("session.start", () => {
    $.ui.open({ id: "p1", title: "待办" });
  });
  on("ui.render", () => (
    <Box flexDirection="column" gap={2}>
      <Text bold>点击 {$.state.get("n") ?? 0} 次</Text>
      <Button
        key="inc"
        label="+1"
        onPress={() => {
          $.state.set("n", ($.state.get("n") ?? 0) + 1);
          $.ui.invalidate("p1");
        }}
      />
    </Box>
  ));
}
`,
  );
  // Two records make the plugin visible to `PluginManager.loadInstalledPlugins`,
  // and both are needed:
  //  - `installed_plugins.json` is the only source it scans. A directory merely
  //    dropped into `~/.wave/plugins/` is not in it, so it would be loaded by
  //    nobody (a `--plugin-dir` would work too, but the host does not forward
  //    one — agents get `AgentOptions.plugins` only).
  //  - `enabledPlugins` is keyed `<name>@<marketplace>`; a bare `"todo-demo"`
  //    key matches nothing (`[[pluginId]] !== true` → skip).
  fs.writeFileSync(
    path.join(REALHOST_HOME, ".wave", "plugins", "installed_plugins.json"),
    JSON.stringify(
      {
        plugins: [
          {
            name: "todo-demo",
            marketplace: "local",
            version: "0.1.0",
            cachePath: root,
          },
        ],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(REALHOST_HOME, ".wave", "settings.json"),
    JSON.stringify({ enabledPlugins: { "todo-demo@local": true } }, null, 2),
  );
}

beforeEach(async () => {
  const dirs = resetRealHostState();
  dirA = dirs.dirA;
  installModPlugin();
  model = await startFakeModelServer();
  model.reply("回复：OK");
  useFakeModelEndpoint(model.baseURL);
  ctx = createRealHost();
});

afterEach(async () => {
  await ctx.close();
  await model.close();
  clearFakeModelEndpoint();
  assertNoUnexpectedRejections();
});

/** `desktopReady` → pick a workdir → the CLI child creates the real session. */
async function openProject(dir: string): Promise<void> {
  await ctx.host.handleWebviewMessage({ command: "desktopReady" });
  await ctx.host.handleWebviewMessage({
    command: "desktopSelectRecentWorkdir",
    path: dir,
    host: "local",
  });
  await ctx.waitFor("setInitialState");
}

/**
 * Concatenated text of a panel tree. Children are kept as they were written —
 * `<Text>点击 {n} 次</Text>` arrives as `["点击 ", "0", " 次"]` — so a substring
 * assertion on the serialized tree would never match the sentence.
 */
function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object") {
    return textOf((node as { children?: unknown }).children);
  }
  return node === null || node === undefined ? "" : String(node);
}

type RenderFrame = Record<string, unknown> & {
  tabId: string;
  revision: number;
  tree: { type: string; children: Array<{ children?: unknown[] }> };
  error?: string;
};

/**
 * What the webview does on a `stale` update: ask for this pane's tree and wait
 * for the reply. The tree never rides on the update itself.
 */
async function renderPanel(
  paneId: string,
  mod: { modId: string; paneId: string },
): Promise<RenderFrame> {
  const tabId = `mod:${mod.modId}:${mod.paneId}`;
  await ctx.host.handleWebviewMessage({
    command: "modPanelRender",
    paneId,
    payload: { modId: mod.modId, paneId: mod.paneId },
  });
  return (await ctx.waitFor("desktopModPanelRender", {
    timeout: 30_000,
    predicate: (m) => m.tabId === tabId && m.tree != null,
  })) as unknown as RenderFrame;
}

describe("real host · plugin mods", () => {
  it("mod 的 TSX 面板由 surface 拉取经 stdio 拿到，点击能回到 mod", async () => {
    await openProject(dirA);

    // `session.start` 里 `$.ui.open` → 一条**元信息**（`stale`，不带树）。面板
    // 是 CLI 侧编译 + 沙箱执行出来的，所以这条消息证明：插件被发现 → TSX 编译
    // 成功 → 钩子跑通 → 通知穿过 stdio 到了宿主。树本身还要拉一次。
    const first = await ctx.waitFor<{
      paneId: string;
      payload: {
        modId: string;
        paneId: string;
        title: string;
        revision: number;
        stale?: boolean;
        error?: string;
      };
    }>("desktopModPanelUpdate", { timeout: 60_000 });

    expect(first.payload).toMatchObject({
      modId: "todo-demo:panel",
      paneId: "p1",
      title: "待办",
      stale: true,
    });
    expect(first.payload).not.toHaveProperty("tree");

    // webview 收到 stale 后发的就是这条；宿主转成 RPC，CLI 现跑一次 `ui.render`。
    const tree = await renderPanel(first.paneId, first.payload);
    expect(tree.revision).toBe(1);
    expect(tree.error).toBeUndefined();
    expect(tree.tree.type).toBe("Box");
    expect(textOf(tree.tree)).toContain("点击 0 次");

    // 点一下：webview 侧就是发这条命令，宿主把它转成 RPC 交给 mod。先清掉已记录
    // 的消息，否则下面的等待会立刻匹配到刚才那帧。
    ctx.clear();
    await ctx.host.handleWebviewMessage({
      command: "modPanelEvent",
      paneId: first.paneId,
      payload: {
        modId: first.payload.modId,
        paneId: first.payload.paneId,
        key: "inc",
        kind: "press",
      },
    });

    // 交互只让这一帧过期（100ms 合并后一条 stale），内容得再拉一次。
    await ctx.waitFor("desktopModPanelUpdate", {
      timeout: 30_000,
      predicate: (m) => m.payload.stale === true,
    });
    const second = await renderPanel(first.paneId, first.payload);
    expect(second.revision).toBe(2);
    expect(textOf(second.tree)).toContain("点击 1 次");
  }, 120_000);

  it("webview 重建后宿主重放已有面板（webviewReady 之后）", async () => {
    await openProject(dirA);
    await ctx.waitFor("desktopModPanelUpdate", { timeout: 60_000 });

    // 重新握手 = 渲染进程重建：之前推送的元信息不会被重发（`webviewReady` →
    // `pushInitialState` 只重推 pane 状态），宿主必须顺手把已有面板一起回放，
    // 否则用户的 mod tab 全消失 —— `getModPanels` 那条旁路就是为这个存在的。
    ctx.clear();
    await ctx.host.handleWebviewMessage({ command: "webviewReady" });

    const replayed = await ctx.waitFor<{ payload: { modId: string } }>(
      "desktopModPanelUpdate",
      { timeout: 30_000 },
    );
    expect(replayed.payload.modId).toBe("todo-demo:panel");
    // 新 surface 手里一帧都没有：回放的元信息必须标过期，否则 tab 恢复出来
    // 是个永远空着的面板。
    expect(replayed.payload).toMatchObject({ stale: true });
  }, 120_000);
});

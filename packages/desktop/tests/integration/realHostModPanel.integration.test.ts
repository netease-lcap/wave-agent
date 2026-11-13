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
      <Button
        key="remote"
        label="遥控"
        onPress={async () => {
          // 外部进程代 mod 说话（mod 自己没有网络能力），读完再把 prompt 投进
          // 本会话 —— spec「外部进程」「把 prompt 送进对话」的最小闭环。
          for await (const chunk of $.process.spawn({
            argv: [${JSON.stringify(process.execPath)}, "-e",
              "console.log(JSON.stringify({ text: '来自远端服务' }))"],
          })) {
            const line = chunk.text.trim();
            if (line) await $.prompt.submit({ text: JSON.parse(line).text, asUser: true });
          }
        }}
      />
    </Box>
  ));
}
`,
  );
  // 第二个 mod：输入框周围那三样「不属于任何 pane」的输出（spec「状态带、状态行
  // 与提示」）。状态行与提示在 `session.start` 里就推；带要等 surface 来拉。
  fs.writeFileSync(
    path.join(root, "mods", "status.tsx"),
    `
import { Box, Text, Button } from "wave-agent-sdk/mods";

export function register($, on) {
  on("session.start", () => {
    $.ui.status("准备就绪");
  });
  on("ui.render", (e) => {
    if (e.component !== "AbovePrompt") return undefined;
    return (
      <Box flexDirection="column" gap={2}>
        <Text>带 {$.state.get("v") ?? 0}</Text>
        <Button
          key="ping"
          label="提示"
          onPress={() => $.ui.toast("已连接 1 个设备", 3000)}
        />
      </Box>
    );
  });
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

  it("面板按钮起的子进程把 prompt 投进会话（外部事件驱动对话）", async () => {
    await openProject(dirA);
    const panel = await ctx.waitFor<{
      paneId: string;
      payload: { modId: string; paneId: string };
    }>("desktopModPanelUpdate", { timeout: 60_000 });

    // 先拉一帧：处理函数表是在 `ui.render` 跑 `h()` 时登记的，没渲染过就点不到。
    await renderPanel(panel.paneId, panel.payload);
    ctx.clear();
    await ctx.host.handleWebviewMessage({
      command: "modPanelEvent",
      paneId: panel.paneId,
      payload: {
        modId: panel.payload.modId,
        paneId: panel.payload.paneId,
        key: "remote",
        kind: "press",
      },
    });

    // 判据是**模型收到了这句话**：mod 从子进程的 stdout 读到它、再以用户身份
    // 投进会话，会话于是新开一轮（这条链路的终点就是一次真实的模型请求）。
    await vi.waitFor(
      () => expect(model.sawRequest("来自远端服务")).toBe(true),
      { timeout: 60_000 },
    );
  }, 120_000);

  it("状态行、提示与带穿过 stdio 到达宿主的 webview 消息", async () => {
    await openProject(dirA);

    // 状态行在 `session.start` 里贴出。那一条推送**比客户端注册会话更早**，会被
    // router 按 v1 语义丢掉 —— 它能在宿主上看到，靠的是重放：surface 挂上来要面板
    // 快照（`getModPanels`）时一并补回来，否则「启动时贴一行、一直挂着」永远看不到。
    const status = await ctx.waitFor<{
      paneId: string;
      payload: { modId: string; plugin: string; text: string | null };
    }>("desktopModStatus", { timeout: 60_000 });
    expect(status.payload).toMatchObject({
      modId: "todo-demo:status",
      plugin: "todo-demo",
      text: "准备就绪",
    });

    // 带是**拉取式**的：webview 发 `modBandRender`，宿主转成 RPC，CLI 现跑每个注
    // 册了 `ui.render` 的 mod（这个插件里两个 mod 都注册了，所以结果是两条）。
    ctx.clear();
    await ctx.host.handleWebviewMessage({
      command: "modBandRender",
      paneId: status.paneId,
    });
    const band = await ctx.waitFor<{
      paneId: string;
      bands: Array<{
        modId: string;
        plugin: string;
        revision: number;
        tree: unknown;
      }>;
    }>("desktopModBand", {
      timeout: 30_000,
      predicate: (m) => Array.isArray(m.bands),
    });
    const mine = band.bands.find((b) => b.modId === "todo-demo:status");
    expect(mine).toMatchObject({ plugin: "todo-demo", revision: 1 });
    // `e.component === "AbovePrompt"` 就在这条带里成立 —— 站点维度真的传到了
    // mod（`ui.render` 收到的是带的那一帧，不是面板那帧）。
    expect(textOf(mine?.tree)).toContain("带 0");

    // 带里的按钮：webview 发 `modPanelEvent` 时 `paneId` 用站点自己的固定值
    // （`above-prompt`，不是任何 pane 的 id），mod 的回调照样能收到，`$.ui.toast`
    // 也就从 CLI 进程穿回来。
    await ctx.host.handleWebviewMessage({
      command: "modPanelEvent",
      paneId: band.paneId,
      payload: {
        modId: "todo-demo:status",
        paneId: "above-prompt",
        key: "ping",
        kind: "press",
      },
    });
    const toast = await ctx.waitFor<{
      payload: { plugin: string; text: string; timeoutMs: number };
    }>("desktopModToast", { timeout: 30_000 });
    expect(toast.payload).toMatchObject({
      plugin: "todo-demo",
      text: "已连接 1 个设备",
      timeoutMs: 3000,
    });
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

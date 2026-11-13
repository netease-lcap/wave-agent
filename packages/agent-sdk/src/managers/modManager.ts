import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { compileMods, type ModSourceFile } from "../mods/compile.js";
import {
  ModRuntime,
  errorMessage,
  type CompiledModule,
} from "../mods/runtime.js";
import { validateModTree } from "../mods/validate.js";
import {
  MOD_LIMITS,
  type ModPanelEventPayload,
  type ModPanelTree,
  type ModPanelUpdatePayload,
  type PluginMod,
} from "../types/mods.js";
import type { Plugin } from "../types/plugins.js";
import { atomicWriteFileSync } from "../utils/atomicWrite.js";
import { getEsbuild } from "../utils/esbuild.js";
import { logger } from "../utils/globalLogger.js";

/**
 * 插件 MODS 的宿主侧编排：加载 → 编译 → 沙箱实例 → 事件 → 面板快照。
 *
 * ## 分层
 *
 * 编译与执行都在 agent 进程内（spec「架构约束」），对外只暴露两件事：
 *
 * - {@link onPanelUpdate}：面板内容的全量快照（`revision` 递增，webview 丢
 *   弃更小的值）。发全量而不是增量，是因为一棵树最多 2000 节点、几十 KB，
 *   而增量协议要给每个元素编 stable id —— 一期不值得。
 * - {@link handlePanelEvent}：webview 回传的点击/输入/关闭。
 *
 * ## 面板状态归属
 *
 * 面板活在**会话**里，不活在 mod 进程里：mod 调 `$.ui.open()` 只是登记一个
 * 面板，真正的内容由 `ui.render` 钩子现算。所以关掉面板的 tab 不需要通知
 * mod 的渲染路径，只需要补一次 `ui.close`（mod 可以据此清自己的 state）。
 */
export interface ModManagerOptions {
  sessionId: string;
  /** 面板快照的出口；stdio 层把它转成 `modPanelUpdate` 通知。 */
  onPanelUpdate: (payload: ModPanelUpdatePayload) => void;
  /** 覆盖 store 根目录（测试用）。 */
  storeRoot?: string;
}

interface PaneState {
  modId: string;
  paneId: string;
  title: string;
  revision: number;
  tree: ModPanelTree | null;
  error?: string;
  /** 上一次真正发出去的时间，用于 100ms 合并。 */
  lastRenderAt: number;
  pending?: NodeJS.Timeout;
}

interface LoadedMod {
  mod: PluginMod;
  runtime?: ModRuntime;
  /** 加载/编译失败时的摘要（面板上显示）。 */
  error?: string;
}

/** 该插件持久化的 KV（跨会话），按插件名分文件。 */
function storePath(root: string, pluginName: string): string {
  return path.join(root, `${pluginName}.json`);
}

export class ModManager {
  private readonly mods = new Map<string, LoadedMod>();
  private readonly panes = new Map<string, PaneState>();
  private readonly state = new Map<string, Map<string, unknown>>();
  private readonly storeRoot: string;
  private disposed = false;

  constructor(private readonly options: ModManagerOptions) {
    this.storeRoot =
      options.storeRoot ?? path.join(homedir(), ".wave", "plugin-mods");
  }

  /**
   * 编译并实例化所有插件里的 mod。
   *
   * 一个插件下的 mod 共享一次编译（`import "./shared"` 要能解析到同目录的
   * 兄弟文件），但每个 mod 一个沙箱实例。
   */
  async loadFromPlugins(plugins: Plugin[]): Promise<void> {
    for (const plugin of plugins) {
      const modFiles = plugin.mods ?? [];
      if (modFiles.length === 0) continue;

      const esbuild = getEsbuild();
      if (!esbuild) {
        for (const mod of modFiles) {
          this.mods.set(mod.id, {
            mod,
            error: "TSX mod 需要 esbuild（运行时依赖尚未安装）",
          });
        }
        logger.warn(
          `[Wave] 插件 ${plugin.name} 带 mod，但 esbuild 不可用，已跳过`,
        );
        continue;
      }

      const sources: ModSourceFile[] = [];
      for (const mod of modFiles) {
        try {
          sources.push({
            path: mod.path,
            source: fs.readFileSync(mod.path, "utf-8"),
          });
        } catch (error) {
          this.mods.set(mod.id, {
            mod,
            error: `读取失败：${errorMessage(error)}`,
          });
        }
      }

      const outcomes = await compileMods(esbuild, sources);
      // 该插件全部文件的编译产物：每个 mod 的沙箱都能解析到兄弟文件。
      const compiled: CompiledModule[] = [];
      for (const [filePath, outcome] of outcomes) {
        if (outcome.code !== undefined) {
          compiled.push({ path: filePath, code: outcome.code });
        }
      }

      for (const mod of modFiles) {
        if (this.mods.has(mod.id)) continue;
        const outcome = outcomes.get(mod.path);
        if (!outcome?.code) {
          this.mods.set(mod.id, {
            mod,
            error: outcome?.error ?? "编译失败",
          });
          logger.warn(
            `[Wave] mod 编译失败：${mod.id}\n${outcome?.error ?? ""}`,
          );
          continue;
        }
        try {
          const runtime = new ModRuntime(
            {
              pluginName: plugin.name,
              pluginRoot: plugin.path,
              openPane: (paneId, title) => this.openPane(mod.id, paneId, title),
              closePane: (paneId) => this.closePane(mod.id, paneId, "plugin"),
              listPanes: () => this.listPanes(mod.id),
              invalidate: (paneId) => this.invalidate(mod.id, paneId),
              stateGet: (key) => this.stateFor(mod.id).get(key),
              stateSet: (key, value) => {
                this.stateFor(mod.id).set(key, value);
              },
              storeGet: (key) => this.readStore(plugin.name)[key],
              storeSet: (key, value) => {
                const store = this.readStore(plugin.name);
                store[key] = value;
                this.writeStore(plugin.name, store);
              },
              storeDelete: (key) => {
                const store = this.readStore(plugin.name);
                delete store[key];
                this.writeStore(plugin.name, store);
              },
              storeKeys: () => Object.keys(this.readStore(plugin.name)),
            },
            mod.path,
            compiled,
          );
          const registered = await runtime.load();
          if (!registered) {
            // 被 import 的共享模块，不是面板入口。
            logger.debug(
              `[Wave] ${mod.id} 没有导出 register，作为依赖模块保留`,
            );
            continue;
          }
          this.mods.set(mod.id, { mod, runtime });
          logger.info(`[Wave] 已加载 mod ${mod.id}`);
        } catch (error) {
          const message = errorMessage(error);
          this.mods.set(mod.id, { mod, error: message });
          logger.warn(`[Wave] mod 加载失败：${mod.id}：${message}`);
        }
      }
    }
  }

  /** 触发所有 mod 的 `session.start`。 */
  async startSession(): Promise<void> {
    for (const [modId, loaded] of this.mods) {
      if (!loaded.runtime) {
        // 加载或编译失败：开一个只承载错误摘要的面板。否则用户看到的是「面板
        // 没出现」，而失败的原文只在日志里（spec「限额」「加载纪律」都要求错误
        // 可见，不静默丢弃）。
        if (loaded.error) this.openErrorPane(loaded.mod, loaded.error);
        continue;
      }
      const result = await loaded.runtime.callHook("session.start", {
        sessionId: this.options.sessionId,
        modId,
      });
      if (!result.ok) {
        logger.warn(`[Wave] ${modId} 的 session.start 失败：${result.error}`);
      } else if (this.listPanes(modId).length === 0) {
        // 只注册 ui.render 不构成「要画」的请求：面板得由 mod 自己 open。
        logger.debug(
          `[Wave] ${modId} 未申请面板（没有调用 $.ui.open），本会话不显示`,
        );
      }
    }
  }

  /** 当前所有面板的快照（`initialize` / 会话恢复时补发）。 */
  paneSnapshots(): ModPanelUpdatePayload[] {
    return [...this.panes.values()].map((pane) => this.payloadOf(pane));
  }

  /** webview 回传的交互。 */
  async handlePanelEvent(payload: ModPanelEventPayload): Promise<void> {
    if (this.disposed) return;
    const key = `${payload.modId}\u0000${payload.paneId}`;
    const loaded = this.mods.get(payload.modId);
    if (!loaded) {
      logger.warn(`[Wave] 收到未知 mod 的事件：${payload.modId}`);
      return;
    }
    if (loaded.error || !loaded.runtime) {
      // 面板本来就显示着错误态，交互无处可去。
      return;
    }
    if (payload.kind === "close") {
      this.closePane(payload.modId, payload.paneId, payload.origin ?? "person");
      return;
    }
    if (!payload.key) {
      logger.warn(`[Wave] ${payload.modId} 的 ${payload.kind} 事件缺少 key`);
      return;
    }
    try {
      const handled = await loaded.runtime.dispatch(
        payload.kind,
        payload.key,
        payload.value,
      );
      if (!handled) {
        logger.debug(
          `[Wave] ${payload.modId} 没有处理 ${payload.kind}「${payload.key}」的回调`,
        );
      }
    } catch (error) {
      const message = errorMessage(error);
      logger.warn(
        `[Wave] ${payload.modId} 处理 ${payload.kind} 失败：${message}`,
      );
      const pane = this.panes.get(key);
      if (pane) this.publish({ ...pane, error: message }, true);
    }
  }

  /** 会话结束 / agent 销毁：通知每个面板 `ui.close(origin)` 并进入终态。 */
  async dispose(origin: "plugin" | "unload" = "unload"): Promise<void> {
    this.disposed = true;
    await this.closeAllPanes(origin);
  }

  /**
   * 插件热重载（`/reload-plugins`）：关掉旧面板、丢掉旧 mod 与 state，再用新的
   * 插件列表重建。
   *
   * 与 {@link dispose} 分开是因为 `disposed` 是**终态**（agent 已经销毁，之后
   * 一律静默）；重载之后这个 manager 还得继续用，不能留在终态里 —— 早期版本
   * 直接在 reload 路径上调 `dispose("plugin")`，结果重载一次 mod 就永久不生效。
   */
  async reload(plugins: Plugin[]): Promise<void> {
    await this.closeAllPanes("plugin");
    this.mods.clear();
    this.state.clear();
    await this.loadFromPlugins(plugins);
    await this.startSession();
  }

  private async closeAllPanes(origin: "plugin" | "unload"): Promise<void> {
    const closing = [...this.panes.values()];
    for (const pane of closing) {
      if (pane.pending) clearTimeout(pane.pending);
    }
    this.panes.clear();
    // 先让界面把 tab 关掉（`closed: true`），再通知 mod —— 反过来的话 mod 的
    // `ui.close` 钩子里还可能再 invalidate 一次，那个面板已经不存在了。
    for (const pane of closing) {
      this.options.onPanelUpdate({
        ...this.payloadOf(pane),
        tree: null,
        closed: true,
      });
    }
    for (const pane of closing) {
      await this.emitClose(pane, origin);
    }
  }

  private stateFor(modId: string): Map<string, unknown> {
    let map = this.state.get(modId);
    if (!map) {
      map = new Map();
      this.state.set(modId, map);
    }
    return map;
  }

  private readStore(pluginName: string): Record<string, string> {
    try {
      const raw = fs.readFileSync(
        storePath(this.storeRoot, pluginName),
        "utf-8",
      );
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
      return {};
    } catch {
      return {};
    }
  }

  private writeStore(pluginName: string, store: Record<string, string>): void {
    try {
      fs.mkdirSync(this.storeRoot, { recursive: true });
      atomicWriteFileSync(
        storePath(this.storeRoot, pluginName),
        `${JSON.stringify(store, null, 2)}\n`,
      );
    } catch (error) {
      logger.warn(
        `[Wave] 写入 ${pluginName} 的 mod store 失败：${errorMessage(error)}`,
      );
    }
  }

  private listPanes(modId: string): string[] {
    return [...this.panes.values()]
      .filter((pane) => pane.modId === modId)
      .map((pane) => pane.paneId);
  }

  /**
   * 加载失败的 mod 也占一个面板：内容是一行错误摘要。
   *
   * `paneId` 固定为 `error` —— 一个 mod 只有一个「加载失败」入口，不需要多个
   * tab。用户关掉它之后不会再自动弹（`startSession` 只跑一次）。
   */
  private openErrorPane(mod: PluginMod, error: string): void {
    const pane: PaneState = {
      modId: mod.id,
      paneId: "error",
      title: mod.name,
      revision: 0,
      tree: null,
      error,
      lastRenderAt: Date.now(),
    };
    this.panes.set(`${mod.id}\u0000error`, pane);
    this.publish(pane, true);
  }

  private openPane(modId: string, paneId: string, title: string): void {
    if (this.disposed) return;
    const key = `${modId}\u0000${paneId}`;
    const existing = this.panes.get(key);
    const pane: PaneState = existing ?? {
      modId,
      paneId,
      title,
      revision: 0,
      tree: null,
      lastRenderAt: 0,
    };
    pane.title = title;
    this.panes.set(key, pane);
    void this.render(pane);
  }

  private closePane(
    modId: string,
    paneId: string,
    origin: "person" | "plugin" | "unload",
  ): void {
    const key = `${modId}\u0000${paneId}`;
    const pane = this.panes.get(key);
    if (!pane) return;
    if (pane.pending) clearTimeout(pane.pending);
    this.panes.delete(key);
    void this.emitClose(pane, origin);
    this.options.onPanelUpdate({
      ...this.payloadOf(pane),
      tree: null,
      closed: true,
    });
  }

  private async emitClose(
    pane: PaneState,
    origin: "person" | "plugin" | "unload",
  ): Promise<void> {
    const loaded = this.mods.get(pane.modId);
    if (!loaded?.runtime) return;
    const result = await loaded.runtime.callHook("ui.close", {
      modId: pane.modId,
      paneId: pane.paneId,
      origin: { kind: origin },
    });
    if (!result.ok) {
      logger.warn(`[Wave] ${pane.modId} 的 ui.close 失败：${result.error}`);
    }
  }

  /**
   * 请求重画：100ms 内的多次调用合并成一次（spec「限额」）。
   *
   * mod 在一次交互里改三个 state 再 invalidate 一次是常态，但如果它在一个
   * 循环里 invalidate，合并能避免把 stdio 打爆。
   */
  private invalidate(modId: string, paneId: string): void {
    const key = `${modId}\u0000${paneId}`;
    const pane = this.panes.get(key);
    if (!pane) return;
    if (pane.pending) return;
    const wait = Math.max(
      0,
      MOD_LIMITS.invalidateIntervalMs - (Date.now() - pane.lastRenderAt),
    );
    pane.pending = setTimeout(() => {
      pane.pending = undefined;
      void this.render(pane);
    }, wait);
    pane.pending.unref?.();
  }

  /** 跑 `ui.render` 并发布结果。 */
  private async render(pane: PaneState): Promise<void> {
    if (this.disposed) return;
    pane.lastRenderAt = Date.now();
    const loaded = this.mods.get(pane.modId);
    if (!loaded) return;
    if (loaded.error || !loaded.runtime) {
      this.publish({ ...pane, error: loaded.error ?? "mod 未加载" }, true);
      return;
    }
    const result = await loaded.runtime.callHook("ui.render", {
      modId: pane.modId,
      paneId: pane.paneId,
      component: "Pane",
    });
    if (!result.ok) {
      this.publish({ ...pane, error: result.error }, true);
      return;
    }
    if (result.value === undefined) {
      // 钩子没注册或明确返回 undefined：面板留空而不是报错。
      this.publish({ ...pane, tree: null, error: undefined }, true);
      return;
    }
    const validated = validateModTree(result.value);
    if (!validated.ok) {
      this.publish({ ...pane, error: validated.error }, true);
      return;
    }
    // 成功这一帧必须**清掉**上一次的错误：交互钩子抛的错也落在 `error` 上
    // （见 `handlePanelEvent`），不清的话用户误点一次报错按钮，面板就永久停在
    // 错误页 —— 之后的 invalidate 再成功，`error` 还压在树上。
    this.publish({ ...pane, tree: validated.tree, error: undefined }, true);
  }

  private publish(pane: PaneState, bumpRevision: boolean): void {
    if (this.disposed) return;
    const next: PaneState = bumpRevision
      ? { ...pane, revision: pane.revision + 1 }
      : pane;
    const current = this.panes.get(`${pane.modId}\u0000${pane.paneId}`);
    if (current) {
      current.revision = next.revision;
      current.tree = next.tree;
      current.error = next.error;
      current.title = next.title;
    }
    this.options.onPanelUpdate(this.payloadOf(next));
  }

  private payloadOf(pane: PaneState): ModPanelUpdatePayload {
    return {
      sessionId: this.options.sessionId,
      modId: pane.modId,
      paneId: pane.paneId,
      title: pane.title,
      revision: pane.revision,
      tree: pane.tree,
      ...(pane.error ? { error: pane.error } : {}),
    };
  }
}

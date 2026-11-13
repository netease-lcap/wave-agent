import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { compileMods, type ModSourceFile } from "../mods/compile.js";
import { ModProcessManager } from "../mods/processes.js";
import {
  ModRuntime,
  errorMessage,
  isThenable,
  type CompiledModule,
} from "../mods/runtime.js";
import { validateModTree } from "../mods/validate.js";
import {
  MOD_LIMITS,
  type ModPanelEventPayload,
  type ModPanelRenderResult,
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
 * - {@link onPanelUpdate}：面板的**元信息**（新面板 / 过期 / 关闭 / 错误），
 *   **不带树**。树永远由 surface 拉取（{@link renderPane}，spec「架构约束」）：
 *   surface 收到 `stale` 后自己来要，宿主不主动推树，也不缓存一份给别的
 *   surface —— 每次请求都重新跑 `ui.render`。
 * - {@link handlePanelEvent}：webview 回传的点击/输入/关闭。
 *
 * ## 面板状态归属
 *
 * 面板活在**会话**里，不活在 mod 进程里：mod 调 `$.ui.open()` 只是登记一个
 * 面板，真正的内容由 `ui.render` 钩子现算。所以关掉面板的 tab 不需要通知
 * mod 的渲染路径 —— mod 也**收不到**任何「面板被关了」的事件（spec「事件」：
 * 一期只有 `session.start` / `ui.render`，与 Claude Code 的交集）。宿主在这里
 * 把该 pane 的快照、回调表与定时器一并丢掉就完了。
 */
export interface ModManagerOptions {
  sessionId: string;
  /** 面板快照的出口；stdio 层把它转成 `modPanelUpdate` 通知。 */
  onPanelUpdate: (payload: ModPanelUpdatePayload) => void;
  /**
   * `$.process.spawn` 的默认 cwd。
   *
   * 传 getter 而不是字符串：口径是「会动」的那个工作目录（容器 token
   * `CurrentWorkdir`，与 Bash 工具的 spawn cwd 一致），会话里 `cd` 过之后起的
   * 脚本该落在新目录；挂在会话起点或工作区根上都会指错。
   */
  workdir?: () => string;
  /** 覆盖 store 根目录（测试用）。 */
  storeRoot?: string;
}

interface PaneState {
  modId: string;
  paneId: string;
  title: string;
  revision: number;
  /** 上一帧**成功**渲染的树；渲染失败时回给 surface 的也是它。 */
  tree: ModPanelTree | null;
  error?: string;
  /** 上一次发出 stale 通知的时间，用于 100ms 合并（spec「限额」）。 */
  lastRenderAt: number;
  pending?: NodeJS.Timeout;
}

interface LoadedMod {
  mod: PluginMod;
  runtime?: ModRuntime;
  /** 加载/编译失败时的摘要（面板上显示）。 */
  error?: string;
}

/**
 * 一个 `$.clock` 定时器。
 *
 * `running` 是「上一拍的回调还没结束」：`every` 的节拍固定（fire 时就把下一拍
 * 排上），所以回调慢于间隔时会出现「上一拍还在跑、下一拍又到」—— 这时跳过这一
 * 拍而不是排队或并发（spec「定时器」）。
 */
interface ClockTimer {
  modId: string;
  kind: "after" | "every";
  delayMs: number;
  run: () => unknown;
  timer?: NodeJS.Timeout;
  running: boolean;
  cancelled: boolean;
}

/** 该插件持久化的 KV（跨会话），按插件名分文件。 */
function storePath(root: string, pluginName: string): string {
  return path.join(root, `${pluginName}.json`);
}

export class ModManager {
  private readonly mods = new Map<string, LoadedMod>();
  private readonly panes = new Map<string, PaneState>();
  private readonly state = new Map<string, Map<string, unknown>>();
  /** modId → 它名下还活着的定时器。 */
  private readonly timers = new Map<string, Set<ClockTimer>>();
  private readonly processes: ModProcessManager;
  private readonly storeRoot: string;
  /**
   * `$.prompt.submit` 的出口。
   *
   * mod 把 prompt 投进**本会话**，而「投进会话」这件事只有 `Agent` 知道怎么做
   * （走 `Agent.sendMessage`：忙时入队、`/clear` 之类的立即命令直通）。所以由
   * `Agent` 在构造最后接进来，而不是让这个 manager 反过来持有 agent。
   */
  private promptSubmitter?: (text: string) => Promise<void>;
  private disposed = false;

  constructor(private readonly options: ModManagerOptions) {
    this.storeRoot =
      options.storeRoot ?? path.join(homedir(), ".wave", "plugin-mods");
    // cwd 现取现用：`cd` 之后起的脚本落在新目录。
    this.processes = new ModProcessManager(
      () => options.workdir?.() ?? process.cwd(),
    );
  }

  /** 接上 prompt 投递通道（见 `promptSubmitter`）。 */
  setPromptSubmitter(fn: (text: string) => Promise<void>): void {
    this.promptSubmitter = fn;
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
              openPane: (paneId, title) => this.openPane(mod.id, paneId, title),
              closePane: (paneId) => this.closePane(mod.id, paneId),
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
              startTimer: (kind, ms, fn) =>
                this.startTimer(mod.id, kind, ms, fn),
              spawnProcess: (options) => this.processes.spawn(mod.id, options),
              runProcess: (argv, runOptions) =>
                this.processes.run(mod.id, argv, runOptions),
              // `$.fs` 的相对路径基准与 `spawn` 的 cwd 同一口径：现取现用，
              // `cd` 过之后读的相对路径跟着落在新目录。
              workdir: () => this.options.workdir?.() ?? process.cwd(),
              submitPrompt: (text) => this.submitPrompt(mod.id, text),
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

  /**
   * 当前所有面板的元信息（`initialize` / 会话恢复 / webview 重建时补发）。
   *
   * 一律带 `stale: true`：接上来的这个 surface 手里一帧都没有，必须自己去拉
   * —— 宿主不缓存树，没法替它回放上一次渲染的内容。
   */
  paneSnapshots(): ModPanelUpdatePayload[] {
    return [...this.panes.values()].map((pane) =>
      this.payloadOf(pane, { stale: true }),
    );
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
      // mod 收不到这条（spec「事件」）：宿主丢掉 pane 快照就够了。
      this.closePane(payload.modId, payload.paneId);
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
      if (pane) this.publishUpdate(pane, { stale: true, error: message });
    }
  }

  /** 会话结束 / agent 销毁：关掉所有面板、撤销所有定时器与外部进程，进入终态。 */
  async dispose(): Promise<void> {
    this.cancelAllTimers();
    // 外部进程连同子进程树一起杀（spec「生命周期」）：留下的孤儿会一直跑，
    // 然后往一个已经不存在的会话里写东西。
    this.processes.dispose();
    // 先关面板再进终态：`closed: true` 是界面关掉 tab 的唯一信号，而
    // `publishUpdate` 在 `disposed` 之后一律静默。
    this.closeAllPanes();
    this.disposed = true;
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
    // 旧实例的定时器与进程必须先停：下面会丢掉 `mods`，它们的 `$` 还指向旧
    // runtime —— 留着的话这些回调/子进程会打到已经没人认领的旧实例上。
    this.cancelAllTimers();
    this.processes.killAll();
    this.closeAllPanes();
    this.mods.clear();
    this.state.clear();
    await this.loadFromPlugins(plugins);
    await this.startSession();
  }

  // ── 定时器（spec「定时器」） ────────────────────────────────

  private timersFor(modId: string): Set<ClockTimer> {
    let set = this.timers.get(modId);
    if (!set) {
      set = new Set();
      this.timers.set(modId, set);
    }
    return set;
  }

  /**
   * 登记一个定时器。
   *
   * 间隔下限与数量上限都在这里强制（spec「限额」）：下限**夹取**而不报错
   * （`0` / 负值 / 非数字几乎一定是写错了，但没必要让整个面板变成错误态），
   * 上限则报错 —— 一个 mod 起了第 17 个定时器是设计问题，不该静默成功。
   */
  private startTimer(
    modId: string,
    kind: "after" | "every",
    ms: number,
    fn: () => unknown,
  ): { cancel(): void } {
    if (typeof fn !== "function") {
      throw new Error("$.clock 的回调必须是一个函数");
    }
    if (this.disposed) {
      // agent 已经销毁：给一个空句柄，别让 mod 的收尾代码再炸一次。
      return { cancel: () => {} };
    }
    const set = this.timersFor(modId);
    if (set.size >= MOD_LIMITS.maxTimersPerMod) {
      throw new Error(
        `定时器上限 ${MOD_LIMITS.maxTimersPerMod} 个（${modId}），先 cancel 掉不用的`,
      );
    }
    const delayMs = Number.isFinite(ms)
      ? Math.max(MOD_LIMITS.timerMinIntervalMs, Math.floor(ms))
      : MOD_LIMITS.timerMinIntervalMs;
    const timer: ClockTimer = {
      modId,
      kind,
      delayMs,
      run: fn,
      running: false,
      cancelled: false,
    };
    set.add(timer);
    this.schedule(timer);
    return { cancel: () => this.cancelTimer(timer) };
  }

  private schedule(timer: ClockTimer): void {
    if (timer.cancelled || this.disposed) return;
    timer.timer = setTimeout(() => this.fireTimer(timer), timer.delayMs);
    // 定时器不该把进程钉住：CLI 退出时 `unref` 掉，会话销毁时再显式 cancel。
    timer.timer.unref?.();
  }

  private fireTimer(timer: ClockTimer): void {
    timer.timer = undefined;
    if (timer.cancelled || this.disposed) return;
    if (timer.kind === "after") {
      // 一次性：先摘出登记表，回调里 cancel 也无妨。
      this.timersFor(timer.modId).delete(timer);
    }
    if (timer.running) {
      // 上一拍还没跑完 —— 跳过这一拍，节拍照旧（不排队、不并发）。
      logger.debug(`[Wave] ${timer.modId} 的定时器上一拍未结束，跳过这一拍`);
    } else {
      timer.running = true;
      const finish = () => {
        timer.running = false;
      };
      try {
        const result = timer.run();
        if (isThenable(result)) {
          void result.then(
            () => finish(),
            (error: unknown) => {
              this.reportTimerError(timer.modId, error);
              finish();
            },
          );
        } else {
          finish();
        }
      } catch (error) {
        this.reportTimerError(timer.modId, error);
        finish();
      }
    }
    // `every` 的下一拍在 fire 时就排好（固定节拍）；`after` 到此为止。
    if (timer.kind === "every") this.schedule(timer);
  }

  private cancelTimer(timer: ClockTimer): void {
    timer.cancelled = true;
    if (timer.timer) {
      clearTimeout(timer.timer);
      timer.timer = undefined;
    }
    this.timersFor(timer.modId).delete(timer);
  }

  /** 撤销所有定时器；给了 `modId` 就只撤那个 mod 的。 */
  private cancelAllTimers(modId?: string): void {
    if (modId === undefined) {
      for (const id of [...this.timers.keys()]) this.cancelAllTimers(id);
      this.timers.clear();
      return;
    }
    const set = this.timers.get(modId);
    if (!set) return;
    for (const timer of [...set]) this.cancelTimer(timer);
    this.timers.delete(modId);
  }

  // ── prompt 投递（spec「把 prompt 送进对话」） ────────────────

  /**
   * 把 mod 的一条 prompt 投进本会话。
   *
   * 语义就是用户自己发了一条：会话空闲时开新一轮，忙时按 `Agent.sendMessage`
   * 的既有规则入队。这里不自己做队列，也不做「用户按了 Esc 就丢掉」那种回执
   * ——多一套投递规则就多一种「消息去哪了」的解释。
   */
  private async submitPrompt(modId: string, text: string): Promise<void> {
    if (this.disposed) {
      throw new Error("会话已结束，不能再投递 prompt");
    }
    const submit = this.promptSubmitter;
    if (!submit) {
      throw new Error(
        "当前宿主没有接入 prompt 投递通道，$.prompt.submit 不可用",
      );
    }
    logger.info(`[Wave] ${modId} 把一条 prompt 投进了本会话`);
    await submit(text);
  }

  /**
   * 定时器回调抛错：记日志，并把错误摘要叠在该 mod 的每个面板上。
   *
   * 面板不是错误态换掉树，而是「错误条 + 上一帧照旧」（与元素回调抛错同一条
   * 路径）；下一拍如果成功渲染，摘要自动消失。定时器本身**不停**——一次抛错就
   * 让面板永远不刷新，比偶发错误更难查。
   */
  private reportTimerError(modId: string, error: unknown): void {
    const message = errorMessage(error);
    logger.warn(`[Wave] ${modId} 的定时器回调失败：${message}`);
    for (const pane of [...this.panes.values()]) {
      if (pane.modId === modId) {
        this.publishUpdate(pane, { stale: true, error: message });
      }
    }
  }

  private closeAllPanes(): void {
    const closing = [...this.panes.values()];
    for (const pane of closing) {
      if (pane.pending) clearTimeout(pane.pending);
    }
    this.panes.clear();
    // 只让界面把 tab 关掉（`closed: true`）；mod 收不到通知（spec「事件」）。
    for (const pane of closing) {
      this.publishUpdate(pane, { closed: true });
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
    this.publishUpdate(pane, { error });
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
    // 只登记 + 通知 surface 来要树，不在这里渲染（spec「架构约束」）。
    this.publishUpdate(pane, { stale: true });
  }

  private closePane(modId: string, paneId: string): void {
    const key = `${modId}\u0000${paneId}`;
    const pane = this.panes.get(key);
    if (!pane) return;
    if (pane.pending) clearTimeout(pane.pending);
    this.panes.delete(key);
    this.publishUpdate(pane, { closed: true });
  }

  /**
   * 标记过期：100ms 内的多次调用合并成一次 `stale` 通知（spec「限额」）。
   *
   * mod 在一次交互里改三个 state 再 invalidate 一次是常态，但如果它在一个
   * 循环里 invalidate，合并能避免把 stdio 打爆。这里**不渲染** —— 树由
   * surface 收到 stale 后自己来要（spec「架构约束」）。
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
      this.publishUpdate(pane, { stale: true });
    }, wait);
    pane.pending.unref?.();
  }

  /**
   * surface 来要树：跑一次 `ui.render` 并把结果回给它（spec「架构约束」）。
   *
   * 失败时返回**上一帧成功的树** + 错误摘要 —— 面板保留可点的内容，错误只
   * 叠在顶上；把整棵树换成一行错误文字会让面板一次性报废。
   */
  async renderPane(
    modId: string,
    paneId: string,
  ): Promise<ModPanelRenderResult> {
    const key = `${modId}\u0000${paneId}`;
    const pane = this.panes.get(key);
    if (this.disposed || !pane) {
      return { modId, paneId, revision: 0, tree: null, error: "面板已关闭" };
    }
    const loaded = this.mods.get(modId);
    if (!loaded) {
      return this.renderFailed(pane, "mod 未加载");
    }
    if (loaded.error || !loaded.runtime) {
      return this.renderFailed(pane, loaded.error ?? "mod 未加载");
    }
    const result = await loaded.runtime.callHook("ui.render", {
      modId: pane.modId,
      paneId: pane.paneId,
      // 站点两件套：`$.ui.resolve(e)` 靠它们判定返回哪张元素表。
      surface: "pane",
      component: "Pane",
    });
    if (!result.ok) {
      return this.renderFailed(pane, result.error);
    }
    if (result.value === undefined) {
      // 钩子没注册或明确返回 undefined：面板留空而不是报错。
      pane.tree = null;
      pane.error = undefined;
      pane.revision += 1;
      return { modId, paneId, revision: pane.revision, tree: null };
    }
    const validated = validateModTree(result.value);
    if (!validated.ok) {
      return this.renderFailed(pane, validated.error);
    }
    // 成功这一帧必须**清掉**上一次的错误：交互钩子抛的错也落在 `error` 上
    // （见 `handlePanelEvent`），不清的话用户误点一次报错按钮，面板就永久停在
    // 错误页 —— 之后的请求再成功，`error` 还压在树上。
    pane.tree = validated.tree;
    pane.error = undefined;
    pane.revision += 1;
    return { modId, paneId, revision: pane.revision, tree: validated.tree };
  }

  private renderFailed(pane: PaneState, error: string): ModPanelRenderResult {
    pane.error = error;
    return {
      modId: pane.modId,
      paneId: pane.paneId,
      revision: pane.revision,
      tree: pane.tree,
      error,
    };
  }

  private payloadOf(
    pane: PaneState,
    extra: { stale?: boolean; closed?: boolean } = {},
  ): ModPanelUpdatePayload {
    return {
      sessionId: this.options.sessionId,
      modId: pane.modId,
      paneId: pane.paneId,
      title: pane.title,
      revision: pane.revision,
      ...(extra.stale ? { stale: true } : {}),
      ...(extra.closed ? { closed: true } : {}),
      ...(pane.error ? { error: pane.error } : {}),
    };
  }

  /** 发一条元信息通知（不带树）；`stale` 表示 surface 该来要树了。 */
  private publishUpdate(
    pane: PaneState,
    extra: { stale?: boolean; closed?: boolean; error?: string },
  ): void {
    if (this.disposed) return;
    if (extra.error !== undefined) pane.error = extra.error;
    pane.lastRenderAt = Date.now();
    const current = this.panes.get(`${pane.modId}\u0000${pane.paneId}`);
    if (current && current !== pane) current.error = pane.error;
    this.options.onPanelUpdate(this.payloadOf(pane, extra));
  }
}

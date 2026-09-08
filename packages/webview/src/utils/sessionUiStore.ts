import type { PanelTab } from "../types";

/** Shared panel-slot default width (also the fresh-group default below). */
export const PANEL_DEFAULT_WIDTH = 420;

/**
 * 会话级 UI 状态快照 store（P3-B 统一契约）。
 *
 * 「某块 UI 状态属于哪个会话、何时恢复、何时失效」此前由各病点自造土办法
 * （panelGroupCache 模块级 Map、#2081 desktopHost WeakMap、a3043966 到达时
 * 盖章……）。本模块把 webview 侧的会话级快照收敛为一套存取代码：
 *
 * ## key 维度
 *
 * 键 = 会话键（groupKey 语义）：已绑定会话用 sessionId，未绑定的新会话用
 * `new:<paneId>`（首个消息绑定会话后经 move 迁移到 sessionId）。不用
 * workdir：同一目录可开多个会话，各会话的面板布局互不相干，会话是 UI 状态
 * 的最小归属单位。
 *
 * ## 失效规则
 *
 * pruneSessionUi 由 DesktopApp 在会话树/分屏更新时调用：owner 消失（会话被
 * 删、pane 被拆）的键整体删除；仅隐藏（后台会话）的键保留——折叠面板、预
 * 览 URL、forward 引用等都随会话存活，直到会话消失。
 *
 * ## 写入纪律
 *
 * 组件持有 useState mirror；「何时恢复/写回」的编排（换会话 swap effect、
 * 每次渲染后的快照 sync effect）留在 ChatApp——它们与 React 提交时序强耦
 * 合，不适合下沉。store 只回答「存哪、怎么存、何时失效」。**禁止直接
 * mutate 缓存对象**（先例 #2049 的 patchCachedTabUrl 与 forward 即时写都
 * 是土办法）：一律走 set/patch，为将来换持久化/订阅机制留单一咽喉。
 */

/** 本会话在 remote host 上的端口转发引用（preview 面板场景 18）。 */
export interface RemoteForwardRef {
  host: string;
  remotePort: number;
  /** The original remote URL the user clicked (kept for comment rewriting). */
  originalUrl: string;
  /** Matches the desktopForwardPortResult reply; stale replies are dropped. */
  requestId: string;
}

/** 单个会话的 UI 状态快照。新字段按「折叠状态（80db706b）/ 预览 URL（#2049）
 *  的先例」直接加在这里——声明即纳入快照/恢复/失效的全套机制。 */
export interface SessionUiState {
  /** Open panel tabs in tab order (multi-instance kinds may repeat). */
  checked: PanelTab[];
  /** Shared panel-slot width (tabbed layout: one slot, one width). */
  panelWidth: number;
  /**
   * True once the user manually dragged the shared slot width off its default.
   * A slot never dragged auto-fills the space beyond the conversation's minimum
   * when the panel opens (spec desktop-panels.md 场景 7-9); a manual one keeps
   * its width from then on.
   */
  panelWidthManual: boolean;
  /** Currently active tab id; null when no tab is open. */
  activePanel: string | null;
  /**
   * Whether the panel slot is expanded for this session (spec
   * desktop-panels.md「展开/折叠」场景 10: 折叠/展开逐会话记忆，与 tab 集合/
   * 宽度同级). Collapsing hides the slot but keeps the open tabs mounted, so a
   * session collapsed with tabs open must come back collapsed after a switch.
   */
  panelExpanded: boolean;
  /** Plan panel markdown (ExitPlanMode content); null = no plan yet. */
  planContent: string | null;
  /**
   * This session's remote port forward (scenario 18). The tunnel is owned by
   * the session, not the pane: it survives panel close, host switches, pane
   * rebinding and unmount/remount — only session deletion, ssh process death
   * or app exit release it. Display bookkeeping only.
   */
  forward: RemoteForwardRef | null;
  /** Last forward failure for this session, shown in the preview stub. */
  forwardError: string | null;
}

export type SessionUiKey = string;

export function emptySessionUiState(): SessionUiState {
  return {
    checked: [],
    panelWidth: PANEL_DEFAULT_WIDTH,
    panelWidthManual: false,
    activePanel: null,
    panelExpanded: false,
    planContent: null,
    forward: null,
    forwardError: null,
  };
}

/** Patch 对象或基于当前状态的 updater（返回要合并的部分字段）。 */
export type SessionUiPatch = Partial<SessionUiState>;

class SessionUiStore {
  private cache = new Map<SessionUiKey, SessionUiState>();

  get(key: SessionUiKey): SessionUiState | undefined {
    return this.cache.get(key);
  }

  /** 全量快照写入（ChatApp 的 state-sync effect 每次提交后调用）。 */
  set(key: SessionUiKey, state: SessionUiState): void {
    this.cache.set(key, state);
  }

  /** 局部写入；键尚无条目时以空组起底（先例：forward 请求即时落缓存）。 */
  patch(key: SessionUiKey, patch: SessionUiPatch): void {
    const prev = this.cache.get(key) ?? emptySessionUiState();
    this.cache.set(key, { ...prev, ...patch });
  }

  /**
   * 新会话桶迁移：`new:<paneId>` 的 setup（首个消息绑定会话前做的面板布局）
   * 搬到 sessionId 名下。目标键已有自己的条目时不搬（返回既有条目）；
   * 「何时允许迁移」（仅首个消息绑定会话那一次）由调用方判断。返回目标键
   * 生效的条目（无则 undefined）。
   */
  move(from: SessionUiKey, to: SessionUiKey): SessionUiState | undefined {
    const existing = this.cache.get(to);
    if (existing) return existing;
    const group = this.cache.get(from);
    if (group) {
      this.cache.set(to, group);
      this.cache.delete(from);
    }
    return group;
  }

  /** 失效清理：owner 消失的键整体删除（见模块头「失效规则」）。 */
  prune(keepKeys: Set<string>): void {
    for (const key of [...this.cache.keys()]) {
      if (!keepKeys.has(key)) this.cache.delete(key);
    }
  }

  /**
   * 按 forward requestId 反查归属会话键（desktopForwardPortResult 回复的
   * 归属匹配：tunnel 属于会话而非 pane，晚到的回复仍更新所属会话的缓存）。
   */
  keyByForwardRequestId(requestId: string): SessionUiKey | undefined {
    for (const [key, state] of this.cache) {
      if (state.forward?.requestId === requestId) return key;
    }
    return undefined;
  }
}

export const sessionUi = new SessionUiStore();

/** 旧名兼容（tests/DesktopApp 既有 import）：失效清理的具名导出。 */
export function prunePanelGroupCache(keepKeys: Set<string>): void {
  sessionUi.prune(keepKeys);
}

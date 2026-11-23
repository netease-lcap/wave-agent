import { renderSurfacesOf } from "../mods/runtime.js";
import type { HostEntrypoint } from "../constants/telemetry.js";
import type { ModRenderSurface } from "../types/mods.js";

/**
 * 会话此刻的消费者（spec `core/session-consumers.md`）：能接收并渲染这条会话
 * 输出的一方。
 *
 * 这份事实是"只对能渲染的那一端可用"的能力的依据（交付文件卡片、推送、面板）。
 * 判断依据**不是**会话从哪个入口建的：同一个 daemon 会话可能先被终端建、再被
 * 手机接管，也可能反过来。所以它由两半合成——入口推导的静态基础集，加上运行期
 * 挂上来的附加项（本期只有远控页）。
 *
 * `terminal` 表示"有人在看"，但终端渲不出卡片、也没有点击，所以它不算
 * "能渲染富产物"：这类判断一律走 {@link SessionConsumers.hasRenderable}。
 */
export type SessionConsumerKind =
  | "terminal"
  | "desktop"
  | "vscode"
  | "remote-page";

const CONSUMER_KINDS: readonly SessionConsumerKind[] = [
  "terminal",
  "desktop",
  "vscode",
  "remote-page",
];

/** 窄化一个来自宿主的附加消费者名单（`remote-page` 之外的值一律丢弃）。 */
export function isSessionConsumerKind(
  value: unknown,
): value is SessionConsumerKind {
  return (
    typeof value === "string" &&
    (CONSUMER_KINDS as readonly string[]).includes(value)
  );
}

/**
 * 基础消费者：由会话创建方式推导，进程活多久就存在多久。
 *
 * 与面板的 {@link renderSurfacesOf} 同源，不另造一份入口表：宿主显式声明的
 * `renderSurfaces` 优先（交互 CLI 声明 `["terminal"]`，`wave -p` 声明 `[]`，
 * 两者入口都是 `cli`），没声明时按入口推导（桌面端 / 插件端）。`mobile` 目前
 * 没有消费者对应，丢弃。
 */
export function baseConsumersOf(
  entrypoint: HostEntrypoint | undefined,
  renderSurfaces: readonly ModRenderSurface[] | undefined,
): readonly SessionConsumerKind[] {
  const surfaces = renderSurfaces ?? renderSurfacesOf(entrypoint);
  const consumers: SessionConsumerKind[] = [];
  for (const surface of surfaces) {
    if (
      surface === "terminal" ||
      surface === "desktop" ||
      surface === "vscode"
    ) {
      consumers.push(surface);
    }
  }
  return consumers;
}

/**
 * 一条会话的消费者状态。
 *
 * 合成规则只有这一处：`基础集 ∪ 附加集`。附加集由持有 relay 的那一层上报
 * （远控页挂上来 / 走掉），基础集在会话创建时定下、之后不动。
 */
export class SessionConsumers {
  private attached: readonly SessionConsumerKind[] = [];

  constructor(private readonly base: readonly SessionConsumerKind[]) {}

  /** 此刻的消费者（去重，基础集在前）。 */
  current(): readonly SessionConsumerKind[] {
    return Array.from(new Set([...this.base, ...this.attached]));
  }

  /**
   * 是否存在"能渲染富产物"的消费者——也就是除 `terminal` 之外还有人在看。
   *
   * 这是交付卡片一类能力的唯一谓词；不要在各处重复写 `kind !== "terminal"`。
   */
  hasRenderable(): boolean {
    return this.current().some((kind) => kind !== "terminal");
  }

  /**
   * 覆盖附加消费者，返回是否真的变了。
   *
   * 覆盖而不是增减：上报方报的是"这一刻谁挂在上面"，它自己就不该维护差分。
   */
  setAttached(kinds: readonly SessionConsumerKind[]): boolean {
    const next = Array.from(new Set(kinds));
    const before = new Set(this.attached);
    const changed =
      next.length !== before.size || next.some((kind) => !before.has(kind));
    this.attached = next;
    return changed;
  }
}

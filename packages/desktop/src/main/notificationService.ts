/**
 * System notifications for the desktop host (spec desktop-notifications.md).
 *
 * Two events reach the user through the OS notification center (macOS) /
 * action center (Windows) while the window is not in front of them: a
 * confirmation / answer request (story 1) and a turn that finished on its own
 * (story 2). The in-app channels are untouched — the sidebar waiting dot, the
 * confirmation dialog, the bottom-right toast and the「已完成未读」green dot keep
 * their existing rules; a system notification is a second channel for the case
 * those cannot cover, never a replacement for them.
 *
 * Story 4 adds the icon-level signal underneath those banners — taskbar flash /
 * Dock bounce, plus a badge that counts the sessions waiting for an answer —
 * so「仅标记」has something to show even when no banner pops. Those signals
 * go in through `AttentionDeps` exactly like the notification factory does.
 *
 * Why it is its own module: the state below (one notification per waiting
 * session, its lifecycle, the click path, the badge count) is state DesktopHost
 * must not grow, and every branch is testable with an injected window +
 * notification factory + attention hooks instead of a real desktop session.
 */

import { Notification } from "electron";
import * as path from "path";

/** Icon shipped at `<package>/assets/icon.png` (bundled `dist/main` → `../..`). */
export const NOTIFICATION_ICON_PATH = "../../assets/icon.png";

/**
 * 通知类别。故事 3 让「权限与问题」「回答提问」「回合完成」各自一档等级，所以
 * 类别是入参而不是从文案里反推。
 *
 * `idle` = 一个回合结束了（spec 故事 2）。它比确认类低一头：同一会话屏幕上
 * 已经挂着一条确认通知时，回合完成不得把它顶掉（故事 2 场景 5）—— `active`
 * 条目记着类别就是为了这一判断。
 */
export type NotificationChannel = "permission" | "question" | "idle";

/**
 * 提醒等级（spec 故事 3 的三档：弹窗 / 仅标记 / 关闭）。
 *
 * 等级的**唯一来源是设置**（`NotificationServiceDeps.getLevel`，每次发通知现读
 * 桌面端本地偏好）：请求入参不带 level，带了就是第二份真相。缺省值（三类都是
 * 「弹窗」）与持久化都在 `configStore.ts`。
 *
 * 三档各管什么：`banner` = 系统通知 + 角标 / 闪烁；`mark` = 只有角标 / 闪烁
 * （故事 4），不弹窗（故事 3 场景 3）；`off` = 什么都不做、不计数，屏上已有的
 * 那条由宿主在等级变更时 `closeChannel` 按类别撤（故事 3 场景 4 / 6），service
 * 的 off 分支不碰它。
 */
export type NotificationLevel = "banner" | "mark" | "off";

/**
 * 会话标识：同一个 host 上的同一个 sessionId 才算同一个会话 —— 不同 host 的
 * sessionId 是两个命名空间（与 DesktopHost 的 agentKey 同一条口径）。
 */
export interface NotificationSessionRef {
  host: string;
  sessionId: string;
}

/** What a confirmation request contributes to its system notification. */
export interface ConfirmationNotification {
  session: NotificationSessionRef;
  channel: Exclude<NotificationChannel, "idle">;
  /** 标题：会话标题，缺失时调用方给项目名（spec 故事 1 场景 1）。 */
  title: string;
  /** 正文：待确认类别 + 关键内容。 */
  body: string;
  /** 点击后处理窗口之外的事（定位会话）。 */
  onClick?: () => void;
}

/**
 * What a finished turn contributes to its system notification (spec story 2).
 * 「这是一个真的回合、不是用户中断」由调用方判（只有它看得到 loading 的先后
 * 与 abort 标记）；service 只管窗口在场、会话还在、以及与确认通知的优先级。
 */
export interface TurnEndNotification {
  session: NotificationSessionRef;
  title: string;
  /** 正文：「已完成」或体现失败的那句，按本轮有没有 error notice 由调用方定。 */
  body: string;
  onClick?: () => void;
}

/** The slice of `BrowserWindow` presence detection and waking drive. */
export interface NotificationWindow {
  isDestroyed: () => boolean;
  isVisible: () => boolean;
  isFocused: () => boolean;
  isMinimized: () => boolean;
  show: () => void;
  focus: () => void;
  restore: () => void;
}

/** The slice of Electron's `Notification` this module uses. */
export interface NotificationLike {
  show: () => void;
  close: () => void;
  on: (event: "click", listener: () => void) => void;
}

/** What the OS notification is built from — the subset of Electron's `Notification` options used here. */
export interface NotificationOptions {
  title: string;
  body: string;
  icon: string;
  /** 提示音关着时静音（spec 故事 3 场景 5；Electron `silent`）。 */
  silent: boolean;
}

/**
 * 故事 4 的注意力信号（任务栏闪烁 / Dock 弹跳 / 角标），全部经注入：service
 * 不直接碰 `app` 与窗口的 `flashFrame`，和 `Notification` 一样保持可在没有
 * 桌面会话的环境里测。每个函数在 service 里都各自被 try/catch 包着（故事 4
 * 场景 6「静默降级」）—— 实现方不必自己包，抛了也只是这一个信号没发出去。
 */
export interface AttentionDeps {
  /** `win.flashFrame(on)`：Windows 任务栏闪烁 / Linux urgency hint；`false` 停。 */
  flashFrame: (on: boolean) => void;
  /**
   * `app.dock?.bounce("informational")`：macOS Dock 弹跳。每个事件都调一次 ——
   * informational 只弹一秒就自停，不像 `flashFrame(true)` 那样持续到被停掉，
   * 所以不受「一次只闪一轮」的守卫。请求 id 由实现方自己管（覆盖上一个即可，
   * 旧请求在应用激活时自然结束）。
   */
  bounce: () => void;
  /** `app.dock?.cancelBounce(id)`：停掉上面那次弹跳。 */
  cancelBounce: () => void;
  /** `app.setBadgeCount(n)`：图标角标 = 等待确认的会话数；0 = 清掉。 */
  setBadgeCount: (n: number) => void;
}

export interface NotificationServiceDeps {
  /** The main window; `null` before it exists / after it is destroyed. */
  getWindow: () => NotificationWindow | null;
  /**
   * 该类别的提醒等级（spec 故事 3）：每次发通知现读设置，改完即时生效、不用
   * 再通知 service 一声。等级是设置的事，请求入参不带。
   */
  getLevel: (channel: NotificationChannel) => NotificationLevel;
  /** 提示音开关（故事 3 场景 5）：`false` 时发出的通知静音。同样现读。 */
  getSound: () => boolean;
  /** 故事 4：任务栏闪烁 / Dock 弹跳 / 角标。必填 —— 漏接就是「仅标记」什么都不剩。 */
  attention: AttentionDeps;
  /**
   * 会话是否还在（池子里或在会话索引里）。已归档 / 已删除 / 通知到达时已不
   * 存在的会话一律跳过（spec 故事 1 场景 7）。
   */
  isSessionLive?: (session: NotificationSessionRef) => boolean;
  /** Overridable for tests: Electron's `Notification` needs a desktop session. */
  isSupported?: () => boolean;
  createNotification?: (
    options: NotificationOptions,
    onClick: () => void,
  ) => NotificationLike;
  /** Absolute icon path override (tests); defaults to the shipped brand icon. */
  iconPath?: string;
}

/** 同一会话在同一 host 上的合并键（`\u0000` 分隔，与 agentKey 同构）。 */
function sessionKey(session: NotificationSessionRef): string {
  return `${session.host}\u0000${session.sessionId}`;
}

/**
 * 唤起窗口：最小化先 restore，再 show + focus（与托盘「显示 CodeWave IDE」
 * 同一条路径 —— `show()` 还会把窗口重新挂回任务栏）。
 */
export function revealWindow(win: NotificationWindow | null): void {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/**
 * 压成一行并截断：AskUserQuestion 的原文可能几百字，系统通知里只能给一句
 * 可读的（spec 故事 1 场景 2「不得整段倾泻」）。
 */
export function oneLine(text: string, limit = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}

function defaultIconPath(): string {
  // `dist/main/index.cjs` at runtime, `src/main` in tests — both sit two levels
  // below the package root, so the same relative path lands on the same icon.
  // `__dirname` like the dock icon in `index.ts`: the bundle is CJS (tsup
  // `format: ["cjs"]`), so no import.meta.url → fileURLToPath detour.
  return path.join(__dirname, NOTIFICATION_ICON_PATH);
}

function defaultCreateNotification(
  options: NotificationOptions,
  onClick: () => void,
): NotificationLike {
  const notification = new Notification(options);
  notification.on("click", onClick);
  return notification;
}

export class NotificationService {
  private readonly deps: NotificationServiceDeps;
  /**
   * 屏幕上正在显示的每条通知（key = sessionKey）。记着类别：回合完成的通知
   * 遇到同一会话的确认通知要让路（spec 故事 2 场景 5），判的就是这个字段。
   */
  private readonly active = new Map<
    string,
    {
      session: NotificationSessionRef;
      channel: NotificationChannel;
      notification: NotificationLike;
    }
  >();
  /**
   * 正在等待确认的会话（key = sessionKey，值 = 会话引用）—— 角标数字的唯一真相
   * （spec 故事 4 场景 1「数字等于等待确认的会话数」）。按会话去重：同一会话两条
   * 确认只算一。只收确认类（permission / question）、等级不是「关闭」的请求，
   * **不管用户在不在场**：角标是「有会话在等我」的持久事实，不随窗口状态变 ——
   * 在场时到达的也计数，用户切走后 Dock 上的数字才等于等待确认的会话数（故事 4
   * 场景 1）；闪 / 弹才是「叫你」，只在他不在时给。回合完成不进这里 —— 它不是
   * 「在等人点头」。去掉只经 `close`（该会话的等待结束：全部解决 / 中止 / 会话
   * 删除 / host 断连），屏幕上那条通知被撤掉本身不算（`retract` 的注释说了为什么）。
   * 值存会话引用而不只是 key：在场时到达的确认没有横幅、不进 `active`，
   * `closeHost` / `closeAll` 光扫屏上那条会漏掉它们，得按 host 从这里自己扫。
   */
  private readonly pendingConfirmationSessions = new Map<
    string,
    NotificationSessionRef
  >();
  /**
   * flashFrame 是否在闪（Windows 持续闪到被停，幂等；macOS bounce 一秒自停，不受
   * 此守卫）：一次只闪一轮，窗口回前台（`stopAttention`）才复位。
   */
  private attentionLive = false;

  constructor(deps: NotificationServiceDeps) {
    this.deps = deps;
  }

  /** 该会话当前是否有一条通知显示着（一会话一条）。 */
  isShowing(session: NotificationSessionRef): boolean {
    return this.active.has(sessionKey(session));
  }

  /**
   * 会话开始等待用户：记入角标（不管用户在不在场 —— 角标是「有会话在等我」的
   * 持久事实，spec 故事 4 场景 1），然后窗口不在用户眼前时闪 / 弹一下（故事 4
   * 场景 2），等级是「弹窗」时再弹一条系统通知。返回是否真的弹了系统通知
   * （「仅标记」返回 false，但角标 / 闪烁已经给了；用户在场返回 false、不闪不弹
   * 不弹窗，角标照常 +1；「关闭」返回 false 且什么都不留）。
   *
   * 同一会话同一等待周期内再来请求 = 替换内容、屏幕上仍然只有一条（spec
   * 故事 1 场景 5）；`close` 之后再来 = 新的一轮，可以再次提醒。
   */
  notifyConfirmation(request: ConfirmationNotification): boolean {
    if (this.deps.isSessionLive && !this.deps.isSessionLive(request.session)) {
      this.close(request.session);
      return false;
    }
    const level = this.deps.getLevel(request.channel);
    if (level === "off") {
      // 「关闭」：不弹、不标记、不计数（spec 故事 3 场景 4、故事 4 场景 5）。
      // 屏上那条由 host 在等级变更时 `closeChannel` 按类别撤（故事 3 场景 6
      // 「即时生效」），这里不碰 —— 不看类别地撤会把同会话另一类别还挂着的
      // 通知误伤。
      return false;
    }
    // 角标是「有会话在等我」的持久事实，不随窗口状态变：在场时到达也计数，
    // 用户切走后 Dock 上的数字才等于等待确认的会话数（spec 故事 4 场景 1）。
    this.markConfirmationPending(request.session, request.channel);
    if (this.userPresent()) {
      // 用户就在窗口前面：分屏里的确认框已经覆盖这条请求，不叫 —— 不闪不弹、
      // 不发系统通知（spec 故事 1 场景 1「窗口可见且聚焦时不得发出系统通知」；
      // 故事 4 场景 2 的闪 / 弹以「窗口不可见时」为前提）。上一轮留下的通知也
      // 一并撤掉 —— 它指向的那张对话框此刻就在眼前。
      this.retract(request.session);
      return false;
    }
    // 不在场：闪 / 弹一下（spec 故事 4 场景 2）。「仅标记」到此为止 —— 不弹窗
    // （故事 3 场景 3），角标与闪烁就是它全部的信号。banner 再往下 post，平台
    // 支持在那里判：角标 / 闪烁不经过系统通知，Linux 没有通知守护进程时照常。
    this.startAttention();
    if (level !== "banner") return false;
    return this.post(request, request.channel);
  }

  /**
   * 一个回合结束了：窗口不在用户眼前时弹一条系统通知，返回是否真的弹了。
   *
   * 与确认通知走同一套判定（会话还在 / 等级 / 用户在场；平台支持在 `post`
   * 里判），差别只在优先级：该会话屏幕上已经挂着一条确认类通知时直接让路
   * —— 模型在等人点头，把那条顶掉换成「已完成」等于把最该处理的事藏起来
   * （spec 故事 2 场景 5）。确认那头不用对称地让：确认请求优先于一切。同一
   * 会话上一条也是回合完成（上一轮的通知还挂着没点）则照常合并成一条。
   */
  notifyTurnEnd(request: TurnEndNotification): boolean {
    if (this.deps.isSessionLive && !this.deps.isSessionLive(request.session)) {
      this.close(request.session);
      return false;
    }
    // 必须排在等级 / 在场两道判定之前：那两条都会顺手撤掉该会话现有的
    // 通知，而这里要保的恰恰是那条确认通知。
    if (this.showingConfirmation(request.session)) return false;
    const level = this.deps.getLevel("idle");
    if (level === "off") {
      this.retract(request.session);
      return false;
    }
    if (this.userPresent()) {
      // 用户就在窗口前面：回复已经在分屏里，侧边栏绿点也照常亮，不再叫一声
      //（spec 故事 2 场景 4）。
      this.retract(request.session);
      return false;
    }
    // 闪烁 / 弹跳一下就够（spec 故事 4 场景 2），不计数：回合完成不是「在等人
    // 点头」，角标只数等待确认的会话（故事 4 场景 1）。
    this.startAttention();
    if (level !== "banner") return false;
    return this.post(request, "idle");
  }

  /** 该会话屏幕上那条是不是确认类（权限 / 问题）通知。 */
  private showingConfirmation(session: NotificationSessionRef): boolean {
    const channel = this.active.get(sessionKey(session))?.channel;
    return channel !== undefined && channel !== "idle";
  }

  /**
   * 建一条新通知顶替该会话屏幕上的旧通知（一会话一条），返回是否真的弹了。
   * 平台没有系统通知能力（`Notification.isSupported()` 为 false 或抛错）时在
   * 这里判、静默降级（spec 故事 4 场景 6）：到此之前的角标 / 闪烁已经发出
   * ——「仅标记」在 Linux 上那两个就是全部信号，不能被通知守护进程的缺失一起
   * 吞掉。
   */
  private post(
    request: {
      session: NotificationSessionRef;
      title: string;
      body: string;
      onClick?: () => void;
    },
    channel: NotificationChannel,
  ): boolean {
    if (!this.supported()) return false;
    // Electron 的 Notification 内容不可变（title/body 都是构造参数），所以
    // 「后到者更新内容」只能撤掉旧的再建一条，屏幕上始终只有一条。
    this.retract(request.session);
    const key = sessionKey(request.session);
    const notification = (
      this.deps.createNotification ?? defaultCreateNotification
    )(
      {
        title: request.title,
        body: request.body,
        icon: this.deps.iconPath ?? defaultIconPath(),
        silent: !this.deps.getSound(),
      },
      () => {
        // 点击：通知的使命已经完成（用户回来了），先撤掉自己再唤起窗口；
        // 定位会话交给调用方（既有 focusSession 链路）。只撤自己 —— 同一
        // 会话可能已经换成后到的那条，别把别人的通知关掉。只撤屏上这条、
        // 不动角标：点击只是把人叫回来，确认还没答。
        if (this.active.get(key)?.notification === notification) {
          this.retract(request.session);
        }
        revealWindow(this.deps.getWindow());
        request.onClick?.();
      },
    );
    this.active.set(key, { session: request.session, channel, notification });
    notification.show();
    return true;
  }

  /**
   * 该会话不再等任何人：请求全部解决 / 中止 / 会话消失 / 归档 / 删除 / host
   * 断连 / 进程退出。撤掉它的通知 —— 绝不留一条指向已经消失的对话框的僵尸
   * 通知（spec 故事 1 场景 4/7）；确认类与回合完成通知一视同仁 —— 通知中心里
   * 一条「已完成」指向一个已经删掉的会话同样不对。同时把它从角标计数里去掉
   * （故事 4 场景 1/4）：宿主侧每一条「等待周期结束」的路径都经这里收尾，角标
   * 跟着通知一起走、不会残留。
   */
  close(session: NotificationSessionRef): void {
    this.unmarkConfirmationPending(session);
    this.retract(session);
  }

  /**
   * 撤掉该会话屏幕上那条通知（一会话一条），**不动角标计数**。service 内部
   * 所有「这条通知不该再挂着」的判定都走这里：用户就在窗口前、被同会话后到
   * 的那条顶替、用户点了它、`closeChannel`（宿主在等级变更时按类别撤）、回合
   * 完成那条路的「关闭」等级 —— 这些都不代表该会话的等待结束了，它可能还在
   * 等人，而角标数的是「等待确认的会话」（故事 4 场景 1）。确认请求的「关闭」
   * 分支不走这里：屏上那条归 `closeChannel` 撤，service 再撤就是不看类别的误伤。
   */
  private retract(session: NotificationSessionRef): void {
    const key = sessionKey(session);
    const entry = this.active.get(key);
    if (!entry) return;
    this.active.delete(key);
    entry.notification.close();
  }

  /**
   * 把某个类别的通知从屏幕上全部撤掉：用户刚把这个类别从「弹窗」降到「仅标记」
   * 或「关闭」（故事 3 场景 6「即时生效」）—— 他刚说了不弹窗，屏上那条留着
   * 就是违背意愿。只撤通知：角标与闪烁不动，那正是「仅标记」留给用户看的信号
   * （故事 4）。
   */
  closeChannel(channel: NotificationChannel): void {
    for (const entry of [...this.active.values()]) {
      if (entry.channel === channel) this.retract(entry.session);
    }
  }

  /**
   * 该会话开始等人（spec 故事 4 场景 1）：记入角标计数。只做这一件事 —— 闪 /
   * 弹是「叫你」，由调用方按「用户不在场」单独起（`startAttention`），角标则是
   * 「有会话在等我」的持久事实，不管用户在不在场都记。只收确认类且等级不是
   * 「关闭」的：调用方已经判过等级，这里的等级守卫是让方法自己的契约站得住。
   * 同一会话再来一条不重计（按会话去重）。
   */
  private markConfirmationPending(
    session: NotificationSessionRef,
    channel: Exclude<NotificationChannel, "idle">,
  ): void {
    if (this.deps.getLevel(channel) === "off") return;
    // `Map.set` 返回的是映射本身（恒真），不是「是否新增」—— 判重得用 `has`。
    const key = sessionKey(session);
    if (!this.pendingConfirmationSessions.has(key)) {
      this.pendingConfirmationSessions.set(key, session);
      this.attempt(() =>
        this.deps.attention.setBadgeCount(
          this.pendingConfirmationSessions.size,
        ),
      );
    }
  }

  /**
   * 该会话不再等人（确认全部解决 / 中止 / 会话删除 / host 断连）：从角标计数
   * 里去掉；最后一个去掉时角标清零并停止闪烁 / 弹跳（spec 故事 4 场景 4）。
   * 本来就不在集合里就什么都不做 —— 回合完成的通知、等级「关闭」的请求走的
   * 就是这条路。
   */
  private unmarkConfirmationPending(session: NotificationSessionRef): void {
    if (!this.pendingConfirmationSessions.delete(sessionKey(session))) return;
    this.attempt(() =>
      this.deps.attention.setBadgeCount(this.pendingConfirmationSessions.size),
    );
    if (this.pendingConfirmationSessions.size === 0) this.stopAttention();
  }

  /**
   * 闪烁 / 弹跳（spec 故事 4 场景 2），用户不在场时每个事件调一次。两件事守卫
   * 不同：`flashFrame(true)` 在 Windows 上持续闪到 `stopAttention`，已经在闪
   * 就不重复 —— 用户不在场的这段时间里，第二个会话、第二个回合只加角标，不再
   * 闪一次；`bounce()` 每次都调 —— macOS 的 informational 弹跳只弹一秒就自停，
   * 守卫会吞掉同一阵里后续事件的弹跳（第一个事件弹完停了，30 秒后的第二个就
   * 再也叫不响），实现方覆盖上一个请求 id 即可，旧的在应用激活时自然结束。
   * 不碰角标 —— 回合完成也走这里，而它不计数。
   */
  private startAttention(): void {
    if (!this.attentionLive) {
      this.attentionLive = true;
      this.attempt(() => this.deps.attention.flashFrame(true));
    }
    this.attempt(() => this.deps.attention.bounce());
  }

  /**
   * 停止闪烁 / 弹跳（用户把窗口切回前台，spec 故事 4 场景 3）。角标不动：它是
   * 「有会话在等我」的持久标记，只在等待数变化时更新，等用户真的把确认处理完
   * 才经 `close` → `unmarkConfirmationPending` 清零。没在闪就什么都不调。
   */
  stopAttention(): void {
    if (!this.attentionLive) return;
    this.attentionLive = false;
    this.attempt(() => this.deps.attention.flashFrame(false));
    this.attempt(() => this.deps.attention.cancelBounce());
  }

  /**
   * 发一个注意力信号，失败就算了（spec 故事 4 场景 6「静默降级」）：Linux 没有
   * dock、窗口刚被销毁、Windows 没注册 toast —— 这些信号本来就只是系统通知的
   * 补充，任何一个失败都不得影响主流程或抛出可见错误。每一处调用单独包：
   * 闪烁失败不能连弹跳也不试了。
   */
  private attempt(signal: () => void): void {
    try {
      signal();
    } catch {
      // 见上：角标 / 闪烁 / 弹跳失败一律吞掉，系统通知照常。
    }
  }

  /**
   * 某个 host 的会话整体不可见了（SSH 断开、退出登录）：一次撤干净 —— 屏上的
   * 通知与角标计数都要。计数得单独扫：用户在场时到达的确认只计数、没有横幅，
   * 不在 `active` 里，光扫屏上那条角标就会卡在 N 直到重启（先扫屏上那条无妨 ——
   * `close` 顺手把它从计数里去掉，第二轮只剩没横幅的）。
   */
  closeHost(host: string): void {
    for (const session of this.sessions()) {
      if (session.host === host) this.close(session);
    }
    for (const session of [...this.pendingConfirmationSessions.values()]) {
      if (session.host === host) this.close(session);
    }
  }

  /** 每条通知与每个角标计数都撤掉（进程退出前）；计数同样要单独扫，理由同上。 */
  closeAll(): void {
    for (const session of this.sessions()) this.close(session);
    for (const session of [...this.pendingConfirmationSessions.values()]) {
      this.close(session);
    }
  }

  private sessions(): NotificationSessionRef[] {
    return [...this.active.values()].map((entry) => entry.session);
  }

  private supported(): boolean {
    try {
      return (this.deps.isSupported ?? (() => Notification.isSupported()))();
    } catch {
      // 平台没有通知能力（或被裁掉的运行环境）：静默降级，不抛（spec 故事 1
      // 场景 8）。
      return false;
    }
  }

  /**
   * 用户是否正看着这个窗口。三者全真才算「在场」：隐藏到托盘（不可见）、
   * 被别的应用压住（失焦）、最小化，任一为假都值得叫一声（spec 场景 1）。
   *
   * 与 `userPresentHere()` 是两件事：那个为 SSH 重连服务（失焦时再看系统空闲
   * 态），判「有人在电脑前」；这个判「这个窗口在不在他眼前」。不要合并。
   */
  private userPresent(): boolean {
    const win = this.deps.getWindow();
    if (!win || win.isDestroyed()) return false; // 没有窗口 = 没人看着
    return win.isVisible() && win.isFocused() && !win.isMinimized();
  }
}

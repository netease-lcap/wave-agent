import { describe, expect, it, vi, type Mock } from "vitest";
import * as path from "path";
import { Notification } from "electron";
import {
  NotificationService,
  NOTIFICATION_ICON_PATH,
  oneLine,
  type AttentionDeps,
  type ConfirmationNotification,
  type NotificationLevel,
  type NotificationOptions,
  type NotificationServiceDeps,
  type TurnEndNotification,
} from "../src/main/notificationService";

type ElectronMock = typeof import("./__mocks__/electron");
const notificationMock =
  Notification as unknown as ElectronMock["Notification"];

/** Window probes the service reads; absent = the "user is here" baseline. */
interface WindowProbe {
  visible?: boolean;
  focused?: boolean;
  minimized?: boolean;
  destroyed?: boolean;
}

/** A main-window stand-in: every probe and every wake call is a spy. */
function makeWindow(probe: WindowProbe = {}) {
  return {
    isDestroyed: vi.fn(() => probe.destroyed ?? false),
    isVisible: vi.fn(() => probe.visible ?? true),
    isFocused: vi.fn(() => probe.focused ?? true),
    isMinimized: vi.fn(() => probe.minimized ?? false),
    show: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
  };
}

/** What the factory handed the OS, plus the click handler the service registered. */
interface RecordedNotification {
  options: NotificationOptions;
  show: Mock<() => void>;
  close: Mock<() => void>;
  onClick: () => void;
}

/** Records every notification the service builds instead of touching Electron. */
function makeFactory() {
  const created: RecordedNotification[] = [];
  const createNotification: NonNullable<
    NotificationServiceDeps["createNotification"]
  > = (options, onClick) => {
    const entry: RecordedNotification = {
      options,
      show: vi.fn<() => void>(),
      close: vi.fn<() => void>(),
      onClick,
    };
    created.push(entry);
    return { show: entry.show, close: entry.close, on: vi.fn() };
  };
  return { created, createNotification };
}

/**
 * 故事 4 的四个注意力信号替身（任务栏闪烁 / Dock 弹跳 / 角标）。每个都是 spy：
 * 用例断言调参，或 `mockImplementation` 让某一个抛错走场景 6 的降级分支。
 */
function makeAttention() {
  return {
    flashFrame: vi.fn<(on: boolean) => void>(),
    bounce: vi.fn<() => void>(),
    cancelBounce: vi.fn<() => void>(),
    setBadgeCount: vi.fn<(count: number) => void>(),
  } satisfies AttentionDeps;
}

/**
 * A service wired to a recorded window + factory. `window: null` = no window
 * yet; a probe = that window state; omitted = the user is sitting in front of
 * the window (so nothing is posted unless a case says otherwise). `win` comes
 * back typed nullable because of the `null` case — cases that assert on the
 * window's calls build it with `makeWindow` and inject it via `deps.getWindow`.
 */
function makeService(
  opts: {
    window?: WindowProbe | null;
    deps?: Partial<NotificationServiceDeps>;
  } = {},
) {
  const win = opts.window === null ? null : makeWindow(opts.window);
  const factory = makeFactory();
  const attention = makeAttention();
  const service = new NotificationService({
    getWindow: () => win,
    isSupported: () => true,
    iconPath: "/fake/icon.png",
    createNotification: factory.createNotification,
    ...opts.deps,
    // 故事 3 的三个 getter 必填：缺省 = 开箱状态（三类「弹窗」、提示音开、
    // 「通知时提醒我」开），用例按需覆盖 —— 等级不再走请求入参，设置是唯一来源。
    getLevel: opts.deps?.getLevel ?? BANNER_SETTINGS.getLevel,
    getSound: opts.deps?.getSound ?? BANNER_SETTINGS.getSound,
    getDrawAttention:
      opts.deps?.getDrawAttention ?? BANNER_SETTINGS.getDrawAttention,
    // 故事 4 的四个信号必填：恒接同一组 spy，用例经返回值断言 / 改实现。
    attention,
  });
  return { service, win, factory, attention };
}

/** 故事 3 三个必填 getter 的开箱值：三类都「弹窗」、提示音开、「通知时提醒我」开。
 *  提醒开关的产品默认是**关**（与 CC 桌面端 dockBounceEnabled 同口径，见 configStore
 *  的 DEFAULT_NOTIFICATION_DRAW_ATTENTION）；这里取「开」只是为了让本文的闪 / 弹
 *  用例不必逐条打开它，关的那一档由 story 3 场景 6 的两条用例覆盖。 */
const BANNER_SETTINGS = {
  getLevel: () => "banner",
  getSound: () => true,
  getDrawAttention: () => true,
} satisfies Pick<
  NotificationServiceDeps,
  "getLevel" | "getSound" | "getDrawAttention"
>;

const SESSION = { host: "local", sessionId: "sess-1" };
const OTHER_SESSION = { host: "local", sessionId: "sess-2" };

function request(
  over: Partial<ConfirmationNotification> = {},
): ConfirmationNotification {
  return {
    session: SESSION,
    channel: "permission",
    title: "任务A",
    body: "命令执行待确认：pnpm test",
    ...over,
  };
}

function turnEnd(over: Partial<TurnEndNotification> = {}): TurnEndNotification {
  return {
    session: SESSION,
    title: "任务A",
    body: "已完成",
    ...over,
  };
}

describe("NotificationService", () => {
  describe("whether the user is in front of the window", () => {
    it("stays silent while the window is visible, focused and not minimized", () => {
      const { service, factory } = makeService();
      expect(service.notifyConfirmation(request())).toBe(false);
      expect(factory.created).toHaveLength(0);
    });

    it.each([
      { name: "hidden (tray)", window: { visible: false } },
      { name: "unfocused", window: { focused: false } },
      { name: "minimized", window: { minimized: true } },
    ])("notifies when the window is $name", ({ window }) => {
      const { service, factory } = makeService({ window });
      expect(service.notifyConfirmation(request())).toBe(true);
      expect(factory.created).toHaveLength(1);
      expect(factory.created[0].show).toHaveBeenCalledTimes(1);
      expect(factory.created[0].options).toEqual({
        title: "任务A",
        body: "命令执行待确认：pnpm test",
        icon: "/fake/icon.png",
        silent: false,
      });
    });

    it.each([
      { name: "not created yet", window: null },
      { name: "destroyed", window: { destroyed: true } },
    ])("notifies when the main window is $name", ({ window }) => {
      const { service, factory } = makeService({ window });
      expect(service.notifyConfirmation(request())).toBe(true);
      expect(factory.created[0].show).toHaveBeenCalledTimes(1);
    });
  });

  describe("platform support", () => {
    it("returns false without posting when notifications are unsupported — but still badges and flashes", () => {
      // Linux 没有通知守护进程：Notification.isSupported() 为 false 只该拿掉
      // banner。角标 / 任务栏闪烁不经过它，照常发出 ——「仅标记」等级下那是全部
      // 信号（spec 故事 3 场景 3 / 故事 4 场景 6）。
      const { service, factory, attention } = makeService({
        window: { focused: false },
        deps: { isSupported: () => false },
      });
      expect(service.notifyConfirmation(request())).toBe(false);
      expect(factory.created).toHaveLength(0);
      expect(attention.setBadgeCount).toHaveBeenCalledWith(1);
      expect(attention.flashFrame).toHaveBeenCalledWith(true);
      expect(attention.bounce).toHaveBeenCalledTimes(1);
    });

    it("swallows an isSupported that throws (runtime without the binding)", () => {
      const { service, factory } = makeService({
        window: { focused: false },
        deps: {
          isSupported: () => {
            throw new Error("no notification center here");
          },
        },
      });
      expect(service.notifyConfirmation(request())).toBe(false);
      expect(factory.created).toHaveLength(0);
    });

    it("falls back to Electron's Notification class and its own support probe", () => {
      notificationMock.__reset();
      const service = new NotificationService({
        getWindow: () => makeWindow({ focused: false }),
        ...BANNER_SETTINGS,
        attention: makeAttention(),
      });
      expect(service.notifyConfirmation(request())).toBe(true);
      const [notification] = notificationMock.__instances();
      expect(notification.options.title).toBe("任务A");
      // Same `__dirname`-relative road as the dock icon in index.ts.
      expect(notification.options.icon).toBe(
        path.join(__dirname, "..", "src", "main", NOTIFICATION_ICON_PATH),
      );
      expect(notification.show).toHaveBeenCalledTimes(1);
      notification.__click();
      expect(service.isShowing(SESSION)).toBe(false);
    });

    it("stays silent when Electron itself reports no support", () => {
      notificationMock.__reset();
      notificationMock.isSupported.mockReturnValue(false);
      const service = new NotificationService({
        getWindow: () => makeWindow({ focused: false }),
        ...BANNER_SETTINGS,
        attention: makeAttention(),
      });
      expect(service.notifyConfirmation(request())).toBe(false);
      expect(notificationMock.__instances()).toHaveLength(0);
    });
  });

  describe("session liveness (spec story 1 scenario 7)", () => {
    it("skips a session isSessionLive rejects", () => {
      const { service, factory } = makeService({
        window: { focused: false },
        deps: { isSessionLive: () => false },
      });
      expect(service.notifyConfirmation(request())).toBe(false);
      expect(factory.created).toHaveLength(0);
    });

    it("drops the notification a session already has once it stops being live", () => {
      let live = true;
      const { service, factory } = makeService({
        window: { focused: false },
        deps: { isSessionLive: () => live },
      });
      service.notifyConfirmation(request());
      service.notifyConfirmation(request({ session: OTHER_SESSION }));
      live = false;
      expect(service.notifyConfirmation(request())).toBe(false);
      expect(service.isShowing(SESSION)).toBe(false);
      expect(factory.created[0].close).toHaveBeenCalledTimes(1);
      // Only the dead session's notification goes.
      expect(service.isShowing(OTHER_SESSION)).toBe(true);
      expect(factory.created[1].close).not.toHaveBeenCalled();
    });
  });

  describe("one notification per waiting session (spec story 1 scenario 5)", () => {
    const background = { window: { focused: false } } as const;

    it("replaces the earlier notification instead of stacking a second one", () => {
      const { service, factory } = makeService(background);
      service.notifyConfirmation(request());
      service.notifyConfirmation(
        request({ body: "命令执行待确认：pnpm lint" }),
      );
      expect(factory.created).toHaveLength(2);
      expect(factory.created[0].close).toHaveBeenCalledTimes(1);
      expect(factory.created[1].show).toHaveBeenCalledTimes(1);
      expect(factory.created[1].options.body).toBe("命令执行待确认：pnpm lint");
      expect(service.isShowing(SESSION)).toBe(true);
    });

    it("keeps waiting sessions independent (spec story 1 scenario 6)", () => {
      const { service, factory } = makeService(background);
      service.notifyConfirmation(request());
      service.notifyConfirmation(
        request({ session: OTHER_SESSION, title: "任务B" }),
      );
      expect(factory.created.map((c) => c.options.title)).toEqual([
        "任务A",
        "任务B",
      ]);
      expect(service.isShowing(SESSION)).toBe(true);
      expect(service.isShowing(OTHER_SESSION)).toBe(true);
    });

    it("notifies again once the wait cycle ended in close", () => {
      const { service, factory } = makeService(background);
      service.notifyConfirmation(request());
      service.close(SESSION);
      expect(service.notifyConfirmation(request())).toBe(true);
      expect(factory.created).toHaveLength(2);
    });
  });

  describe("click", () => {
    /** A service whose window is unfocused and whose spies the case can read. */
    function makeServiceWithWindow(probe: WindowProbe) {
      const win = makeWindow(probe);
      const { service, factory } = makeService({
        deps: { getWindow: () => win },
      });
      return { service, win, factory };
    }

    it("closes itself, reveals the window and hands off to onClick", () => {
      const onClick = vi.fn();
      const { service, win, factory } = makeServiceWithWindow({
        focused: false,
      });
      service.notifyConfirmation(request({ onClick }));
      factory.created[0].onClick();
      expect(service.isShowing(SESSION)).toBe(false);
      expect(win.show).toHaveBeenCalledTimes(1);
      expect(win.focus).toHaveBeenCalledTimes(1);
      expect(win.restore).not.toHaveBeenCalled();
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("restores a minimized window first, then show + focus", () => {
      const { service, win, factory } = makeServiceWithWindow({
        focused: false,
        minimized: true,
      });
      service.notifyConfirmation(request());
      factory.created[0].onClick();
      const order = [
        win.restore.mock.invocationCallOrder[0],
        win.show.mock.invocationCallOrder[0],
        win.focus.mock.invocationCallOrder[0],
      ];
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it("still reveals the window when the request carries no onClick", () => {
      const { service, win, factory } = makeServiceWithWindow({
        focused: false,
      });
      service.notifyConfirmation(request());
      factory.created[0].onClick();
      expect(win.focus).toHaveBeenCalledTimes(1);
      expect(service.isShowing(SESSION)).toBe(false);
    });

    it("a click on an already-replaced notification closes only itself", () => {
      const { service, factory } = makeService({
        window: { focused: false },
      });
      service.notifyConfirmation(request());
      service.notifyConfirmation(request());
      factory.created[0].onClick();
      expect(service.isShowing(SESSION)).toBe(true);
      expect(factory.created[1].close).not.toHaveBeenCalled();
    });

    it("does not throw when the window is gone by the time of the click", () => {
      const { service, factory } = makeService({ window: null });
      service.notifyConfirmation(request());
      expect(() => factory.created[0].onClick()).not.toThrow();
    });
  });

  describe("close", () => {
    const background = { window: { focused: false } } as const;

    it("closes the notification and forgets the session", () => {
      const { service, factory } = makeService(background);
      service.notifyConfirmation(request());
      service.close(SESSION);
      expect(factory.created[0].close).toHaveBeenCalledTimes(1);
      expect(service.isShowing(SESSION)).toBe(false);
    });

    it("is a no-op for a session that has no notification", () => {
      const { service, factory } = makeService(background);
      expect(() => service.close(SESSION)).not.toThrow();
      service.notifyConfirmation(request());
      service.close(OTHER_SESSION);
      expect(factory.created[0].close).not.toHaveBeenCalled();
      expect(service.isShowing(SESSION)).toBe(true);
    });

    it("closeHost drops that host's sessions and leaves the others", () => {
      const { service, factory } = makeService(background);
      service.notifyConfirmation(request());
      service.notifyConfirmation(
        request({ session: { host: "ssh-box", sessionId: "sess-1" } }),
      );
      service.closeHost("local");
      expect(service.isShowing(SESSION)).toBe(false);
      expect(service.isShowing({ host: "ssh-box", sessionId: "sess-1" })).toBe(
        true,
      );
      expect(factory.created[1].close).not.toHaveBeenCalled();
    });

    it("closeAll drops everything", () => {
      const { service } = makeService(background);
      service.notifyConfirmation(request());
      service.notifyConfirmation(request({ session: OTHER_SESSION }));
      service.closeAll();
      expect(service.isShowing(SESSION)).toBe(false);
      expect(service.isShowing(OTHER_SESSION)).toBe(false);
    });
  });

  // 等级与提示音只来自设置（deps.getLevel / deps.getSound，每次发通知现读），
  // 请求入参不带 level。mark 与 off 都不弹窗；mark 多出来的角标 / 闪烁在下面
  // 「attention」里测。
  describe("level and sound (spec story 3)", () => {
    const background = { window: { focused: false } } as const;

    it.each(["mark", "off"] as const)(
      "posts nothing while the channel's level is %s",
      (level) => {
        const { service, factory } = makeService({
          ...background,
          deps: { getLevel: () => level },
        });
        expect(service.notifyConfirmation(request())).toBe(false);
        expect(service.notifyTurnEnd(turnEnd())).toBe(false);
        expect(factory.created).toHaveLength(0);
      },
    );

    it("reads the level per channel", () => {
      const { service, factory } = makeService({
        ...background,
        deps: {
          getLevel: (channel) => (channel === "question" ? "off" : "banner"),
        },
      });
      expect(service.notifyConfirmation(request({ channel: "question" }))).toBe(
        false,
      );
      expect(
        service.notifyConfirmation(request({ channel: "permission" })),
      ).toBe(true);
      expect(factory.created.map((c) => c.options.body)).toEqual([
        "命令执行待确认：pnpm test",
      ]);
    });

    it("posts at level banner — the out-of-box default", () => {
      const { service, factory } = makeService(background);
      expect(service.notifyConfirmation(request())).toBe(true);
      expect(factory.created).toHaveLength(1);
    });

    it("an off request neither posts nor retracts — the on-screen one goes via closeChannel (即时生效)", () => {
      // 等级刚被调低时屏上那条由宿主撤（handleSetNotificationSettings →
      // closeChannel，按类别）；service 的 off 分支不碰它。
      let level: NotificationLevel = "banner";
      const { service, factory, attention } = makeService({
        ...background,
        deps: { getLevel: () => level },
      });
      service.notifyConfirmation(request());
      expect(service.isShowing(SESSION)).toBe(true);

      level = "off";
      expect(service.notifyConfirmation(request())).toBe(false);
      expect(factory.created).toHaveLength(1);
      expect(factory.created[0].close).not.toHaveBeenCalled();
      expect(service.isShowing(SESSION)).toBe(true);
      // Still counted from before: an off request neither adds nor removes.
      expect(attention.setBadgeCount).toHaveBeenCalledTimes(1);

      service.closeChannel("permission");
      expect(factory.created[0].close).toHaveBeenCalledTimes(1);
      expect(service.isShowing(SESSION)).toBe(false);
    });

    it("an off request leaves the session's notification of another channel on screen", () => {
      // 同会话 permission 的 banner 挂着，question（关闭）到达：不撤 —— 撤屏上那条
      // 是宿主按类别做的事，service 不看类别地撤会误伤。
      const { service, factory, attention } = makeService({
        ...background,
        deps: {
          getLevel: (channel) => (channel === "question" ? "off" : "banner"),
        },
      });
      expect(service.notifyConfirmation(request())).toBe(true);
      expect(service.notifyConfirmation(request({ channel: "question" }))).toBe(
        false,
      );
      expect(factory.created).toHaveLength(1);
      expect(factory.created[0].close).not.toHaveBeenCalled();
      expect(service.isShowing(SESSION)).toBe(true);
      expect(attention.setBadgeCount).toHaveBeenCalledTimes(1);
    });

    it("mutes the OS notification while the sound is off (scenario 5)", () => {
      notificationMock.__reset();
      const service = new NotificationService({
        getWindow: () => makeWindow({ focused: false }),
        ...BANNER_SETTINGS,
        attention: makeAttention(),
        getSound: () => false,
      });
      expect(service.notifyTurnEnd(turnEnd())).toBe(true);
      // Through the default factory, so silent has to reach new Notification(options).
      expect(notificationMock.__instances()[0].options.silent).toBe(true);
    });

    it("leaves it audible while the sound is on", () => {
      notificationMock.__reset();
      const service = new NotificationService({
        getWindow: () => makeWindow({ focused: false }),
        ...BANNER_SETTINGS,
        attention: makeAttention(),
        getSound: () => true,
      });
      expect(service.notifyTurnEnd(turnEnd())).toBe(true);
      expect(notificationMock.__instances()[0].options.silent).toBe(false);
    });
  });

  // The window-probe / liveness / level / close rules are the same code path
  // as notifyConfirmation (tested above); what is specific to a finished turn
  // is its rank below a waiting confirmation (scenario 5) and the merge.
  describe("notifyTurnEnd (spec story 2)", () => {
    const background = { window: { focused: false } } as const;

    it("stays silent while the window is in front (scenario 4)", () => {
      const { service, factory } = makeService();
      expect(service.notifyTurnEnd(turnEnd())).toBe(false);
      expect(factory.created).toHaveLength(0);
    });

    it("notifies when the window is unfocused and passes the body through", () => {
      const { service, factory } = makeService(background);
      expect(service.notifyTurnEnd(turnEnd())).toBe(true);
      expect(factory.created).toHaveLength(1);
      expect(factory.created[0].options).toEqual({
        title: "任务A",
        body: "已完成",
        icon: "/fake/icon.png",
        silent: false,
      });
      expect(factory.created[0].show).toHaveBeenCalledTimes(1);
    });

    it("yields to the session's waiting confirmation instead of replacing it (scenario 5)", () => {
      const { service, factory } = makeService(background);
      service.notifyConfirmation(request());
      const confirmation = factory.created[0];
      expect(confirmation.show).toHaveBeenCalledTimes(1);

      expect(service.notifyTurnEnd(turnEnd())).toBe(false);
      // Nothing new built, and the confirmation notification is left alone.
      expect(factory.created).toHaveLength(1);
      expect(confirmation.close).not.toHaveBeenCalled();
      expect(service.isShowing(SESSION)).toBe(true);
    });

    it("yields even when the turn-end level would have retracted it", () => {
      // A non-banner idle level normally closes the session's notification on
      // its way out — it must not get the chance while a confirmation is showing.
      const { service, factory } = makeService({
        ...background,
        deps: {
          getLevel: (channel) => (channel === "idle" ? "off" : "banner"),
        },
      });
      service.notifyConfirmation(request());
      expect(service.notifyTurnEnd(turnEnd())).toBe(false);
      expect(factory.created[0].close).not.toHaveBeenCalled();
    });

    it("still lets a confirmation take over a turn-end notification (priority is one-way)", () => {
      const { service, factory } = makeService(background);
      service.notifyTurnEnd(turnEnd());
      expect(service.notifyConfirmation(request())).toBe(true);
      // The turn-end one is retracted, the confirmation is on screen.
      expect(factory.created).toHaveLength(2);
      expect(factory.created[0].close).toHaveBeenCalledTimes(1);
      expect(factory.created[1].options.body).toBe("命令执行待确认：pnpm test");
      expect(factory.created[1].show).toHaveBeenCalledTimes(1);
    });

    it("merges two finished turns of one session into a single notification", () => {
      const { service, factory } = makeService(background);
      service.notifyTurnEnd(turnEnd());
      service.notifyTurnEnd(turnEnd({ body: "任务出错，需要你查看" }));
      expect(factory.created).toHaveLength(2);
      expect(factory.created[0].close).toHaveBeenCalledTimes(1);
      expect(factory.created[1].show).toHaveBeenCalledTimes(1);
      expect(factory.created[1].options.body).toBe("任务出错，需要你查看");
      expect(service.isShowing(SESSION)).toBe(true);
    });

    it("notifies again after the earlier one was closed", () => {
      const { service, factory } = makeService(background);
      service.notifyTurnEnd(turnEnd());
      service.close(SESSION);
      expect(service.notifyTurnEnd(turnEnd())).toBe(true);
      expect(factory.created).toHaveLength(2);
      expect(factory.created[1].show).toHaveBeenCalledTimes(1);
    });

    it("a click closes it, reveals the window and hands off to onClick (scenario 6)", () => {
      const onClick = vi.fn();
      const win = makeWindow({ focused: false });
      const factory = makeFactory();
      const service = new NotificationService({
        getWindow: () => win,
        isSupported: () => true,
        iconPath: "/fake/icon.png",
        createNotification: factory.createNotification,
        ...BANNER_SETTINGS,
        attention: makeAttention(),
      });
      service.notifyTurnEnd(turnEnd({ onClick }));
      factory.created[0].onClick();
      expect(service.isShowing(SESSION)).toBe(false);
      expect(factory.created[0].close).toHaveBeenCalledTimes(1);
      expect(win.show).toHaveBeenCalledTimes(1);
      expect(win.focus).toHaveBeenCalledTimes(1);
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  // 故事 4：任务栏闪烁 / Dock 弹跳 / 角标。角标数的是「等待确认的会话」——
  // banner / mark 请求到达就 +1（不管用户在不在场：角标是持久事实），只经 close
  // （等待结束）−1；闪 / 弹只在他不在时给，闪烁一轮只起一次、弹跳每个事件一次
  // （macOS 一秒自停），回前台（stopAttention）停、角标留到确认处理完。
  describe("attention (spec story 4)", () => {
    const background = { window: { focused: false } } as const;
    /** The last badge count the OS was handed (what the icon shows now). */
    const badge = (attention: ReturnType<typeof makeAttention>) =>
      attention.setBadgeCount.mock.calls.at(-1)?.[0];

    it("badges the number of waiting sessions and clears it once the last one resolves (scenario 1 / 4)", () => {
      const { service, attention } = makeService(background);
      service.notifyConfirmation(request());
      expect(badge(attention)).toBe(1);
      service.notifyConfirmation(
        request({ session: OTHER_SESSION, channel: "question" }),
      );
      expect(badge(attention)).toBe(2);

      service.close(SESSION);
      expect(badge(attention)).toBe(1);
      // One session still waiting → the flash must keep going.
      expect(attention.flashFrame).not.toHaveBeenCalledWith(false);

      service.close(OTHER_SESSION);
      expect(badge(attention)).toBe(0);
      expect(attention.flashFrame).toHaveBeenLastCalledWith(false);
    });

    it("counts a session once however many confirmations it stacks", () => {
      const { service, attention } = makeService(background);
      service.notifyConfirmation(
        request({ body: "命令执行待确认：pnpm test" }),
      );
      service.notifyConfirmation(
        request({ body: "命令执行待确认：pnpm lint" }),
      );
      expect(attention.setBadgeCount).toHaveBeenCalledTimes(1);
      expect(badge(attention)).toBe(1);
    });

    it("an off channel neither badges nor flashes (scenario 5)", () => {
      const { service, factory, attention } = makeService({
        ...background,
        deps: { getLevel: () => "off" },
      });
      expect(service.notifyConfirmation(request())).toBe(false);
      expect(factory.created).toHaveLength(0);
      expect(attention.setBadgeCount).not.toHaveBeenCalled();
      expect(attention.flashFrame).not.toHaveBeenCalled();
      expect(attention.bounce).not.toHaveBeenCalled();
    });

    it("a request that arrives while the user is in front badges but neither flashes nor bounces (scenario 1 / 2)", () => {
      // 角标是「有会话在等我」的持久事实，不随窗口状态变：在场时到达也 +1，
      // 用户切走后 Dock 上的数字才对；闪 / 弹是「叫你」，在场就不叫。
      const { service, factory, attention } = makeService(); // focused by default
      expect(service.notifyConfirmation(request())).toBe(false);
      expect(factory.created).toHaveLength(0);
      expect(badge(attention)).toBe(1);
      expect(attention.flashFrame).not.toHaveBeenCalled();
      expect(attention.bounce).not.toHaveBeenCalled();
      // A finished turn while present: nothing at all — it never badges.
      expect(service.notifyTurnEnd(turnEnd())).toBe(false);
      expect(attention.setBadgeCount).toHaveBeenCalledTimes(1);
      expect(attention.flashFrame).not.toHaveBeenCalled();
      expect(attention.bounce).not.toHaveBeenCalled();
    });

    it("a session that started waiting while the user was in front is already on the icon once they leave", () => {
      const probe = { focused: true };
      const { service, attention } = makeService({ window: probe });
      service.notifyConfirmation(request());
      expect(badge(attention)).toBe(1);
      expect(attention.flashFrame).not.toHaveBeenCalled();

      probe.focused = false;
      // 回合完成已经不闪了（故事 3 场景 1），换第二个会话的确认来起闪。
      service.notifyConfirmation(
        request({ session: OTHER_SESSION, channel: "question" }),
      );
      // The flash starts now (the user is away); the badge already said 1 and
      // goes straight to 2 — the icon never showed a wrong number in between.
      expect(attention.flashFrame).toHaveBeenCalledWith(true);
      expect(attention.setBadgeCount).toHaveBeenCalledTimes(2);
      expect(badge(attention)).toBe(2);
    });

    it("mark: no banner, but a badge and one flash (story 3 scenario 3)", () => {
      const { service, factory, attention } = makeService({
        ...background,
        deps: { getLevel: () => "mark" },
      });
      expect(service.notifyConfirmation(request())).toBe(false);
      expect(factory.created).toHaveLength(0);
      expect(badge(attention)).toBe(1);
      expect(attention.flashFrame).toHaveBeenCalledWith(true);
      expect(attention.bounce).toHaveBeenCalledTimes(1);
      // Still counted as waiting: resolving it clears the badge again.
      service.close(SESSION);
      expect(badge(attention)).toBe(0);
    });

    it("a finished turn neither flashes, bounces nor badges (story 3 场景 1 / 故事 4 场景 2)", () => {
      // 回合完成只有「弹窗提醒」「关闭」两档：它不计角标、也不闪不弹，
      //「仅标记」在它身上与「关闭」完全相同，所以没有那个档位。
      const { service, attention } = makeService(background);
      expect(service.notifyTurnEnd(turnEnd())).toBe(true);
      expect(attention.flashFrame).not.toHaveBeenCalled();
      expect(attention.bounce).not.toHaveBeenCalled();
      expect(attention.setBadgeCount).not.toHaveBeenCalled();
    });

    it("stopAttention (window back to front) stops the flash and the bounce, keeps the badge (scenario 3)", () => {
      const { service, attention } = makeService(background);
      service.notifyConfirmation(request());
      attention.flashFrame.mockClear();
      attention.cancelBounce.mockClear();

      service.stopAttention();

      expect(attention.flashFrame).toHaveBeenCalledTimes(1);
      expect(attention.flashFrame).toHaveBeenCalledWith(false);
      expect(attention.cancelBounce).toHaveBeenCalledTimes(1);
      expect(attention.setBadgeCount).toHaveBeenCalledTimes(1);
      expect(badge(attention)).toBe(1);
    });

    it("a focus with nothing flashing touches nothing", () => {
      const { service, attention } = makeService(background);
      // 没有任何事件 → 从没起过闪。
      service.stopAttention();
      attention.flashFrame.mockClear();
      attention.cancelBounce.mockClear();

      service.stopAttention();

      expect(attention.flashFrame).not.toHaveBeenCalled();
      expect(attention.cancelBounce).not.toHaveBeenCalled();
    });

    it("flashes once for a whole burst of events while the user is away, bounces per event, and again after a focus", () => {
      const { service, attention } = makeService(background);
      service.notifyConfirmation(request());
      service.notifyConfirmation(
        request({ session: OTHER_SESSION, channel: "question" }),
      );
      // 第三个事件仍是确认类（回合完成不闪了，故事 3 场景 1）：同一会话再来的
      // 一条不重计角标，所以下面的 badge 仍是 2。
      service.notifyConfirmation(request());
      // Flash: one round for the burst (Windows keeps flashing until stopped).
      expect(attention.flashFrame).toHaveBeenCalledTimes(1);
      expect(attention.flashFrame).toHaveBeenCalledWith(true);
      // Bounce: once per event — macOS's informational bounce stops by itself
      // after a second, so a guarded bounce would swallow the later events.
      expect(attention.bounce).toHaveBeenCalledTimes(3);
      expect(badge(attention)).toBe(2);

      // Back to front → away again: the guard was reset on focus, so the next
      // event starts a fresh flash round (and bounces again).
      service.stopAttention();
      service.notifyConfirmation(request());
      expect(attention.flashFrame.mock.calls).toEqual([
        [true],
        [false],
        [true],
      ]);
      expect(attention.bounce).toHaveBeenCalledTimes(4);
    });

    it("degrades silently when the platform has no dock / badge / flash (scenario 6)", () => {
      const { service, factory, attention } = makeService(background);
      attention.flashFrame.mockImplementation(() => {
        throw new Error("Object has been destroyed");
      });
      attention.bounce.mockImplementation(() => {
        throw new Error("no dock here");
      });
      attention.setBadgeCount.mockImplementation(() => {
        throw new Error("no badge here");
      });
      expect(() => service.notifyConfirmation(request())).not.toThrow();
      // The banner itself is unaffected.
      expect(factory.created[0].show).toHaveBeenCalledTimes(1);
      // Nor are the later signals (stop on focus, clear on close).
      expect(() => {
        service.stopAttention();
        service.close(SESSION);
      }).not.toThrow();
      expect(factory.created[0].close).toHaveBeenCalledTimes(1);
    });

    it("a click retracts the banner but the session keeps its badge until the confirmation resolves", () => {
      const { service, factory, attention } = makeService(background);
      service.notifyConfirmation(request());
      factory.created[0].onClick();
      expect(service.isShowing(SESSION)).toBe(false);
      expect(attention.setBadgeCount).toHaveBeenCalledTimes(1);
      expect(badge(attention)).toBe(1);
    });

    it("closeChannel retracts only that channel's notification and leaves the badge alone", () => {
      const { service, factory, attention } = makeService(background);
      service.notifyConfirmation(request());
      service.notifyTurnEnd(turnEnd({ session: OTHER_SESSION }));

      service.closeChannel("idle");

      expect(factory.created[1].close).toHaveBeenCalledTimes(1);
      expect(factory.created[0].close).not.toHaveBeenCalled();
      expect(service.isShowing(SESSION)).toBe(true);
      expect(service.isShowing(OTHER_SESSION)).toBe(false);
      expect(attention.setBadgeCount).toHaveBeenCalledTimes(1);
      expect(badge(attention)).toBe(1);
    });

    it("closeHost clears the badge along with the notifications (host disconnect)", () => {
      const { service, attention } = makeService(background);
      service.notifyConfirmation(request());
      service.notifyConfirmation(
        request({ session: { host: "ssh-box", sessionId: "sess-9" } }),
      );
      expect(badge(attention)).toBe(2);
      service.closeHost("ssh-box");
      expect(badge(attention)).toBe(1);
      service.closeAll();
      expect(badge(attention)).toBe(0);
      expect(attention.flashFrame).toHaveBeenLastCalledWith(false);
    });

    // 下面两条钉的是同一个缺口的两个出口：在场时到达的确认只计数、没有横幅，
    // 不在 `active` 里 —— closeHost / closeAll 若只扫屏上那条，角标就卡在 N 直到
    // 重启（SSH 断连 → dropHostAgents → closeHost 正是这条路径）。切走后让另一个
    // host 的回合完成把闪开起来：stopAttention 只在真的在闪时才发 flashFrame(false)，
    // 在场到达的确认从不闪，不补这一下那条断言就是空话。
    it("closeHost also clears a confirmation that arrived while the user was in front (no banner to sweep)", () => {
      const probe = { focused: true };
      const { service, factory, attention } = makeService({ window: probe });
      const REMOTE = { host: "ssh-box", sessionId: "sess-1" } as const;
      service.notifyConfirmation(request({ session: REMOTE }));
      expect(badge(attention)).toBe(1);
      expect(factory.created).toHaveLength(0);
      expect(service.isShowing(REMOTE)).toBe(false);
      probe.focused = false;
      // 回合完成已经不闪了（故事 3 场景 1）：用**同一会话**再来一条确认起闪 ——
      // 同会话不重计角标，badge 仍是 1。另外给 local 造一条横幅，验证不越界。
      service.notifyConfirmation(request({ session: REMOTE }));
      service.notifyTurnEnd(turnEnd({ session: OTHER_SESSION }));
      expect(attention.flashFrame).toHaveBeenCalledWith(true);

      service.closeHost("ssh-box");

      expect(attention.setBadgeCount).toHaveBeenLastCalledWith(0);
      expect(attention.flashFrame).toHaveBeenLastCalledWith(false);
      // 别的 host 的通知不归它管。
      expect(service.isShowing(OTHER_SESSION)).toBe(true);
    });

    it("closeAll also clears a confirmation that arrived while the user was in front", () => {
      const probe = { focused: true };
      const { service, factory, attention } = makeService({ window: probe });
      service.notifyConfirmation(request());
      expect(badge(attention)).toBe(1);
      expect(factory.created).toHaveLength(0);
      probe.focused = false;
      // 同上：同会话再来一条确认才起闪（回合完成不闪了）。
      service.notifyConfirmation(request());
      service.notifyTurnEnd(turnEnd({ session: OTHER_SESSION }));
      expect(attention.flashFrame).toHaveBeenCalledWith(true);

      service.closeAll();

      expect(attention.setBadgeCount).toHaveBeenLastCalledWith(0);
      expect(attention.flashFrame).toHaveBeenLastCalledWith(false);
      expect(service.isShowing(OTHER_SESSION)).toBe(false);
    });

    it("「通知时提醒我」关闭时确认类不闪不弹，但横幅与角标照旧（故事 3 场景 6）", () => {
      const { service, factory, attention } = makeService({
        ...background,
        deps: { getDrawAttention: () => false },
      });
      expect(service.notifyConfirmation(request())).toBe(true);
      // 开关只管闪 / 弹：系统通知（故事 1）与角标（故事 4 场景 1）不受影响。
      expect(factory.created).toHaveLength(1);
      expect(factory.created[0].show).toHaveBeenCalledTimes(1);
      expect(badge(attention)).toBe(1);
      expect(attention.flashFrame).not.toHaveBeenCalled();
      expect(attention.bounce).not.toHaveBeenCalled();
    });

    it("「通知时提醒我」每次事件现读（改完即时生效）", () => {
      let draw = false;
      const { service, attention } = makeService({
        ...background,
        deps: { getDrawAttention: () => draw },
      });
      service.notifyConfirmation(request());
      expect(attention.bounce).not.toHaveBeenCalled();

      draw = true;
      service.notifyConfirmation(
        request({ body: "命令执行待确认：pnpm lint" }),
      );
      expect(attention.flashFrame).toHaveBeenCalledWith(true);
      expect(attention.bounce).toHaveBeenCalledTimes(1);
    });
  });
});

describe("oneLine", () => {
  it("collapses every whitespace run into a single space", () => {
    expect(oneLine("  pnpm test\n\n  --filter \t desktop  ")).toBe(
      "pnpm test --filter desktop",
    );
  });

  it("keeps a string at the limit intact", () => {
    expect(oneLine("x".repeat(120))).toBe("x".repeat(120));
  });

  it("truncates past the limit with an ellipsis", () => {
    expect(oneLine("x".repeat(121))).toBe("x".repeat(120) + "…");
    expect(oneLine("abcdef", 3)).toBe("abc…");
  });
});

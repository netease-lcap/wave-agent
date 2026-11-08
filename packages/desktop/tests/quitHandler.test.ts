import { describe, it, expect, vi } from "vitest";
import { createQuitHandler } from "../src/main/quitHandler.js";

const createHarness = (
  overrides: Partial<Parameters<typeof createQuitHandler>[0]> = {},
) => {
  const dispose = vi.fn(async () => undefined);
  const quit = vi.fn();
  const exit = vi.fn();
  const event = { preventDefault: vi.fn() };
  const handler = createQuitHandler({
    dispose,
    quit,
    exit,
    // Keep the fallback timer out of the way unless a test asks for it.
    fallbackMs: 60_000,
    ...overrides,
  });
  return { dispose, quit, exit, event, handler };
};

describe("createQuitHandler", () => {
  it("holds the first quit and disposes the host", () => {
    const { dispose, quit, exit, event, handler } = createHarness();

    handler(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("finishes through app.quit — never app.exit — so crashpad is reaped", async () => {
    const { quit, exit, event, handler } = createHarness();

    handler(event);
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
    expect(exit).not.toHaveBeenCalled();
  });

  it("lets the second pass through (our own quit) proceed", async () => {
    const { dispose, quit, event, handler } = createHarness();

    handler(event);
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));

    // Electron re-fires `before-quit` for the quit() above.
    handler(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it("still quits when dispose rejects, and reports the failure", async () => {
    const error = new Error("destroy RPC failed");
    const onDisposeError = vi.fn();
    const { quit, exit, event, handler } = createHarness({
      dispose: vi.fn(async () => {
        throw error;
      }),
      onDisposeError,
    });

    handler(event);
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
    expect(onDisposeError).toHaveBeenCalledWith(error);
    expect(exit).not.toHaveBeenCalled();
  });

  it("stops waiting on a hung dispose once the timeout fires", async () => {
    const { quit, exit, event, handler } = createHarness({
      dispose: vi.fn(() => new Promise<void>(() => {})),
      disposeTimeoutMs: 10,
    });

    handler(event);
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
    expect(exit).not.toHaveBeenCalled();
  });

  it("hard-exits only when the ordinary quit stalls", async () => {
    const { quit, exit, event, handler } = createHarness({ fallbackMs: 10 });

    handler(event);
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });

  describe("confirmQuit (spec desktop-shell「退出时保护运行中的会话」)", () => {
    it("asks first and drops the quit when the user cancels", async () => {
      const confirmQuit = vi.fn(async () => false);
      const onQuitConfirmed = vi.fn();
      const { dispose, quit, event, handler } = createHarness({
        confirmQuit,
        onQuitConfirmed,
      });

      handler(event);
      await vi.waitFor(() => expect(confirmQuit).toHaveBeenCalledTimes(1));

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(dispose).not.toHaveBeenCalled();
      expect(quit).not.toHaveBeenCalled();
      // 「正在退出」的 latch 不能在取消后置位（否则关窗即隐藏会永久失效）。
      expect(onQuitConfirmed).not.toHaveBeenCalled();
    });

    it("asks again on the next attempt after a cancel", async () => {
      const confirmQuit = vi.fn(async () => false);
      const { event, handler } = createHarness({ confirmQuit });

      handler(event);
      await vi.waitFor(() => expect(confirmQuit).toHaveBeenCalledTimes(1));
      handler(event);
      await vi.waitFor(() => expect(confirmQuit).toHaveBeenCalledTimes(2));
    });

    it("does not stack a second dialog while one is open", async () => {
      let release: (proceed: boolean) => void = () => {};
      const confirmQuit = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            release = resolve;
          }),
      );
      const { event, handler } = createHarness({ confirmQuit });

      handler(event);
      // 菜单 / Ctrl+Q / 托盘「退出」都能在弹框期间再触发一次 before-quit。
      handler(event);
      handler(event);
      expect(confirmQuit).toHaveBeenCalledTimes(1);

      release(true);
    });

    it("disposes only after the user confirms", async () => {
      const order: string[] = [];
      const { quit, event, handler } = createHarness({
        confirmQuit: async () => {
          order.push("confirm");
          return true;
        },
        onQuitConfirmed: () => order.push("confirmed"),
        dispose: async () => {
          order.push("dispose");
        },
      });

      handler(event);
      await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
      expect(order).toEqual(["confirm", "confirmed", "dispose"]);
    });

    it("still quits when the confirm itself fails", async () => {
      const { quit, event, handler } = createHarness({
        confirmQuit: async () => {
          throw new Error("dialog unavailable");
        },
      });

      handler(event);
      await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
    });
  });
});

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
});

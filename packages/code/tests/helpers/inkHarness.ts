import { EventEmitter } from "node:events";
import type React from "react";
import { render as inkRender, type Instance } from "ink";

export interface WindowSize {
  columns?: number;
  rows?: number;
}

/**
 * In-repo replacement for `ink-testing-library@4` (last published 2024-05-22,
 * no maintainer response to the open `waitFor`/`renderHook` request).
 *
 * The fake streams and the `render` options are copied verbatim from it, so a
 * file switching over keeps the exact same behaviour — 76 test files and 3
 * examples import this module now. Two things it drops are added back:
 *
 * 1. `stdout.write` invokes the completion callback. ink's
 *    `waitUntilRenderFlush()` awaits `stdout.write('', callback)`, and the
 *    library's fake stream never called it, so that await could never settle.
 * 2. `flush()` / `settle()`, exposed from the ink instance. `settle()` is the
 *    deterministic way to wait for an input-driven frame: a key press, a
 *    `rerender()` or a synchronous mock callback schedules work that
 *    `waitUntilRenderFlush()` completes in one or two passes, with no polling
 *    interval and no `sleep`. It cannot wait for a timer, a promise or a
 *    socket — those still land later, so keep `vi.waitFor` for them. `settle()`
 *    reports "no new frame since the last flush", which is not the same as
 *    "nothing is pending": `settleUntil(predicate)` waits for the state a
 *    pending commit would produce instead (see its own note).
 */
class FakeStdout extends EventEmitter {
  readonly columns: number;
  // `rows` has to be declared too, even though almost nothing reads it: ink's
  // `getWindowSize()` trusts the stream only when *both* dimensions are
  // present, and otherwise resolves the real terminal through the
  // `terminal-size` package — with **synchronous `execFileSync` spawns**
  // (`tput`, `resize`, `/dev/tty`). ink asks once per layout pass, so a missing
  // `rows` put a child-process spawn on every rendered frame: 4486 of them
  // across this package's unit suite, ~3ms each here but an order of magnitude
  // more on the Windows runner. That is what made this suite flaky on Windows
  // (2026-10-27): a frame there costs so much that `vi.waitFor`'s 1s budget no
  // longer covers the second commit a self-measuring component needs
  // (PlanView's scroll indicators, the /btw pager) and `testTimeout` (5s) runs
  // out on ChatInterface's mount — reproduced on Linux by only making that
  // spawn slower. 24 is the value the fallback used to produce, so no test's
  // layout changes; it also stops the size from depending on whoever runs the
  // suite (a real terminal answers with *its* height).
  readonly rows: number;
  frames: string[] = [];

  constructor(size: WindowSize = {}) {
    super();
    this.columns = size.columns ?? 100;
    this.rows = size.rows ?? 24;
  }

  private lastWritten?: string;

  write = (data: unknown, callback?: () => void) => {
    const frame = String(data ?? "");
    // ink writes '' together with a callback as a flush barrier from
    // waitUntilRenderFlush(); that is not a rendered frame. An empty frame
    // without a callback is real output — components that render nothing write
    // one, and tests assert lastFrame() === '' for them.
    const isFlushBarrier = frame.length === 0 && typeof callback === "function";
    if (!isFlushBarrier) {
      this.frames.push(frame);
      this.lastWritten = frame;
    }
    if (typeof callback === "function") {
      queueMicrotask(callback);
    }
    return true;
  };

  lastFrame = () => this.lastWritten;
}

class FakeStderr extends FakeStdout {}

class FakeStdin extends EventEmitter {
  isTTY = true;
  private data: string | null = null;

  write = (data: string) => {
    this.data = data;
    this.emit("readable");
    this.emit("data", data);
  };

  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}

  read = () => {
    const { data } = this;
    this.data = null;
    return data;
  };
}

const instances: Instance[] = [];

export const render = (tree: React.ReactElement, size: WindowSize = {}) => {
  const stdout = new FakeStdout(size);
  const stderr = new FakeStderr(size);
  const stdin = new FakeStdin();
  const instance = inkRender(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  instances.push(instance);

  const flush = () => instance.waitUntilRenderFlush();

  return {
    rerender: instance.rerender,
    unmount: instance.unmount,
    cleanup: instance.cleanup,
    stdout,
    stderr,
    stdin,
    frames: stdout.frames,
    lastFrame: stdout.lastFrame,
    flush,
    /**
     * Flush until the output stops changing. One flush is not always enough:
     * the first commit of a component that measures itself (e.g. `useBoxMetrics`)
     * schedules a second one, which is why mount needs two passes. Returns the
     * number of passes it took.
     */
    settle: async () => {
      let previous: string | undefined;
      for (let pass = 0; pass < 10; pass++) {
        await flush();
        const current = stdout.lastFrame();
        if (current === previous) {
          return pass;
        }
        previous = current;
      }
      throw new Error("output never settled after 10 flushes");
    },
    /**
     * Flush until the frame satisfies `ready`, then return.
     *
     * `settle()` stops on the first pair of identical frames, which proves "the
     * last flush produced no new frame" — *not* "nothing is pending". A
     * component that measures itself emits a frame byte-identical to the
     * previous one before the commit that uses the measurement (the measured
     * height changes state that does not change the output), so a `settle()`
     * that lands on that pair returns one commit early. That is invisible to an
     * assertion about the frame itself, but not to a key press: input delivered
     * one commit early hits the pre-measurement state (the /btw pager refuses
     * arrow keys until it knows the content overflows, `useLineScroll`'s
     * `if (!canScroll) return`), the key is dropped, and the case fails on a
     * frame that is one commit stale — rare, and only on a machine slow enough
     * for the scheduler to need an extra turn (Windows CI).
     *
     * So callers that are about to feed input into a component whose readiness
     * is visible in the frame wait for that state instead of for "no new
     * frame". `what` names the state in the failure: a frame that never shows
     * up is a failure that says which one, not a hang. `timeoutMs` only bounds
     * that failure — it is not a settle budget, so keep it far above what a
     * frame costs (a full frame is ~120ms on the Windows runner).
     */
    settleUntil: async (
      ready: (frame: string) => boolean,
      what: string,
      timeoutMs = 2000,
    ) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        await flush();
        const current = stdout.lastFrame() ?? "";
        if (ready(current)) {
          return;
        }
        if (Date.now() >= deadline) {
          throw new Error(
            `frame never ${what} within ${timeoutMs}ms; last frame:\n${current}`,
          );
        }
      }
    },
  };
};

export const cleanup = () => {
  for (const instance of instances.splice(0)) {
    instance.unmount();
    instance.cleanup();
  }
};

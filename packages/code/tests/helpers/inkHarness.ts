import { EventEmitter } from "node:events";
import type React from "react";
import { render as inkRender, type Instance } from "ink";

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
 *    socket — those still land later, so keep `vi.waitFor` for them.
 */
class FakeStdout extends EventEmitter {
  readonly columns = 100;
  frames: string[] = [];
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

export const render = (tree: React.ReactElement) => {
  const stdout = new FakeStdout();
  const stderr = new FakeStderr();
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
  };
};

export const cleanup = () => {
  for (const instance of instances.splice(0)) {
    instance.unmount();
    instance.cleanup();
  }
};

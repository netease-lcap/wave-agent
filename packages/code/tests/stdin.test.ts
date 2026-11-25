import { EventEmitter } from "node:events";
import { test, expect, vi, afterEach } from "vitest";
import { readPipedStdin } from "../src/utils/stdin.js";

/** Stand-in for process.stdin: an EventEmitter with the two fields we read. */
class FakeStdin extends EventEmitter {
  isTTY?: boolean;
  encoding?: BufferEncoding;
  setEncoding(encoding: BufferEncoding): void {
    this.encoding = encoding;
  }
}

const stderrWriteSpy = vi
  .spyOn(process.stderr, "write")
  .mockImplementation(() => true);

afterEach(() => {
  stderrWriteSpy.mockClear();
  vi.useRealTimers();
});

test("a TTY is never read — an interactive `wave -p 'msg'` must not wait for input", async () => {
  const stdin = new FakeStdin();
  stdin.isTTY = true;

  await expect(readPipedStdin(stdin, 50)).resolves.toBe("");

  expect(stdin.listenerCount("data")).toBe(0);
  expect(stderrWriteSpy).not.toHaveBeenCalled();
});

test("a pipe is decoded as utf8 and concatenated until the stream ends", async () => {
  const stdin = new FakeStdin();

  const prompt = readPipedStdin(stdin, 50);
  stdin.emit("data", "只回复两个字：");
  stdin.emit("data", "收到");
  stdin.emit("end");

  await expect(prompt).resolves.toBe("只回复两个字：收到");
  expect(stdin.encoding).toBe("utf8");
  expect(stderrWriteSpy).not.toHaveBeenCalled();
});

test("an idle pipe is abandoned after the peek window instead of hanging the run", async () => {
  vi.useFakeTimers();
  const stdin = new FakeStdin();

  const prompt = readPipedStdin(stdin, 3000);
  await vi.advanceTimersByTimeAsync(3000);

  await expect(prompt).resolves.toBe("");
  // The warning is the whole point: a silent pipe must not look like an empty one.
  expect(stderrWriteSpy).toHaveBeenCalledTimes(1);
  expect(stderrWriteSpy).toHaveBeenCalledWith(
    expect.stringContaining("no stdin data in 3s"),
  );
  expect(stdin.listenerCount("data")).toBe(0);
});

test("data that arrives within the peek window keeps the wait open until EOF", async () => {
  vi.useFakeTimers();
  const stdin = new FakeStdin();

  const prompt = readPipedStdin(stdin, 3000);
  stdin.emit("data", "长 prompt");
  // Past the peek window: the first chunk cancels the timeout, so we still wait.
  await vi.advanceTimersByTimeAsync(10_000);
  expect(stderrWriteSpy).not.toHaveBeenCalled();

  stdin.emit("end");
  await expect(prompt).resolves.toBe("长 prompt");
});

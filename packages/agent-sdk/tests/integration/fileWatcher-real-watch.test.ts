/**
 * Real-watcher integration tests for FileWatcherService.
 *
 * Unlike tests/services/fileWatcher.test.ts (which mocks chokidar), these
 * tests use the real chokidar FSWatcher against real files in a temp
 * directory: create/change/delete events must arrive through the actual
 * inotify (or native fallback) machinery.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  FileWatcherService,
  type FileWatchEvent,
} from "../../src/services/fileWatcher.js";

/** Poll for `count` events; real fs events have no deterministic latency. */
async function waitForEvents(
  events: FileWatchEvent[],
  count: number,
  timeoutMs = 10_000,
): Promise<void> {
  const start = Date.now();
  while (events.length < count) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out waiting for ${count} watcher events (got ${events.length}: ${JSON.stringify(events)})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("FileWatcherService with real chokidar", () => {
  let dir: string;
  let service: FileWatcherService;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-watch-real-"));
    service = new FileWatcherService(undefined, {
      // Keep the test fast: lower the awaitWriteFinish stability window.
      stabilityThreshold: 100,
      pollInterval: 50,
    });
  });

  afterAll(async () => {
    await service.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fires a change event when a watched file is modified", async () => {
    const file = path.join(dir, "watched.txt");
    fs.writeFileSync(file, "v1");

    const events: FileWatchEvent[] = [];
    await service.watchFile(file, (event) => events.push(event));
    // Let chokidar finish registering the path before writing.
    await new Promise((resolve) => setTimeout(resolve, 200));

    fs.writeFileSync(file, "v2");
    await waitForEvents(events, 1);

    expect(events[0].type).toBe("change");
    expect(events[0].path).toBe(file);
  });

  it("fires create and delete events for a file created after watching", async () => {
    const file = path.join(dir, "created-later.txt");

    const events: FileWatchEvent[] = [];
    await service.watchFile(file, (event) => events.push(event));
    await new Promise((resolve) => setTimeout(resolve, 200));

    fs.writeFileSync(file, "hi");
    await waitForEvents(events, 1);
    expect(events[0].type).toBe("create");

    fs.unlinkSync(file);
    await waitForEvents(events, 2);
    expect(events[1].type).toBe("delete");
    expect(events[1].path).toBe(file);
  });

  it("exposes watcher status once active", async () => {
    const file = path.join(dir, "status.txt");
    fs.writeFileSync(file, "x");

    await service.watchFile(file, () => {});
    await new Promise((resolve) => setTimeout(resolve, 200));

    const status = service.getWatcherStatus(file);
    expect(status?.isActive).toBe(true);
  });
});

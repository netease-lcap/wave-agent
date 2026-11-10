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
import { skillWatcherOptions } from "../../src/managers/skillManager.js";
import { longFormTempDir } from "../helpers/tempDir.js";

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

/** Poll until an event matching `predicate` arrives; real fs events have no
 *  deterministic latency. */
async function waitForEventMatching(
  events: FileWatchEvent[],
  predicate: (event: FileWatchEvent) => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const start = Date.now();
  while (!events.some(predicate)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out waiting for a matching watcher event (got ${JSON.stringify(events)})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("FileWatcherService with real chokidar", () => {
  let dir: string;
  let service: FileWatcherService;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(longFormTempDir(), "wave-watch-real-"));
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

  /**
   * Regression for Windows 8.3 short paths. `%TEMP%` is configured with a
   * short name on some machines (`C:\Users\LIUYIQ~1\...`), and watching such a
   * path aborts the whole process inside libuv's fs-event backend on the first
   * event (Node >= 25 / libuv 1.52). Deliberately uses `os.tmpdir()` verbatim —
   * the opposite of `longFormTempDir()`, which the tests above use to keep
   * their own environment healthy, so that this test keeps exercising the
   * watcher's own short-path handling.
   *
   * Watches a *directory* (as `skillManager` does): libuv only computes the
   * relative event name — and therefore only asserts — when the handle is a
   * directory handle.
   */
  it("survives a watch root under the raw os.tmpdir()", async () => {
    const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-watch-short-"));
    const skillsDir = path.join(rawDir, "skills");
    fs.mkdirSync(skillsDir);

    const events: FileWatchEvent[] = [];
    await service.watchFile(skillsDir, (event) => events.push(event));
    await new Promise((resolve) => setTimeout(resolve, 200));

    fs.writeFileSync(path.join(skillsDir, "SKILL.md"), "v1");
    await waitForEvents(events, 1);

    expect(events[0].type).toBe("create");
    fs.rmSync(rawDir, { recursive: true, force: true });
  });

  /**
   * Regression for #2864. Skills are the one watched tree that other
   * processes install into: the installer unpacks into a staging directory
   * and `rename()`s it into place, and an upgrade renames the installed
   * directory away. On Windows native `fs.watch` holds a handle per watched
   * directory and renaming a directory with a *watched descendant* fails with
   * `EPERM`, so the observed install returned "unexpected failure"
   * (`skillWatcherOptions` explains the two mitigations).
   *
   * Uses its own root (not `dir`, which the shared service already watches)
   * so that no other watcher's handles can influence the renames.
   */
  it("never blocks an installer's staging-dir rename", async () => {
    const rootBase = fs.mkdtempSync(
      path.join(longFormTempDir(), "wave-skill-watch-"),
    );
    const skillsRoot = path.join(rootBase, "skills");
    fs.mkdirSync(skillsRoot);

    const skillService = new FileWatcherService(undefined, {
      ...skillWatcherOptions(),
      // Keep the test fast: the skill watcher polls at 1s in production.
      stabilityThreshold: 100,
      pollInterval: 200,
    });
    const events: FileWatchEvent[] = [];
    await skillService.watchFile(skillsRoot, (event) => events.push(event));
    await new Promise((resolve) => setTimeout(resolve, 600));

    try {
      // What an installer unpacks before renaming it into place: a nested
      // directory is what makes the rename fail under native watching.
      const staging = path.join(skillsRoot, ".lazy-recipes.install-1b2c3d");
      fs.mkdirSync(path.join(staging, "scripts"), { recursive: true });
      fs.writeFileSync(
        path.join(staging, "SKILL.md"),
        "---\nname: lazy\n---\n",
      );
      fs.writeFileSync(path.join(staging, "scripts", "run.sh"), "echo hi\n");
      // A native watcher needs a moment to attach a handle to the new
      // subtree — exactly the window in which the install used to fail.
      await new Promise((resolve) => setTimeout(resolve, 1500));

      expect(() =>
        fs.renameSync(staging, path.join(skillsRoot, "lazy-recipes")),
      ).not.toThrow();

      // The skill landing is still picked up by hot reload.
      await waitForEventMatching(events, (event) =>
        event.path.endsWith("lazy-recipes"),
      );

      // Upgrading an installed skill renames a directory that has
      // subdirectories — the same EPERM, one level up.
      const installed = path.join(skillsRoot, "installed-skill");
      fs.mkdirSync(path.join(installed, "scripts"), { recursive: true });
      fs.writeFileSync(
        path.join(installed, "SKILL.md"),
        "---\nname: installed\n---\n",
      );
      await new Promise((resolve) => setTimeout(resolve, 1500));

      expect(() =>
        fs.renameSync(installed, path.join(skillsRoot, "installed-skill.old")),
      ).not.toThrow();
    } finally {
      await skillService.cleanup();
      fs.rmSync(rootBase, { recursive: true, force: true });
    }
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

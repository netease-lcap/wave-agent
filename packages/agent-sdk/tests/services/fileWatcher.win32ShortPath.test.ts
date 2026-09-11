/**
 * Windows 8.3 short-name watch roots.
 *
 * libuv's Windows fs-event backend normalizes each *event* path with
 * `GetLongPathNameW()` and then asserts it is prefixed by the watched
 * directory string (`uv__relative_path()`, src\win\fs-event.c). libuv <= 1.51
 * expanded the watched directory itself; since 1.52 (bundled by Node >= 25)
 * `handle->dirw` keeps whatever the caller passed, so watching an 8.3 short
 * path — e.g. `C:\Users\LIUYIQ~1\...`, which is what `os.tmpdir()` returns
 * when %TEMP% is configured with a short name — aborts the whole process on
 * the first event. That abort is not catchable, so the watch root must be
 * canonicalized before it reaches chokidar. These tests pin that behavior
 * with a mocked chokidar; fileWatcher-real-watch.test.ts covers the real
 * watcher.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as chokidar from "chokidar";
import {
  FileWatcherService,
  type FileWatchEvent,
} from "../../src/services/fileWatcher.js";

vi.mock("chokidar", () => {
  const mockWatcher = {
    add: vi.fn(),
    unwatch: vi.fn(),
    close: vi.fn(),
    on: vi.fn().mockReturnThis(),
  };
  return { watch: vi.fn(() => mockWatcher) };
});

const SHORT_ROOT = "C:/Users/LIUYIQ~1/ws";
const LONG_ROOT = "C:/Users/liuyiqi02/ws";

/** Models an 8.3 short-name root: only the root itself has a long form. */
function mockShortFormRoot(): void {
  vi.spyOn(fs.realpathSync, "native").mockImplementation((target) => {
    // The service walks up with platform separators; compare separator-agnostic.
    if (String(target).replace(/\\/g, "/") === SHORT_ROOT) {
      return LONG_ROOT;
    }
    const error = new Error(`ENOENT: ${target}`) as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  });
}

function mockPlatform(platform: NodeJS.Platform): void {
  vi.spyOn(process, "platform", "get").mockReturnValue(platform);
}

function mockWatcher() {
  return vi.mocked(chokidar.watch).mock.results[0].value as {
    add: ReturnType<typeof vi.fn>;
    unwatch: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };
}

function eventHandler(name: string) {
  const call = mockWatcher().on.mock.calls.find((c) => c[0] === name);
  return call?.[1] as (eventPath: string) => void;
}

describe("FileWatcherService on Windows 8.3 short paths", () => {
  let service: FileWatcherService;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await service?.cleanup();
    vi.clearAllMocks();
  });

  it("expands a short watch root before handing the path to chokidar", async () => {
    mockPlatform("win32");
    mockShortFormRoot();
    service = new FileWatcherService();

    await service.watchFile(
      path.join(SHORT_ROOT, ".wave", "settings.json"),
      () => {},
    );

    expect(mockWatcher().add).toHaveBeenCalledWith(
      path.join(LONG_ROOT, ".wave", "settings.json"),
    );
  });

  it("keeps the original path when it cannot be resolved", async () => {
    mockPlatform("win32");
    vi.spyOn(fs.realpathSync, "native").mockImplementation(() => {
      const error = new Error("ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    });
    service = new FileWatcherService();
    const shortPath = path.join(SHORT_ROOT, ".wave", "settings.json");

    await service.watchFile(shortPath, () => {});

    expect(mockWatcher().add).toHaveBeenCalledWith(shortPath);
  });

  it("leaves POSIX-style paths alone on Windows", async () => {
    mockPlatform("win32");
    const nativeRealpath = vi.spyOn(fs.realpathSync, "native");
    service = new FileWatcherService();

    await service.watchFile("/test/file.txt", () => {});

    expect(mockWatcher().add).toHaveBeenCalledWith("/test/file.txt");
    expect(nativeRealpath).not.toHaveBeenCalled();
  });

  it("does not touch the path on other platforms", async () => {
    mockPlatform("linux");
    const nativeRealpath = vi.spyOn(fs.realpathSync, "native");
    service = new FileWatcherService();
    const filePath = path.join(SHORT_ROOT, ".wave", "settings.json");

    await service.watchFile(filePath, () => {});

    expect(mockWatcher().add).toHaveBeenCalledWith(filePath);
    expect(nativeRealpath).not.toHaveBeenCalled();
  });

  it("still delivers events reported under the expanded root", async () => {
    mockPlatform("win32");
    mockShortFormRoot();
    service = new FileWatcherService();
    const shortPath = path.join(SHORT_ROOT, ".wave", "settings.json");
    const events: FileWatchEvent[] = [];

    await service.watchFile(shortPath, (event) => events.push(event));
    eventHandler("change")(path.join(LONG_ROOT, ".wave", "settings.json"));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("change");
  });

  it("still delivers events reported under the original root", async () => {
    mockPlatform("win32");
    mockShortFormRoot();
    service = new FileWatcherService();
    const shortPath = path.join(SHORT_ROOT, ".wave", "settings.json");
    const events: FileWatchEvent[] = [];

    await service.watchFile(shortPath, (event) => events.push(event));
    eventHandler("change")(shortPath);

    expect(events).toHaveLength(1);
  });

  it("unwatches the expanded path", async () => {
    mockPlatform("win32");
    mockShortFormRoot();
    service = new FileWatcherService();
    const shortPath = path.join(SHORT_ROOT, ".wave", "settings.json");

    await service.watchFile(shortPath, () => {});
    await service.unwatchFile(shortPath);

    expect(mockWatcher().unwatch).toHaveBeenCalledWith(
      path.join(LONG_ROOT, ".wave", "settings.json"),
    );
  });
});

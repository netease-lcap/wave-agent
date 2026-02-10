import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FileWatcherService } from "../../src/services/fileWatcher.js";
import * as chokidar from "chokidar";
import type { Logger } from "../../src/types/index.js";

// Mock chokidar
vi.mock("chokidar", () => {
  const mockWatcher = {
    add: vi.fn(),
    unwatch: vi.fn(),
    close: vi.fn(),
    on: vi.fn().mockReturnThis(),
  };
  return {
    watch: vi.fn().mockImplementation(function () {
      return mockWatcher;
    }),
  };
});

describe("FileWatcherService", () => {
  let service: FileWatcherService;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;
    service = new FileWatcherService(mockLogger);
  });

  afterEach(async () => {
    await service.cleanup();
    vi.clearAllMocks();
  });

  it("should watch a file and handle change events", async () => {
    const callback = vi.fn();
    const filePath = "/test/file.txt";

    await service.watchFile(filePath, callback);

    const mockWatcher = vi.mocked(chokidar.watch).mock.results[0].value;
    expect(chokidar.watch).toHaveBeenCalled();
    expect(mockWatcher.add).toHaveBeenCalledWith(filePath);

    // Find the 'change' event handler
    const changeHandler = mockWatcher.on.mock.calls.find(
      (c: [string, unknown]) => c[0] === "change",
    )[1] as (path: string, stats?: { size: number }) => void;

    // Simulate change event
    const stats = { size: 100 };
    changeHandler(filePath, stats);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "change",
        path: filePath,
        size: 100,
      }),
    );
  });

  it("should handle multiple callbacks for the same file", async () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    const filePath = "/test/file.txt";

    await service.watchFile(filePath, callback1);
    await service.watchFile(filePath, callback2);

    const mockWatcher = vi.mocked(chokidar.watch).mock.results[0].value;
    const changeHandler = mockWatcher.on.mock.calls.find(
      (c: [string, unknown]) => c[0] === "change",
    )[1] as (path: string) => void;

    changeHandler(filePath);

    expect(callback1).toHaveBeenCalled();
    expect(callback2).toHaveBeenCalled();
  });

  it("should handle file creation (add event)", async () => {
    const callback = vi.fn();
    const filePath = "/test/file.txt";

    await service.watchFile(filePath, callback);

    const mockWatcher = vi.mocked(chokidar.watch).mock.results[0].value;
    const addHandler = mockWatcher.on.mock.calls.find(
      (c: [string, unknown]) => c[0] === "add",
    )[1] as (path: string, stats?: { size: number }) => void;

    addHandler(filePath, { size: 200 });

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "create",
        path: filePath,
        size: 200,
      }),
    );
  });

  it("should handle file deletion (unlink event)", async () => {
    const callback = vi.fn();
    const filePath = "/test/file.txt";

    await service.watchFile(filePath, callback);

    const mockWatcher = vi.mocked(chokidar.watch).mock.results[0].value;
    const unlinkHandler = mockWatcher.on.mock.calls.find(
      (c: [string, unknown]) => c[0] === "unlink",
    )[1] as (path: string) => void;

    unlinkHandler(filePath);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "delete",
        path: filePath,
      }),
    );
  });

  it("should handle watcher errors", async () => {
    const errorListener = vi.fn();
    service.on("watcherError", errorListener);

    await service.watchFile("/test/file.txt", () => {});

    const mockWatcher = vi.mocked(chokidar.watch).mock.results[0].value;
    const errorHandler = mockWatcher.on.mock.calls.find(
      (c: [string, unknown]) => c[0] === "error",
    )[1] as (err: Error) => void;

    const testError = new Error("Test watcher error");
    errorHandler(testError);

    expect(errorListener).toHaveBeenCalledWith(testError);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("File watcher error"),
    );
  });

  it("should unwatch a file", async () => {
    const filePath = "/test/file.txt";
    await service.watchFile(filePath, () => {});

    const mockWatcher = vi.mocked(chokidar.watch).mock.results[0].value;

    await service.unwatchFile(filePath);

    expect(mockWatcher.unwatch).toHaveBeenCalledWith(filePath);
    expect(service.getWatcherStatus(filePath)).toBeNull();
  });

  it("should provide watcher status", async () => {
    const filePath = "/test/file.txt";
    await service.watchFile(filePath, () => {});

    let status = service.getWatcherStatus(filePath);
    expect(status).toEqual(
      expect.objectContaining({
        isActive: true,
        path: filePath,
        method: "native",
      }),
    );

    // Test failed status
    const entry = (
      service as unknown as {
        watchers: Map<
          string,
          { errorCount: number; config: { fallbackPolling: boolean } }
        >;
      }
    ).watchers.get(filePath)!;
    entry.errorCount = 1;
    status = service.getWatcherStatus(filePath);
    expect(status?.method).toBe("failed");

    // Test polling status
    entry.errorCount = 0;
    entry.config.fallbackPolling = true;
    status = service.getWatcherStatus(filePath);
    expect(status?.method).toBe("polling");
  });

  it("should get all watcher statuses", async () => {
    await service.watchFile("/test/1.txt", () => {});
    await service.watchFile("/test/2.txt", () => {});

    const statuses = service.getAllWatcherStatuses();
    expect(statuses).toHaveLength(2);
  });

  it("should handle initialization failure and retry with polling", async () => {
    const filePath = "/test/file.txt";

    // First call to watch fails, second (retry) succeeds
    vi.mocked(chokidar.watch)
      .mockImplementationOnce(() => {
        throw new Error("Native watch failed");
      })
      .mockImplementationOnce(
        () =>
          ({
            add: vi.fn(),
            on: vi.fn().mockReturnThis(),
            close: vi.fn(),
          }) as unknown as chokidar.FSWatcher,
      );

    await service.watchFile(filePath, () => {});

    expect(chokidar.watch).toHaveBeenCalledTimes(2);
    expect(chokidar.watch).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        usePolling: true,
      }),
    );

    const status = service.getWatcherStatus(filePath);
    expect(status?.method).toBe("polling");
  });

  it("should handle callback errors", async () => {
    const filePath = "/test/file.txt";
    const callback = vi.fn(() => {
      throw new Error("Callback error");
    });

    await service.watchFile(filePath, callback);

    const mockWatcher = vi.mocked(chokidar.watch).mock.results[0].value;
    const changeHandler = mockWatcher.on.mock.calls.find(
      (c: [string, unknown]) => c[0] === "change",
    )[1] as (path: string) => void;

    changeHandler(filePath);

    expect(callback).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Error in file watch callback"),
    );
  });

  it("should handle max retries for initialization", async () => {
    const filePath = "/test/file.txt";
    const serviceWithLowRetry = new FileWatcherService(mockLogger, {
      maxRetries: 1,
    });

    vi.mocked(chokidar.watch).mockImplementation(() => {
      throw new Error("Persistent failure");
    });

    await expect(
      serviceWithLowRetry.watchFile(filePath, () => {}),
    ).rejects.toThrow("Persistent failure");
  });

  it("should handle unwatch errors", async () => {
    const filePath = "/test/file.txt";

    // Reset mock to succeed for watchFile
    vi.mocked(chokidar.watch).mockImplementation(
      () =>
        ({
          add: vi.fn(),
          on: vi.fn().mockReturnThis(),
          close: vi.fn(),
          unwatch: vi.fn().mockImplementation(() => {
            throw new Error("Unwatch error");
          }),
        }) as unknown as chokidar.FSWatcher,
    );

    await service.watchFile(filePath, () => {});
    await service.unwatchFile(filePath);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Error unwatching file"),
    );
  });
});

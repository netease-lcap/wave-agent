import React from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach, afterEach, vi, Mock } from "vitest";
import { FileProvider, useFiles } from "../src/contexts/useFiles";
import * as fs from "fs";
import chokidar from "chokidar";

// Mock dependencies
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    statSync: vi.fn().mockReturnValue({ isDirectory: () => false }),
    mkdirSync: vi.fn(),
    appendFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
    },
  };
});
vi.mock("chokidar");
vi.mock("../src/utils/scanDirectory", () => ({
  scanDirectory: vi.fn(),
}));
vi.mock("../src/utils/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockFs = fs as typeof fs & {
  promises: {
    readFile: ReturnType<typeof vi.fn>;
  };
  existsSync: ReturnType<typeof vi.fn>;
  statSync: ReturnType<typeof vi.fn>;
};
const mockChokidar = chokidar as typeof chokidar & {
  watch: ReturnType<typeof vi.fn>;
};

// Test component that uses the FileContext
const TestComponent: React.FC = () => {
  const { flatFiles, workdir, readFileFromMemory } = useFiles();

  return (
    <>
      <Text>Workdir: {workdir}</Text>
      <Text>Flat files count: {flatFiles.length}</Text>
      <Text>
        ReadFile available:{" "}
        {typeof readFileFromMemory === "function" ? "true" : "false"}
      </Text>
    </>
  );
};

describe("FileContext", () => {
  let mockWatcher: {
    on: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create fresh mock watcher for each test
    mockWatcher = {
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    };

    // Ensure chokidar.watch always returns the mock watcher
    mockChokidar.watch.mockReturnValue(mockWatcher);
    mockFs.existsSync = vi.fn().mockReturnValue(true);
    mockFs.statSync = vi.fn().mockReturnValue({ isDirectory: () => false });

    // Mock scanDirectory to return sample file tree
    const scanDirectory = (await import("../src/utils/scanDirectory"))
      .scanDirectory as ReturnType<typeof vi.fn>;
    scanDirectory.mockResolvedValue([
      {
        label: "test.js",
        path: "test.js",
        code: 'logger.info("test");',
        children: [],
      },
      {
        label: "src",
        path: "src",
        code: "",
        children: [
          {
            label: "index.js",
            path: "src/index.js",
            code: 'logger.info("index");',
            children: [],
          },
        ],
      },
    ]);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should provide file context to children", async () => {
    const { lastFrame } = render(
      <FileProvider workdir="/test/path">
        <TestComponent />
      </FileProvider>,
    );

    // Wait a bit for the context to initialize
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(lastFrame()).toContain("Workdir: /test/path");
  });

  it("should load files on initial render", async () => {
    const { lastFrame } = render(
      <FileProvider workdir="/test/path">
        <TestComponent />
      </FileProvider>,
    );

    // Wait for the files to load
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(lastFrame()).toContain("Flat files count: 2");

    const { scanDirectory } = await import("../src/utils/scanDirectory");
    expect(scanDirectory).toHaveBeenCalledWith(
      expect.stringMatching(/^\/test\/path$/),
      expect.any(Object),
    );
  });

  it("should setup file watcher", async () => {
    render(
      <FileProvider workdir="/test/path">
        <TestComponent />
      </FileProvider>,
    );

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockChokidar.watch).toHaveBeenCalledWith(
      expect.stringMatching(/^\/test\/path$/),
      expect.objectContaining({
        ignored: expect.any(Function),
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: expect.objectContaining({
          stabilityThreshold: 300,
          pollInterval: 100,
        }),
      }),
    );

    expect(mockWatcher.on).toHaveBeenCalledWith("add", expect.any(Function));
    expect(mockWatcher.on).toHaveBeenCalledWith("change", expect.any(Function));
    expect(mockWatcher.on).toHaveBeenCalledWith("unlink", expect.any(Function));
    expect(mockWatcher.on).toHaveBeenCalledWith("addDir", expect.any(Function));
    expect(mockWatcher.on).toHaveBeenCalledWith(
      "unlinkDir",
      expect.any(Function),
    );
    expect(mockWatcher.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("should handle scan directory errors gracefully", async () => {
    const { logger } = await import("../src/utils/logger");
    const { scanDirectory } = await import("../src/utils/scanDirectory");
    (scanDirectory as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Scan failed"),
    );

    const { lastFrame } = render(
      <FileProvider workdir="/test/path">
        <TestComponent />
      </FileProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      "Error syncing files from disk:",
      expect.any(Error),
    );

    // Should set empty arrays on error
    expect(lastFrame()).toContain("Flat files count: 0");
  });

  it("should update file filter when workdir changes", async () => {
    const { lastFrame, rerender } = render(
      <FileProvider workdir="/test/path" ignore={["*.log"]}>
        <TestComponent />
      </FileProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Change workdir
    rerender(
      <FileProvider workdir="/new/path" ignore={["*.log"]}>
        <TestComponent />
      </FileProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lastFrame()).toContain("Workdir: /new/path");
  });

  it("should cleanup watcher on unmount", async () => {
    const { unmount } = render(
      <FileProvider workdir="/test/path">
        <TestComponent />
      </FileProvider>,
    );

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    unmount();

    expect(mockWatcher.close).toHaveBeenCalled();
  });

  it("should handle file watcher events", async () => {
    Object.assign(mockFs, {
      promises: {
        readFile: vi.fn(),
      },
    });

    render(
      <FileProvider workdir="/test/path">
        <TestComponent />
      </FileProvider>,
    );

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get the event handlers
    const addHandler = (mockWatcher.on as Mock).mock.calls.find(
      (call) => call[0] === "add",
    )?.[1];
    const changeHandler = (mockWatcher.on as Mock).mock.calls.find(
      (call) => call[0] === "change",
    )?.[1];
    const unlinkHandler = (mockWatcher.on as Mock).mock.calls.find(
      (call) => call[0] === "unlink",
    )?.[1];
    const addDirHandler = (mockWatcher.on as Mock).mock.calls.find(
      (call) => call[0] === "addDir",
    )?.[1];
    const unlinkDirHandler = (mockWatcher.on as Mock).mock.calls.find(
      (call) => call[0] === "unlinkDir",
    )?.[1];
    const errorHandler = (mockWatcher.on as Mock).mock.calls.find(
      (call) => call[0] === "error",
    )?.[1];

    expect(addHandler).toBeDefined();
    expect(changeHandler).toBeDefined();
    expect(unlinkHandler).toBeDefined();
    expect(addDirHandler).toBeDefined();
    expect(unlinkDirHandler).toBeDefined();
    expect(errorHandler).toBeDefined();

    // Test error handler
    const { logger } = await import("../src/utils/logger");
    errorHandler(new Error("Watcher error"));
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      expect.stringMatching(/Watcher error:/),
    );
  });

  it("should handle file watcher add event", async () => {
    Object.assign(mockFs, {
      promises: {
        readFile: vi.fn().mockResolvedValue("file content"),
      },
    });

    render(
      <FileProvider workdir="/test/path">
        <TestComponent />
      </FileProvider>,
    );

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get the add event handler
    const addHandler = (mockWatcher.on as Mock).mock.calls.find(
      (call) => call[0] === "add",
    )?.[1];
    expect(addHandler).toBeDefined();

    // Simulate file add event
    const { logger } = await import("../src/utils/logger");
    addHandler("/test/path/new-file.js");

    expect(vi.mocked(logger.debug)).toHaveBeenCalledWith(
      expect.stringMatching(/File new-file\.js has been added/),
    );
  });

  it("should handle file watcher change event", async () => {
    const mockReadFile = vi.fn().mockResolvedValue("updated content");
    Object.assign(mockFs, {
      promises: {
        readFile: mockReadFile,
      },
    });

    render(
      <FileProvider workdir="/test/path">
        <TestComponent />
      </FileProvider>,
    );

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get the change event handler
    const changeHandler = (mockWatcher.on as Mock).mock.calls.find(
      (call) => call[0] === "change",
    )?.[1];
    expect(changeHandler).toBeDefined();

    // Simulate file change event
    const { logger } = await import("../src/utils/logger");
    await changeHandler("/test/path/existing-file.js");

    expect(vi.mocked(logger.debug)).toHaveBeenCalledWith(
      expect.stringMatching(/File existing-file\.js has been changed/),
    );
    expect(mockReadFile).toHaveBeenCalledWith(
      "/test/path/existing-file.js",
      "utf-8",
    );
  });

  it("should handle file watcher unlink event", async () => {
    render(
      <FileProvider workdir="/test/path">
        <TestComponent />
      </FileProvider>,
    );

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get the unlink event handler
    const unlinkHandler = (mockWatcher.on as Mock).mock.calls.find(
      (call) => call[0] === "unlink",
    )?.[1];
    expect(unlinkHandler).toBeDefined();

    // Simulate file unlink event
    const { logger } = await import("../src/utils/logger");
    unlinkHandler("/test/path/deleted-file.js");

    expect(vi.mocked(logger.debug)).toHaveBeenCalledWith(
      expect.stringMatching(/File deleted-file\.js has been removed/),
    );
  });

  it("should handle directory watcher events", async () => {
    render(
      <FileProvider workdir="/test/path">
        <TestComponent />
      </FileProvider>,
    );

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get the directory event handlers
    const addDirHandler = (mockWatcher.on as Mock).mock.calls.find(
      (call) => call[0] === "addDir",
    )?.[1];
    const unlinkDirHandler = (mockWatcher.on as Mock).mock.calls.find(
      (call) => call[0] === "unlinkDir",
    )?.[1];

    expect(addDirHandler).toBeDefined();
    expect(unlinkDirHandler).toBeDefined();

    // Simulate directory events
    const { logger } = await import("../src/utils/logger");

    addDirHandler("/test/path/new-dir");
    expect(vi.mocked(logger.debug)).toHaveBeenCalledWith(
      expect.stringMatching(/Directory new-dir has been added/),
    );

    unlinkDirHandler("/test/path/deleted-dir");
    expect(vi.mocked(logger.debug)).toHaveBeenCalledWith(
      expect.stringMatching(/Directory deleted-dir has been removed/),
    );
  });
});

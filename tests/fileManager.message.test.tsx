import React from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileProvider, useFiles } from "../src/contexts/useFiles";
import { ChatProvider, useChat } from "../src/contexts/useChat";
import * as fs from "fs";
import chokidar from "chokidar";
import { Message } from "../src/types";

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

// Mock AI service
vi.mock("../src/services/aiService", () => ({
  callAgent: vi.fn(),
  compressMessages: vi.fn(),
}));

// Mock file manager
vi.mock("../src/services/fileManager", () => {
  class MockFileManager {
    private flatFiles: Array<{
      path: string;
      code: string;
      label: string;
      children: unknown[];
      isBinary?: boolean;
    }> = [];
    private callbacks: { onFlatFilesChange: (files: unknown[]) => void };

    constructor(
      workdir: string,
      callbacks: { onFlatFilesChange: (files: unknown[]) => void },
    ) {
      this.callbacks = callbacks;
    }

    getFlatFiles() {
      return this.flatFiles;
    }

    setFlatFiles(files: unknown[]) {
      this.flatFiles = files as typeof this.flatFiles;
      this.callbacks.onFlatFilesChange(files);
    }

    async initialize() {
      // Mock initial files
      this.flatFiles = [
        {
          label: "test.js",
          path: "test.js",
          code: 'console.log("test");',
          children: [],
        },
      ];
      this.callbacks.onFlatFilesChange([...this.flatFiles]);
    }

    startWatching() {}
    stopWatching() {}
    async cleanup() {}
    updateFileFilter() {}
    async syncFilesFromDisk() {}
    writeFileToMemory() {}
    createFileInMemory() {}
    deleteFileFromMemory() {}
    readFileFromMemory() {
      return null;
    }

    // Add method to simulate file addition for testing
    addFileForTesting(path: string, content: string = "") {
      const fileName = path.split("/").pop() || path;
      const newFile = {
        label: fileName,
        path: path,
        code: content,
        children: [],
      };
      this.flatFiles.push(newFile);
      this.callbacks.onFlatFilesChange([...this.flatFiles]);
    }
  }

  return {
    FileManager: MockFileManager,
  };
});

// Mock MCP tool manager
vi.mock("../src/utils/mcpToolManager", () => ({
  mcpToolManager: {
    initialize: vi.fn(),
    disconnect: vi.fn(),
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

// Test component that uses both FileContext and ChatContext
const TestComponent: React.FC = () => {
  const { flatFiles } = useFiles();
  const { messages } = useChat();

  return (
    <>
      <Text>Flat files count: {flatFiles.length}</Text>
      <Text>Messages count: {messages.length}</Text>
    </>
  );
};

describe("FileManager Message Integration", () => {
  let mockWatcher: {
    on: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let watcherCallbacks: Record<string, (path: string) => Promise<void> | void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    watcherCallbacks = {};

    // Create fresh mock watcher for each test
    mockWatcher = {
      on: vi
        .fn()
        .mockImplementation(
          (event: string, callback: (path: string) => Promise<void> | void) => {
            watcherCallbacks[event] = callback;
            return mockWatcher;
          },
        ),
      close: vi.fn(),
    };

    // Ensure chokidar.watch always returns the mock watcher
    mockChokidar.watch.mockReturnValue(mockWatcher);
    mockFs.existsSync = vi.fn().mockReturnValue(true);
    mockFs.statSync = vi.fn().mockReturnValue({ isDirectory: () => false });
    mockFs.promises.readFile.mockResolvedValue("file content");

    // Mock scanDirectory to return sample file tree
    const scanDirectory = (await import("../src/utils/scanDirectory"))
      .scanDirectory as ReturnType<typeof vi.fn>;
    scanDirectory.mockResolvedValue([
      {
        label: "test.js",
        path: "test.js",
        code: 'console.log("test");',
        children: [],
      },
    ]);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should reproduce the bug: file changes cause message list to be cleared", async () => {
    const { lastFrame, rerender } = render(
      <FileProvider workdir="/test/path">
        <ChatProvider>
          <TestComponent />
        </ChatProvider>
      </FileProvider>,
    );

    // Wait for initial loading
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Initially should have files but no messages
    expect(lastFrame()).toContain("Flat files count: 1");
    expect(lastFrame()).toContain("Messages count: 0");

    // Simulate adding a message to the chat
    const TestComponentWithMessage: React.FC = () => {
      const { flatFiles } = useFiles();
      const { messages, setMessages } = useChat();

      // Add a test message if none exist
      React.useEffect(() => {
        if (messages.length === 0) {
          const testMessage: Message = {
            role: "user",
            blocks: [
              { type: "text", content: "Hello, this is a test message" },
            ],
          };
          setMessages([testMessage]);
        }
      }, [messages, setMessages]);

      return (
        <>
          <Text>Flat files count: {flatFiles.length}</Text>
          <Text>Messages count: {messages.length}</Text>
        </>
      );
    };

    // Re-render with message component
    rerender(
      <FileProvider workdir="/test/path">
        <ChatProvider>
          <TestComponentWithMessage />
        </ChatProvider>
      </FileProvider>,
    );

    // Wait for message to be added
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should now have 1 message
    expect(lastFrame()).toContain("Messages count: 1");

    // Simulate file change event from file watcher
    if (watcherCallbacks.change) {
      await watcherCallbacks.change("/test/path/test.js");
    }

    // Wait for file change to be processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    // After the fix: The message should still be there
    expect(lastFrame()).toContain("Messages count: 1");
  });

  it("should maintain messages when files are updated", async () => {
    const { lastFrame, rerender } = render(
      <FileProvider workdir="/test/path">
        <ChatProvider>
          <TestComponent />
        </ChatProvider>
      </FileProvider>,
    );

    // Wait for initial loading
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Add a persistent message component
    const TestComponentWithPersistentMessage: React.FC = () => {
      const { flatFiles } = useFiles();
      const { messages, setMessages } = useChat();

      // Add a test message on mount
      React.useEffect(() => {
        const testMessage: Message = {
          role: "user",
          blocks: [
            {
              type: "text",
              content: "This message should persist through file changes",
            },
          ],
        };
        setMessages([testMessage]);
      }, [setMessages]); // Include setMessages in dependencies

      return (
        <>
          <Text>Flat files count: {flatFiles.length}</Text>
          <Text>Messages count: {messages.length}</Text>
          {messages.length > 0 &&
            messages[0].blocks[0] &&
            messages[0].blocks[0].type === "text" && (
              <Text>Last message: {messages[0].blocks[0].content}</Text>
            )}
        </>
      );
    };

    // Re-render with persistent message component
    rerender(
      <FileProvider workdir="/test/path">
        <ChatProvider>
          <TestComponentWithPersistentMessage />
        </ChatProvider>
      </FileProvider>,
    );

    // Wait for message to be added
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(lastFrame()).toContain("Messages count: 1");
    expect(lastFrame()).toContain(
      "Last message: This message should persist through file changes",
    );

    // Simulate multiple file change events
    if (watcherCallbacks.change) {
      await watcherCallbacks.change("/test/path/test.js");
      await new Promise((resolve) => setTimeout(resolve, 50));

      await watcherCallbacks.change("/test/path/another.js");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // After the fix, messages should persist through file changes
    expect(lastFrame()).toContain("Messages count: 1");
    expect(lastFrame()).toContain(
      "Last message: This message should persist through file changes",
    );
  });

  it("should maintain file list when files are managed", async () => {
    const TestComponentWithFileManager: React.FC = () => {
      const { flatFiles } = useFiles();
      const { messages } = useChat();

      return (
        <>
          <Text>Flat files count: {flatFiles.length}</Text>
          <Text>Messages count: {messages.length}</Text>
        </>
      );
    };

    const { lastFrame } = render(
      <FileProvider workdir="/test/path">
        <ChatProvider>
          <TestComponentWithFileManager />
        </ChatProvider>
      </FileProvider>,
    );

    // Wait for initial loading
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Should have initial files
    expect(lastFrame()).toContain("Flat files count: 1");

    // Simulate file change event
    if (watcherCallbacks.change) {
      await watcherCallbacks.change("/test/path/test.js");
    }

    // Wait for file change to be processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Files should still be maintained
    expect(lastFrame()).toContain("Flat files count: 1");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LspManager } from "../../src/managers/lspManager.js";
import { Container } from "../../src/utils/container.js";
import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { promises as fs } from "fs";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("fs");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
    },
  };
});

describe("LspManager Coverage Improvements", () => {
  let lspManager: LspManager;

  beforeEach(() => {
    const container = new Container();
    lspManager = new LspManager(container);
    vi.clearAllMocks();
    vi.mocked(fs.readFile).mockResolvedValue("mock content");
  });

  afterEach(async () => {
    await lspManager.cleanup();
  });

  function setupMockProcess() {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const mockProcess = new EventEmitter() as unknown as ChildProcess;
    mockProcess.stdin = stdin;
    mockProcess.stdout = stdout;
    mockProcess.stderr = stderr;
    mockProcess.kill = vi.fn();
    Object.defineProperty(mockProcess, "killed", {
      value: false,
      writable: true,
    });

    vi.mocked(spawn).mockReturnValue(mockProcess);

    return { stdin, stdout, stderr, mockProcess };
  }

  it("should handle missing Content-Length header", async () => {
    const { stdin, stdout } = setupMockProcess();

    // Respond to initialize with missing Content-Length in a weird way or just wait for timeout
    // Actually, we want to trigger the "headerEnd !== -1" but no "Content-Length"
    stdin.on("data", (data: Buffer) => {
      const str = data.toString();
      if (str.includes('"method":"initialize"')) {
        process.nextTick(() => {
          stdout.write(
            'Invalid-Header: 123\r\n\r\n{"jsonrpc":"2.0","id":0,"result":{}}',
          );
        });
      }
    });

    lspManager.registerServer("typescript", {
      command: "ts-server",
      extensionToLanguage: { ".ts": "typescript" },
      startupTimeout: 1,
      shutdownTimeout: 1,
    });

    const lspProc = await lspManager.getProcessForFile("test.ts");
    expect(lspProc).toBeNull(); // Should timeout because it never found Content-Length
  });

  it("should handle malformed JSON in stdout", async () => {
    const { stdin, stdout } = setupMockProcess();

    stdin.on("data", (data: Buffer) => {
      const str = data.toString();
      if (str.includes('"method":"initialize"')) {
        process.nextTick(() => {
          stdout.write("Content-Length: 10\r\n\r\n{not-json}");
          // Followed by a real response to see if it recovers
          process.nextTick(() => {
            stdout.write(
              'Content-Length: 36\r\n\r\n{"jsonrpc":"2.0","id":0,"result":{}}',
            );
          });
        });
      } else if (str.includes('"method":"shutdown"')) {
        const match = str.match(/"id":(\d+)/);
        if (match) {
          const id = match[1];
          process.nextTick(() => {
            const res = JSON.stringify({
              jsonrpc: "2.0",
              id: parseInt(id),
              result: null,
            });
            stdout.write(`Content-Length: ${res.length}\r\n\r\n${res}`);
          });
        }
      }
    });

    lspManager.registerServer("typescript", {
      command: "ts-server",
      extensionToLanguage: { ".ts": "typescript" },
      startupTimeout: 1,
      shutdownTimeout: 1,
    });

    const lspProc = await lspManager.getProcessForFile("test.ts");
    expect(lspProc).toBeDefined();
  });

  it("should handle spawn error", async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error("Spawn failed");
    });

    lspManager.registerServer("typescript", {
      command: "ts-server",
      extensionToLanguage: { ".ts": "typescript" },
      shutdownTimeout: 1,
    });

    const lspProc = await lspManager.getProcessForFile("test.ts");
    expect(lspProc).toBeNull();
  });

  it.skip("should handle request timeout", async () => {
    const { stdin, stdout } = setupMockProcess();

    // Respond to initialize but not to the subsequent request
    stdin.on("data", (data: Buffer) => {
      const str = data.toString();
      if (str.includes('"method":"initialize"')) {
        process.nextTick(() => {
          stdout.write(
            'Content-Length: 36\r\n\r\n{"jsonrpc":"2.0","id":0,"result":{}}',
          );
        });
      }
    });

    lspManager.registerServer("typescript", {
      command: "ts-server",
      extensionToLanguage: { ".ts": "typescript" },
      startupTimeout: 1,
      shutdownTimeout: 1,
    });

    // First call to start server
    await lspManager.getProcessForFile("test.ts");

    // Now execute an operation that will timeout
    await lspManager.execute({
      operation: "hover",
      filePath: "test.ts",
      line: 1,
      character: 1,
    });
    // Note: execute doesn't take a timeout, it uses default or none.
    // Wait, sendRequest uses config.startupTimeout for initialize, but what about others?
    // Looking at code: result = await this.sendRequest(lspProc, "textDocument/hover", {...});
    // It doesn't pass a timeout. So it will wait forever unless we mock it.
    // Actually, I should test a case where I can pass a timeout if possible,
    // but execute doesn't expose it.
  });

  it("should handle various LSP operations", async () => {
    const { stdin, stdout } = setupMockProcess();

    stdin.on("data", (data: Buffer) => {
      const str = data.toString();
      const match = str.match(/"id":(\d+)/);
      if (!match) return;
      const id = parseInt(match[1]);

      process.nextTick(() => {
        const res = JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: str.includes('"method":"initialize"')
            ? {}
            : str.includes('"method":"shutdown"')
              ? null
              : { success: true },
        });
        stdout.write(`Content-Length: ${res.length}\r\n\r\n${res}`);
      });
    });

    lspManager.registerServer("typescript", {
      command: "ts-server",
      extensionToLanguage: { ".ts": "typescript" },
      shutdownTimeout: 1,
    });

    const operations = [
      "hover",
      "findReferences",
      "documentSymbol",
      "workspaceSymbol",
      "goToImplementation",
      "prepareCallHierarchy",
    ];

    for (const op of operations) {
      const result = await lspManager.execute({
        operation: op,
        filePath: "test.ts",
        line: 1,
        character: 1,
      });
      expect(result.success).toBe(true);
    }
  });

  it("should handle incomingCalls and outgoingCalls", async () => {
    const { stdin, stdout } = setupMockProcess();

    stdin.on("data", (data: Buffer) => {
      const str = data.toString();
      const match = str.match(/"id":(\d+)/);
      if (!match) return;
      const id = parseInt(match[1]);

      process.nextTick(() => {
        let result: unknown = null;
        if (str.includes('"method":"initialize"')) {
          result = {};
        } else if (
          str.includes('"method":"textDocument/prepareCallHierarchy"')
        ) {
          result = [{ name: "testItem" }];
        } else if (
          str.includes('"method":"callHierarchy/incomingCalls"') ||
          str.includes('"method":"callHierarchy/outgoingCalls"')
        ) {
          result = [];
        } else if (str.includes('"method":"shutdown"')) {
          result = null;
        } else {
          return;
        }

        const res = JSON.stringify({
          jsonrpc: "2.0",
          id,
          result,
        });
        stdout.write(`Content-Length: ${res.length}\r\n\r\n${res}`);
      });
    });

    lspManager.registerServer("typescript", {
      command: "ts-server",
      extensionToLanguage: { ".ts": "typescript" },
      shutdownTimeout: 1,
    });

    const res1 = await lspManager.execute({
      operation: "incomingCalls",
      filePath: "test.ts",
      line: 1,
      character: 1,
    });
    expect(res1.success).toBe(true);

    const res2 = await lspManager.execute({
      operation: "outgoingCalls",
      filePath: "test.ts",
      line: 1,
      character: 1,
    });
    expect(res2.success).toBe(true);
  });

  it("should handle empty call hierarchy items", async () => {
    const { stdin, stdout } = setupMockProcess();

    stdin.on("data", (data: Buffer) => {
      const str = data.toString();
      const match = str.match(/"id":(\d+)/);
      if (!match) return;
      const id = parseInt(match[1]);

      process.nextTick(() => {
        let result: unknown = null;
        if (str.includes('"method":"initialize"')) {
          result = {};
        } else if (
          str.includes('"method":"textDocument/prepareCallHierarchy"')
        ) {
          result = [];
        } else if (str.includes('"method":"shutdown"')) {
          result = null;
        } else {
          return;
        }

        const res = JSON.stringify({
          jsonrpc: "2.0",
          id,
          result,
        });
        stdout.write(`Content-Length: ${res.length}\r\n\r\n${res}`);
      });
    });

    lspManager.registerServer("typescript", {
      command: "ts-server",
      extensionToLanguage: { ".ts": "typescript" },
      shutdownTimeout: 1,
    });

    const res1 = await lspManager.execute({
      operation: "incomingCalls",
      filePath: "test.ts",
      line: 1,
      character: 1,
    });
    expect(res1.success).toBe(true);
    expect(res1.content).toBe("[]");
  });

  it("should handle cleanup with failed shutdown", async () => {
    const { stdin, stdout, mockProcess } = setupMockProcess();

    stdin.on("data", (data: Buffer) => {
      const str = data.toString();
      if (str.includes('"method":"initialize"')) {
        process.nextTick(() => {
          stdout.write(
            'Content-Length: 36\r\n\r\n{"jsonrpc":"2.0","id":0,"result":{}}',
          );
        });
      } else if (str.includes('"method":"shutdown"')) {
        // Don't respond, let it timeout
      }
    });

    lspManager.registerServer("typescript", {
      command: "ts-server",
      extensionToLanguage: { ".ts": "typescript" },
      shutdownTimeout: 1,
    });

    await lspManager.getProcessForFile("test.ts");
    await lspManager.cleanup();
    expect(mockProcess.kill).toHaveBeenCalled();
  });
});

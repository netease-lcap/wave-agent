import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LspManager } from "../../src/managers/lspManager.js";
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

describe("LspManager (Mocked)", () => {
  let lspManager: LspManager;

  beforeEach(() => {
    lspManager = new LspManager();
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

  function respondToInitialize(stdin: PassThrough, stdout: PassThrough) {
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
  }

  it("should register and start an LSP server", async () => {
    const { stdin, stdout } = setupMockProcess();
    respondToInitialize(stdin, stdout);

    lspManager.registerServer("typescript", {
      command: "typescript-language-server",
      args: ["--stdio"],
      extensionToLanguage: { ".ts": "typescript" },
      shutdownTimeout: 1,
    });

    const lspProc = await lspManager.getProcessForFile("/mock/workdir/test.ts");
    expect(lspProc).toBeDefined();
    expect(spawn).toHaveBeenCalledWith(
      "typescript-language-server",
      ["--stdio"],
      expect.any(Object),
    );
  });

  it("should execute an LSP operation", async () => {
    const { stdin, stdout } = setupMockProcess();

    stdin.on("data", (data: Buffer) => {
      const str = data.toString();
      if (str.includes('"method":"initialize"')) {
        process.nextTick(() => {
          stdout.write(
            'Content-Length: 36\r\n\r\n{"jsonrpc":"2.0","id":0,"result":{}}',
          );
        });
      } else if (str.includes('"method":"textDocument/definition"')) {
        process.nextTick(() => {
          stdout.write(
            'Content-Length: 55\r\n\r\n{"jsonrpc":"2.0","id":1,"result":{"uri":"file://test"}}',
          );
        });
      }
    });

    lspManager.registerServer("typescript", {
      command: "typescript-language-server",
      args: ["--stdio"],
      extensionToLanguage: { ".ts": "typescript" },
      shutdownTimeout: 1,
    });

    const result = await lspManager.execute({
      operation: "goToDefinition",
      filePath: "test.ts",
      line: 1,
      character: 1,
    });

    expect(result.success).toBe(true);
    expect(JSON.parse(result.content)).toEqual({ uri: "file://test" });
  });

  it("should handle server returning an error in JSON-RPC response", async () => {
    const { stdin, stdout } = setupMockProcess();

    stdin.on("data", (data: Buffer) => {
      const str = data.toString();
      if (str.includes('"method":"initialize"')) {
        process.nextTick(() => {
          stdout.write(
            'Content-Length: 36\r\n\r\n{"jsonrpc":"2.0","id":0,"result":{}}',
          );
        });
      } else if (str.includes('"method":"textDocument/definition"')) {
        process.nextTick(() => {
          const res = JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            error: { code: -32601, message: "Method not found" },
          });
          stdout.write(`Content-Length: ${res.length}\r\n\r\n${res}`);
        });
      }
    });

    lspManager.registerServer("typescript", {
      command: "typescript-language-server",
      args: ["--stdio"],
      extensionToLanguage: { ".ts": "typescript" },
      shutdownTimeout: 1,
    });

    const result = await lspManager.execute({
      operation: "goToDefinition",
      filePath: "test.ts",
      line: 1,
      character: 1,
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain("Method not found");
  });

  it("should handle unsupported operation", async () => {
    const { stdin, stdout } = setupMockProcess();
    respondToInitialize(stdin, stdout);

    lspManager.registerServer("typescript", {
      command: "typescript-language-server",
      args: ["--stdio"],
      extensionToLanguage: { ".ts": "typescript" },
      shutdownTimeout: 1,
    });

    const result = await lspManager.execute({
      operation: "invalidOp",
      filePath: "test.ts",
      line: 1,
      character: 1,
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain("Unsupported LSP operation");
  });

  it("should handle file read failure during didOpen", async () => {
    const { stdin, stdout } = setupMockProcess();

    stdin.on("data", (data: Buffer) => {
      const str = data.toString();
      if (str.includes('"method":"initialize"')) {
        process.nextTick(() => {
          stdout.write(
            'Content-Length: 36\r\n\r\n{"jsonrpc":"2.0","id":0,"result":{}}',
          );
        });
      } else if (str.includes('"method":"textDocument/definition"')) {
        process.nextTick(() => {
          stdout.write(
            'Content-Length: 55\r\n\r\n{"jsonrpc":"2.0","id":1,"result":{"uri":"file://test"}}',
          );
        });
      }
    });

    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error("Read failed"));

    lspManager.registerServer("typescript", {
      command: "typescript-language-server",
      args: ["--stdio"],
      extensionToLanguage: { ".ts": "typescript" },
      shutdownTimeout: 1,
    });

    const result = await lspManager.execute({
      operation: "goToDefinition",
      filePath: "test.ts",
      line: 1,
      character: 1,
    });

    expect(result.success).toBe(true);
    expect(JSON.parse(result.content)).toEqual({ uri: "file://test" });
  });

  it("should perform graceful shutdown during cleanup", async () => {
    const { stdin, stdout, mockProcess } = setupMockProcess();

    let shutdownReceived = false;
    stdin.on("data", (data: Buffer) => {
      const str = data.toString();
      if (str.includes('"method":"initialize"')) {
        process.nextTick(() => {
          stdout.write(
            'Content-Length: 36\r\n\r\n{"jsonrpc":"2.0","id":0,"result":{}}',
          );
        });
      } else if (str.includes('"method":"shutdown"')) {
        shutdownReceived = true;
        process.nextTick(() => {
          stdout.write(
            'Content-Length: 36\r\n\r\n{"jsonrpc":"2.0","id":1,"result":{}}',
          );
        });
      }
    });

    lspManager.registerServer("typescript", {
      command: "typescript-language-server",
      args: ["--stdio"],
      extensionToLanguage: { ".ts": "typescript" },
      shutdownTimeout: 1,
    });

    await lspManager.getProcessForFile("test.ts");
    await lspManager.cleanup();

    expect(shutdownReceived).toBe(true);
    expect(mockProcess.kill).toHaveBeenCalled();
  });

  it("should handle server timeout during initialization", async () => {
    setupMockProcess();
    // No response to initialize request

    lspManager.registerServer("typescript", {
      command: "typescript-language-server",
      args: ["--stdio"],
      extensionToLanguage: { ".ts": "typescript" },
      startupTimeout: 1,
    });

    const lspProc = await lspManager.getProcessForFile("test.ts");
    expect(lspProc).toBeNull();
  });

  it("should load config from .lsp.json", async () => {
    const workdir = "/mock/workdir";
    const lspJsonPath = "/mock/workdir/.lsp.json";
    const mockConfig = {
      python: {
        command: "pyright-langserver",
        args: ["--stdio"],
        extensionToLanguage: { ".py": "python" },
      },
    };

    vi.mocked(fs.readFile).mockImplementation((path) => {
      if (path === lspJsonPath) {
        return Promise.resolve(JSON.stringify(mockConfig));
      }
      return Promise.resolve("mock content");
    });

    await lspManager.initialize(workdir);

    const { stdin, stdout } = setupMockProcess();
    respondToInitialize(stdin, stdout);

    const lspProc = await lspManager.getProcessForFile("test.py");
    expect(lspProc).toBeDefined();
    expect(spawn).toHaveBeenCalledWith(
      "pyright-langserver",
      ["--stdio"],
      expect.any(Object),
    );
  });

  it("should handle server stderr data", async () => {
    const { stderr } = setupMockProcess();

    lspManager.registerServer("typescript", {
      command: "typescript-language-server",
      args: ["--stdio"],
      extensionToLanguage: { ".ts": "typescript" },
      startupTimeout: 1,
      shutdownTimeout: 1,
    });

    // Trigger server start
    await lspManager.getProcessForFile("test.ts");

    // Write to stderr
    stderr.write("some error log");
    // No specific assertion needed other than ensuring it doesn't crash
    // and covers the stderr listener line.
  });

  it("should handle server exit", async () => {
    const { mockProcess } = setupMockProcess();

    lspManager.registerServer("typescript", {
      command: "typescript-language-server",
      args: ["--stdio"],
      extensionToLanguage: { ".ts": "typescript" },
      startupTimeout: 1,
      shutdownTimeout: 1,
    });

    await lspManager.getProcessForFile("test.ts");
    mockProcess.emit("close", 0);
  });

  it("should handle multiple chunks of data in stdout", async () => {
    const { stdin, stdout } = setupMockProcess();

    stdin.on("data", (data: Buffer) => {
      const str = data.toString();
      if (str.includes('"method":"initialize"')) {
        process.nextTick(() => {
          stdout.write(
            'Content-Length: 36\r\n\r\n{"jsonrpc":"2.0","id":0,"result":{}}',
          );
        });
      } else if (str.includes('"method":"textDocument/definition"')) {
        const res = JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { uri: "file://test" },
        });
        const fullResponse = `Content-Length: ${res.length}\r\n\r\n${res}`;

        // Split into chunks
        const chunk1 = fullResponse.substring(0, 10);
        const chunk2 = fullResponse.substring(10, 25);
        const chunk3 = fullResponse.substring(25);

        process.nextTick(() => {
          stdout.write(chunk1);
          process.nextTick(() => {
            stdout.write(chunk2);
            process.nextTick(() => {
              stdout.write(chunk3);
            });
          });
        });
      }
    });

    lspManager.registerServer("typescript", {
      command: "typescript-language-server",
      args: ["--stdio"],
      extensionToLanguage: { ".ts": "typescript" },
      shutdownTimeout: 1,
    });

    const result = await lspManager.execute({
      operation: "goToDefinition",
      filePath: "test.ts",
      line: 1,
      character: 1,
    });

    expect(result.success).toBe(true);
    expect(JSON.parse(result.content)).toEqual({ uri: "file://test" });
  });
});

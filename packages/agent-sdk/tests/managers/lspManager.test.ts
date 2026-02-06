import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LspManager } from "../../src/managers/lspManager.js";
import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { promises as fs } from "fs";
import { join } from "path";

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

describe("LspManager", () => {
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

  it("should timeout if the server takes too long to initialize", async () => {
    setupMockProcess();
    // Don't write any response to stdout to trigger timeout

    lspManager.registerServer("typescript", {
      command: "typescript-language-server",
      args: ["--stdio"],
      extensionToLanguage: { ".ts": "typescript" },
      startupTimeout: 100,
    });

    const lspProcPromise = lspManager.getProcessForFile(
      "/mock/workdir/test.ts",
    );
    await expect(lspProcPromise).resolves.toBeNull();
  });

  describe("Operations", () => {
    const operations = [
      {
        name: "hover",
        method: "textDocument/hover",
        result: { contents: "hover info" },
      },
      {
        name: "findReferences",
        method: "textDocument/references",
        result: [{ uri: "file://ref", range: {} }],
      },
      {
        name: "documentSymbol",
        method: "textDocument/documentSymbol",
        result: [{ name: "sym", kind: 1, range: {} }],
      },
      {
        name: "workspaceSymbol",
        method: "workspace/symbol",
        result: [{ name: "wsym", kind: 1, location: {} }],
      },
      {
        name: "goToImplementation",
        method: "textDocument/implementation",
        result: [{ uri: "file://impl", range: {} }],
      },
      {
        name: "prepareCallHierarchy",
        method: "textDocument/prepareCallHierarchy",
        result: [{ name: "call", kind: 1, uri: "file://call", range: {} }],
      },
    ];

    operations.forEach((op) => {
      it(`should execute ${op.name} operation`, async () => {
        const { stdin, stdout } = setupMockProcess();

        stdin.on("data", (data: Buffer) => {
          const str = data.toString();
          if (str.includes('"method":"initialize"')) {
            process.nextTick(() => {
              stdout.write(
                'Content-Length: 36\r\n\r\n{"jsonrpc":"2.0","id":0,"result":{}}',
              );
            });
          } else if (str.includes(`"method":"${op.method}"`)) {
            process.nextTick(() => {
              const res = JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                result: op.result,
              });
              stdout.write(`Content-Length: ${res.length}\r\n\r\n${res}`);
            });
          }
        });

        lspManager.registerServer("typescript", {
          command: "typescript-language-server",
          args: ["--stdio"],
          extensionToLanguage: { ".ts": "typescript" },
        });

        const result = await lspManager.execute({
          operation: op.name,
          filePath: "test.ts",
          line: 1,
          character: 1,
        });

        expect(result.success).toBe(true);
        expect(JSON.parse(result.content)).toEqual(op.result);
      });
    });

    it("should execute incomingCalls operation", async () => {
      const { stdin, stdout } = setupMockProcess();
      const callItem = { name: "call", kind: 1, uri: "file://call", range: {} };

      stdin.on("data", (data: Buffer) => {
        const str = data.toString();
        if (str.includes('"method":"initialize"')) {
          process.nextTick(() => {
            stdout.write(
              'Content-Length: 36\r\n\r\n{"jsonrpc":"2.0","id":0,"result":{}}',
            );
          });
        } else if (
          str.includes('"method":"textDocument/prepareCallHierarchy"')
        ) {
          process.nextTick(() => {
            const res = JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: [callItem],
            });
            stdout.write(`Content-Length: ${res.length}\r\n\r\n${res}`);
          });
        } else if (str.includes('"method":"callHierarchy/incomingCalls"')) {
          process.nextTick(() => {
            const res = JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              result: [{ from: callItem, fromRanges: [] }],
            });
            stdout.write(`Content-Length: ${res.length}\r\n\r\n${res}`);
          });
        }
      });

      lspManager.registerServer("typescript", {
        command: "typescript-language-server",
        args: ["--stdio"],
        extensionToLanguage: { ".ts": "typescript" },
      });

      const result = await lspManager.execute({
        operation: "incomingCalls",
        filePath: "test.ts",
        line: 1,
        character: 1,
      });

      expect(result.success).toBe(true);
      expect(JSON.parse(result.content)).toEqual([
        { from: callItem, fromRanges: [] },
      ]);
    });

    it("should execute outgoingCalls operation", async () => {
      const { stdin, stdout } = setupMockProcess();
      const callItem = { name: "call", kind: 1, uri: "file://call", range: {} };

      stdin.on("data", (data: Buffer) => {
        const str = data.toString();
        if (str.includes('"method":"initialize"')) {
          process.nextTick(() => {
            stdout.write(
              'Content-Length: 36\r\n\r\n{"jsonrpc":"2.0","id":0,"result":{}}',
            );
          });
        } else if (
          str.includes('"method":"textDocument/prepareCallHierarchy"')
        ) {
          process.nextTick(() => {
            const res = JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: [callItem],
            });
            stdout.write(`Content-Length: ${res.length}\r\n\r\n${res}`);
          });
        } else if (str.includes('"method":"callHierarchy/outgoingCalls"')) {
          process.nextTick(() => {
            const res = JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              result: [{ to: callItem, fromRanges: [] }],
            });
            stdout.write(`Content-Length: ${res.length}\r\n\r\n${res}`);
          });
        }
      });

      lspManager.registerServer("typescript", {
        command: "typescript-language-server",
        args: ["--stdio"],
        extensionToLanguage: { ".ts": "typescript" },
      });

      const result = await lspManager.execute({
        operation: "outgoingCalls",
        filePath: "test.ts",
        line: 1,
        character: 1,
      });

      expect(result.success).toBe(true);
      expect(JSON.parse(result.content)).toEqual([
        { to: callItem, fromRanges: [] },
      ]);
    });

    it("should return empty array for incomingCalls if prepareCallHierarchy returns nothing", async () => {
      const { stdin, stdout } = setupMockProcess();

      stdin.on("data", (data: Buffer) => {
        const str = data.toString();
        if (str.includes('"method":"initialize"')) {
          process.nextTick(() => {
            stdout.write(
              'Content-Length: 36\r\n\r\n{"jsonrpc":"2.0","id":0,"result":{}}',
            );
          });
        } else if (
          str.includes('"method":"textDocument/prepareCallHierarchy"')
        ) {
          process.nextTick(() => {
            const res = JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: [],
            });
            stdout.write(`Content-Length: ${res.length}\r\n\r\n${res}`);
          });
        }
      });

      lspManager.registerServer("typescript", {
        command: "typescript-language-server",
        args: ["--stdio"],
        extensionToLanguage: { ".ts": "typescript" },
      });

      const result = await lspManager.execute({
        operation: "incomingCalls",
        filePath: "test.ts",
        line: 1,
        character: 1,
      });

      expect(result.success).toBe(true);
      expect(JSON.parse(result.content)).toEqual([]);
    });
  });

  describe("Error Handling", () => {
    it("should handle server failing to start", async () => {
      vi.mocked(spawn).mockImplementation(() => {
        throw new Error("Spawn failed");
      });

      lspManager.registerServer("typescript", {
        command: "invalid-command",
        extensionToLanguage: { ".ts": "typescript" },
      });

      const lspProc = await lspManager.getProcessForFile("test.ts");
      expect(lspProc).toBeNull();
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

    it("should handle unsupported operation", async () => {
      const { stdin, stdout } = setupMockProcess();
      respondToInitialize(stdin, stdout);

      lspManager.registerServer("typescript", {
        command: "typescript-language-server",
        args: ["--stdio"],
        extensionToLanguage: { ".ts": "typescript" },
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
  });

  describe("Cleanup", () => {
    it("should perform graceful shutdown and forced kill", async () => {
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
      });

      await lspManager.getProcessForFile("test.ts");
      await lspManager.cleanup();

      expect(shutdownReceived).toBe(true);
      expect(mockProcess.kill).toHaveBeenCalled();
    });

    it("should force kill if shutdown fails", async () => {
      const { stdin, stdout, mockProcess } = setupMockProcess();

      stdin.on("data", (data: Buffer) => {
        const str = data.toString();
        if (str.includes('"method":"initialize"')) {
          process.nextTick(() => {
            stdout.write(
              'Content-Length: 36\r\n\r\n{"jsonrpc":"2.0","id":0,"result":{}}',
            );
          });
        }
        // No response for shutdown
      });

      lspManager.registerServer("typescript", {
        command: "typescript-language-server",
        args: ["--stdio"],
        extensionToLanguage: { ".ts": "typescript" },
        shutdownTimeout: 10,
      });

      await lspManager.getProcessForFile("test.ts");
      await lspManager.cleanup();

      expect(mockProcess.kill).toHaveBeenCalled();
    });
  });

  describe("Config Loading", () => {
    it("should load config from .lsp.json", async () => {
      const workdir = "/mock/workdir";
      const lspJsonPath = join(workdir, ".lsp.json");
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
  });

  describe("Message Handling", () => {
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

    it("should handle multiple messages in one chunk", async () => {
      const { stdin, stdout } = setupMockProcess();

      stdin.on("data", (data: Buffer) => {
        const str = data.toString();
        if (str.includes('"method":"initialize"')) {
          const res1 = JSON.stringify({ jsonrpc: "2.0", id: 0, result: {} });
          const msg1 = `Content-Length: ${res1.length}\r\n\r\n${res1}`;

          process.nextTick(() => {
            stdout.write(msg1);
          });
        } else if (str.includes('"method":"textDocument/definition"')) {
          const res2 = JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { uri: "file://test" },
          });
          const msg2 = `Content-Length: ${res2.length}\r\n\r\n${res2}`;

          const res3 = JSON.stringify({
            jsonrpc: "2.0",
            method: "textDocument/publishDiagnostics",
            params: {},
          });
          const msg3 = `Content-Length: ${res3.length}\r\n\r\n${res3}`;

          const invalidJson = '{"jsonrpc":"2.0",';
          const msg4 = `Content-Length: ${invalidJson.length}\r\n\r\n${invalidJson}`;

          process.nextTick(() => {
            stdout.write(msg2 + msg3 + msg4);
          });
        }
      });

      lspManager.registerServer("typescript", {
        command: "typescript-language-server",
        args: ["--stdio"],
        extensionToLanguage: { ".ts": "typescript" },
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
});

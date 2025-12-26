import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LspManager } from "../../src/managers/lspManager.js";
import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { PassThrough } from "stream";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

describe("LspManager", () => {
  let lspManager: LspManager;

  beforeEach(() => {
    lspManager = new LspManager();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await lspManager.cleanup();
  });

  it("should register and start an LSP server", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const mockProcess = new EventEmitter() as unknown as ChildProcess;
    mockProcess.stdin = stdin;
    mockProcess.stdout = stdout;
    mockProcess.stderr = stderr;
    mockProcess.kill = vi.fn();

    stdin.on("data", (data: Buffer) => {
      const str = data.toString();
      if (str.includes('"method":"initialize"')) {
        stdout.write(
          'Content-Length: 36\r\n\r\n{"jsonrpc":"2.0","id":0,"result":{}}',
        );
      }
    });

    vi.mocked(spawn).mockReturnValue(mockProcess);

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
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const mockProcess = new EventEmitter() as unknown as ChildProcess;
    mockProcess.stdin = stdin;
    mockProcess.stdout = stdout;
    mockProcess.stderr = stderr;
    mockProcess.kill = vi.fn();

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

    vi.mocked(spawn).mockReturnValue(mockProcess);

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
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const mockProcess = new EventEmitter() as unknown as ChildProcess;
    mockProcess.stdin = stdin;
    mockProcess.stdout = stdout;
    mockProcess.stderr = stderr;
    mockProcess.kill = vi.fn();

    // Don't write any response to stdout to trigger timeout

    vi.mocked(spawn).mockReturnValue(mockProcess);

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
});

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

describe("LspManager protocol robustness", () => {
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
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import * as fs from "fs";

// ── Mocks ──────────────────────────────────────────────────────

const mockSpawn = vi.hoisted(() => vi.fn());
const mockCreateInterface = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  default: { spawn: mockSpawn },
  spawn: mockSpawn,
}));

vi.mock("readline", () => ({
  default: { createInterface: mockCreateInterface },
  createInterface: mockCreateInterface,
}));

vi.mock("fs", () => ({
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

const appendSpy = vi.mocked(fs.appendFileSync);

interface MockProc extends EventEmitter {
  stdin: { write: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function createMockProc(): MockProc {
  const proc = new EventEmitter() as MockProc;
  proc.stdin = { write: vi.fn() };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

// ── Import after mocks ─────────────────────────────────────────

import { StdioClient } from "../../src/stdio/stdioClient";

describe("StdioClient host logging (vscode.log)", () => {
  let proc: MockProc;

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.DISABLE_LOGGER_IO;
    proc = createMockProc();
    mockSpawn.mockReturnValue(proc);
    mockCreateInterface.mockReturnValue(new EventEmitter());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const lastAppend = () =>
    appendSpy.mock.calls[appendSpy.mock.calls.length - 1]!;

  it("logs spawn errors to vscode.log at ERROR level", () => {
    new StdioClient("/fake/wave", ["--stdio"]);

    proc.emit("error", new Error("ENOENT"));

    const [file, content] = lastAppend();
    expect(String(file)).toContain("vscode.log");
    expect(String(content)).toContain("[ERROR]");
    expect(String(content)).toContain("Process error");
    expect(String(content)).toContain("ENOENT");
  });

  it("logs process exit with code/signal and stderr tail at ERROR level", () => {
    new StdioClient("/fake/wave", ["--stdio"]);

    proc.stderr.emit("data", Buffer.from("boom line\n"));
    proc.emit("exit", 1, null);

    const [file, content] = lastAppend();
    expect(String(file)).toContain("vscode.log");
    expect(String(content)).toContain("[ERROR]");
    expect(String(content)).toContain("process exited (code: 1, signal: null)");
    expect(String(content)).toContain("boom line");
  });

  it("logs child stderr lines at WARN level", () => {
    new StdioClient("/fake/wave", ["--stdio"]);

    proc.stderr.emit("data", Buffer.from("runtime warning\n"));

    const [file, content] = lastAppend();
    expect(String(file)).toContain("vscode.log");
    expect(String(content)).toContain("[WARN]");
    expect(String(content)).toContain("runtime warning");
  });

  it("logs unparseable stdout lines at ERROR level", () => {
    const rl = new EventEmitter() as EventEmitter & {
      on: (event: string, cb: (line: string) => void) => EventEmitter;
    };
    mockCreateInterface.mockReturnValue(rl);

    new StdioClient("/fake/wave", ["--stdio"]);

    const lineHandler = rl.listeners("line")[0] as (line: string) => void;
    lineHandler("not-json");

    const [file, content] = lastAppend();
    expect(String(file)).toContain("vscode.log");
    expect(String(content)).toContain("[ERROR]");
    expect(String(content)).toContain("Failed to parse");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { Readable } from "stream";
import * as fs from "fs";
import type { ChildProcess } from "child_process";
import { StdioClient } from "../src/main/stdio/stdioClient.js";

const h = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawn: h.spawnMock,
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

interface FakeChild {
  proc: ChildProcess;
  stdin: EventEmitter & { write: ReturnType<typeof vi.fn> };
  stdout: Readable;
  stderr: EventEmitter;
}

function createFakeChild(): FakeChild {
  const stdin = new EventEmitter() as FakeChild["stdin"];
  stdin.write = vi.fn();
  // readline's createInterface calls resume() on the input stream.
  const stdout = new Readable({ read: () => {} });
  const stderr = new EventEmitter();
  const proc = new EventEmitter() as ChildProcess;
  (proc as unknown as Record<string, unknown>).stdin = stdin;
  (proc as unknown as Record<string, unknown>).stdout = stdout;
  (proc as unknown as Record<string, unknown>).stderr = stderr;
  (proc as unknown as Record<string, unknown>).kill = vi.fn();
  return { proc, stdin, stdout, stderr };
}

describe("StdioClient host logging (desktop.log)", () => {
  let child: FakeChild;

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.DISABLE_LOGGER_IO;
    child = createFakeChild();
    h.spawnMock.mockReturnValue(child.proc);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const lastAppend = () => appendSpy.mock.calls.at(-1)!;

  it("logs spawn errors to desktop.log at ERROR level", () => {
    new StdioClient("wave", ["--stdio"]);

    child.proc.emit("error", new Error("ENOENT: no such file"));

    const [file, content] = lastAppend();
    expect(String(file)).toContain("desktop.log");
    expect(String(content)).toContain("[ERROR]");
    expect(String(content)).toContain("[wave-stdio] Process error");
    expect(String(content)).toContain("ENOENT");
  });

  it("logs process exit with code/signal and stderr tail at ERROR level", () => {
    new StdioClient("wave", ["--stdio"]);

    child.stderr.emit("data", Buffer.from("boom line\n"));
    child.proc.emit("exit", 1, null);

    const [file, content] = lastAppend();
    expect(String(file)).toContain("desktop.log");
    expect(String(content)).toContain("[ERROR]");
    expect(String(content)).toContain("process exited (code: 1, signal: null)");
    expect(String(content)).toContain("boom line");
  });

  it("logs child stderr lines at WARN level", () => {
    new StdioClient("wave", ["--stdio"]);

    child.stderr.emit("data", Buffer.from("runtime warning\n"));

    const [file, content] = lastAppend();
    expect(String(file)).toContain("desktop.log");
    expect(String(content)).toContain("[WARN]");
    expect(String(content)).toContain("runtime warning");
  });
});

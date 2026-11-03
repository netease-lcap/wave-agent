/**
 * The daemon's stderr log. Two properties matter and both are about *not* lying to
 * the user: the tail read must be scoped to this launch (a previous daemon's
 * error is not this failure), and none of it may ever prevent the daemon from
 * starting (an unwritable log is a lost diagnostic, not a hard failure).
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  daemonLogDir,
  daemonLogFile,
  openDaemonLogForChild,
  readDaemonLogTail,
  rotateDaemonLog,
} from "../../src/daemon/daemonLog.js";

const logsDir = path.join(os.tmpdir(), `wave-daemon-log-test-${process.pid}`);
const logFile = path.join(logsDir, "daemon.log");

beforeEach(() => {
  fs.rmSync(logsDir, { recursive: true, force: true });
  process.env.WAVE_LOGS_DIR = logsDir;
});

afterEach(() => {
  delete process.env.WAVE_LOGS_DIR;
  fs.rmSync(logsDir, { recursive: true, force: true });
});

describe("paths", () => {
  test("WAVE_LOGS_DIR redirects the log file", () => {
    expect(daemonLogDir()).toBe(logsDir);
    expect(daemonLogFile()).toBe(logFile);
  });

  test("without the override the log lives next to the other wave logs", () => {
    delete process.env.WAVE_LOGS_DIR;
    expect(daemonLogFile()).toBe(
      path.join(os.homedir(), ".wave", "logs", "daemon.log"),
    );
  });
});

describe("openDaemonLogForChild", () => {
  test("creates the directory and opens an append handle at offset 0", () => {
    const handle = openDaemonLogForChild();
    expect(handle).toBeDefined();
    expect(handle!.file).toBe(logFile);
    expect(handle!.offset).toBe(0);
    fs.writeSync(handle!.fd, "first launch\n");
    fs.closeSync(handle!.fd);
    expect(fs.readFileSync(logFile, "utf8")).toBe("first launch\n");
  });

  test("a later launch starts at the current end of file", () => {
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(logFile, "previous launch error\n");
    const handle = openDaemonLogForChild();
    expect(handle!.offset).toBe("previous launch error\n".length);
    fs.closeSync(handle!.fd);
    // The previous launch's output is not this launch's diagnostic.
    expect(readDaemonLogTail(handle)).toBe("");
  });

  test("an unwritable directory degrades to undefined instead of throwing", () => {
    fs.mkdirSync(logsDir, { recursive: true });
    const blocker = path.join(logsDir, "blocked");
    fs.writeFileSync(blocker, "");
    process.env.WAVE_LOGS_DIR = blocker;
    expect(openDaemonLogForChild()).toBeUndefined();
  });
});

describe("readDaemonLogTail", () => {
  test("no handle means no tail", () => {
    expect(readDaemonLogTail(undefined)).toBe("");
  });

  test("returns the last non-empty line, de-ANSI'd and collapsed to one line", () => {
    const handle = openDaemonLogForChild()!;
    fs.writeSync(handle.fd, "\u001b[31mError: listen EACCES\u001b[0m\n\n");
    fs.closeSync(handle.fd);
    expect(readDaemonLogTail(handle)).toBe("Error: listen EACCES");
  });

  test("caps a long line so the client error stays one readable line", () => {
    const handle = openDaemonLogForChild()!;
    fs.writeSync(handle.fd, `${"x".repeat(500)}\n`);
    fs.closeSync(handle.fd);
    const tail = readDaemonLogTail(handle, 50);
    expect(tail).toHaveLength(51);
    expect(tail.endsWith("…")).toBe(true);
  });
});

describe("rotateDaemonLog", () => {
  test("leaves a small log alone", () => {
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(logFile, "small");
    rotateDaemonLog(logFile, 1024);
    expect(fs.readFileSync(logFile, "utf8")).toBe("small");
    expect(fs.existsSync(`${logFile}.1`)).toBe(false);
  });

  test("moves an oversized log aside, keeping one generation", () => {
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(`${logFile}.1`, "older");
    fs.writeFileSync(logFile, "x".repeat(64));
    rotateDaemonLog(logFile, 16);
    expect(fs.readFileSync(`${logFile}.1`, "utf8")).toBe("x".repeat(64));
    expect(fs.existsSync(logFile)).toBe(false);
  });

  test("a missing log is not an error", () => {
    expect(() => rotateDaemonLog(logFile)).not.toThrow();
  });
});

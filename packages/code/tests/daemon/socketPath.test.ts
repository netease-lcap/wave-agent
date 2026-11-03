/**
 * The daemon's single addressing rule: one socket path in, the platform's
 * connectable address out. Both sides (client `wave daemon <cmd>` and server
 * `wave --daemon <socket>`) derive it through this module, so these tests pin the
 * mapping itself rather than any particular transport.
 */

import { describe, test, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  DEFAULT_DAEMON_SOCKET_FILE,
  describeListenError,
  isWindowsPipeName,
  resolveDaemonSocket,
  windowsPipeNameFor,
} from "../../src/daemon/socketPath.js";

describe("resolveDaemonSocket", () => {
  test("POSIX keeps the file path as the address, unchanged", () => {
    const socketPath = path.join(os.homedir(), ".wave", "daemon.sock");
    expect(resolveDaemonSocket("linux", socketPath)).toBe(socketPath);
    expect(resolveDaemonSocket("darwin", socketPath)).toBe(socketPath);
  });

  test("Windows maps the default socket file to a named pipe", () => {
    const resolved = resolveDaemonSocket("win32", DEFAULT_DAEMON_SOCKET_FILE);
    expect(isWindowsPipeName(resolved)).toBe(true);
    expect(resolved).toBe(windowsPipeNameFor(DEFAULT_DAEMON_SOCKET_FILE));
  });

  test("every spelling of the default path derives the same pipe", () => {
    const canonical = windowsPipeNameFor(
      path.resolve(DEFAULT_DAEMON_SOCKET_FILE),
    );
    // Forward slashes and a redundant segment — how a user typing the path out
    // by hand would spell it.
    const spelled = DEFAULT_DAEMON_SOCKET_FILE.replace(/\\/g, "/");
    expect(resolveDaemonSocket("win32", spelled)).toBe(canonical);
    expect(
      resolveDaemonSocket(
        "win32",
        path.join(DEFAULT_DAEMON_SOCKET_FILE, "..", "daemon.sock"),
      ),
    ).toBe(canonical);
  });

  test("Windows leaves an explicit pipe name alone (verbatim --daemon argument)", () => {
    const pipe = "\\\\.\\pipe\\my-own-daemon";
    expect(resolveDaemonSocket("win32", pipe)).toBe(pipe);
  });

  test("Windows passes a non-default path through, so a bad path still fails loudly", () => {
    // The daemon cannot bind a file path on Windows; rewriting it would hide the
    // real error behind a name the user never asked for.
    const explicit = path.join(os.tmpdir(), "explicit.sock");
    expect(resolveDaemonSocket("win32", explicit)).toBe(explicit);
  });

  test("both sides derive the same name, deterministically", () => {
    const first = windowsPipeNameFor(DEFAULT_DAEMON_SOCKET_FILE);
    expect(windowsPipeNameFor(DEFAULT_DAEMON_SOCKET_FILE)).toBe(first);
  });

  test("different socket paths get different pipe names", () => {
    const a = windowsPipeNameFor(path.join(os.homedir(), "a", "daemon.sock"));
    const b = windowsPipeNameFor(path.join(os.homedir(), "b", "daemon.sock"));
    expect(a).not.toBe(b);
  });

  test("the pipe name is digest-based, so it carries no path characters", () => {
    const name = windowsPipeNameFor(DEFAULT_DAEMON_SOCKET_FILE);
    // '\\' and ':' are illegal in a pipe name; the device prefix is the only one.
    expect(name.slice("\\\\.\\pipe\\".length)).toMatch(/^[\w.-]+$/);
    expect(name).toContain(
      createHash("sha256")
        .update(DEFAULT_DAEMON_SOCKET_FILE)
        .digest("hex")
        .slice(0, 32),
    );
  });
});

describe("isWindowsPipeName", () => {
  test("recognises both device prefixes", () => {
    expect(isWindowsPipeName("\\\\.\\pipe\\wave-daemon-x")).toBe(true);
    expect(isWindowsPipeName("\\\\?\\pipe\\wave-daemon-x")).toBe(true);
  });

  test("rejects file paths on either platform", () => {
    expect(isWindowsPipeName(DEFAULT_DAEMON_SOCKET_FILE)).toBe(false);
    expect(
      isWindowsPipeName(path.join(os.tmpdir(), "wave-daemon-test.sock")),
    ).toBe(false);
    expect(isWindowsPipeName("C:\\Users\\me\\.wave\\daemon.sock")).toBe(false);
  });
});

describe("describeListenError", () => {
  test("EADDRINUSE names the daemon instead of leaking the raw code", () => {
    const err = Object.assign(new Error("listen EADDRINUSE"), {
      code: "EADDRINUSE",
    });
    expect(describeListenError("\\\\.\\pipe\\x", err).message).toBe(
      "Another wave daemon is already listening on \\\\.\\pipe\\x",
    );
  });

  test("any other error is reported as it came", () => {
    const err = Object.assign(new Error("listen EACCES"), { code: "EACCES" });
    expect(describeListenError("/tmp/x.sock", err)).toBe(err);
  });
});

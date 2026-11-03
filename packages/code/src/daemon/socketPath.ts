/**
 * Daemon socket addressing — one default, two platform shapes.
 *
 * POSIX keeps the file-socket it has always used (`~/.wave/daemon.sock`). On
 * Windows libuv only accepts the `\\.\pipe\` shape: handing `net.Server.listen`
 * a filesystem path fails with `EACCES` and the `.sock` file is never created,
 * so the daemon could not start at all there. The default is therefore mapped to
 * a named pipe on Windows.
 *
 * Two constraints shape the mapping:
 * - the pipe namespace is **machine-global** (every OS user shares `\\.\pipe\`),
 *   so the name must carry a per-user component — otherwise one user's daemon
 *   occupies another's default socket;
 * - a home path cannot be embedded verbatim, because `\` and `:` are illegal in
 *   pipe names. Hence a stable digest of the default path, not the path itself.
 *
 * The mapping applies to **the default socket only**, and it is applied on both
 * sides (client and `--daemon` server) by this one function. A name that is
 * already a pipe, or any other path, is used verbatim: rewriting what the caller
 * named would silently point the daemon somewhere else.
 */

import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

/** The default daemon socket as a file path — the shape POSIX listens on. */
export const DEFAULT_DAEMON_SOCKET_FILE = path.join(
  os.homedir(),
  ".wave",
  "daemon.sock",
);

/** libuv's Windows named-pipe prefixes (`\\.\pipe\` is the documented form). */
const WINDOWS_PIPE_PREFIXES = ["\\\\.\\pipe\\", "\\\\?\\pipe\\"] as const;

/** True when `socketPath` is already a Windows named-pipe name. */
export function isWindowsPipeName(socketPath: string): boolean {
  return WINDOWS_PIPE_PREFIXES.some((prefix) => socketPath.startsWith(prefix));
}

/**
 * Derive the pipe name for a file-path socket. The digest is stable per path, so
 * the same user always lands on the same name (a re-launched daemon finds and
 * refuses to double-bind it), while different home directories — different OS
 * users on one machine — land on different names.
 */
export function windowsPipeNameFor(socketFilePath: string): string {
  const digest = createHash("sha256")
    .update(socketFilePath)
    .digest("hex")
    .slice(0, 32);
  return `\\\\.\\pipe\\wave-daemon-${digest}`;
}

/**
 * Same file, allowing for how it was spelled — separator style, `.`/`..`
 * segments, and (on Windows) letter case. A user who writes the default socket
 * out by hand rarely matches `path.join`'s spelling byte for byte
 * (`C:/Users/me/.wave/daemon.sock` vs `C:\Users\me\.wave\daemon.sock`), and
 * missing that match would land the server on an `EACCES` instead of the pipe the
 * client derives.
 */
function isSameFilePath(
  a: string,
  b: string,
  platform: NodeJS.Platform,
): boolean {
  if (a === b) return true;
  const resolvedA = path.resolve(a);
  const resolvedB = path.resolve(b);
  return platform === "win32"
    ? resolvedA.toLowerCase() === resolvedB.toLowerCase()
    : resolvedA === resolvedB;
}

/**
 * Resolve the socket a caller means: identity on POSIX, and on Windows the pipe
 * form of the default socket (anything else — an explicit path or a name that is
 * already a pipe — is returned unchanged).
 */
export function resolveDaemonSocket(
  platform: NodeJS.Platform,
  socketPath: string,
): string {
  if (platform !== "win32") return socketPath;
  if (isWindowsPipeName(socketPath)) return socketPath;
  return isSameFilePath(socketPath, DEFAULT_DAEMON_SOCKET_FILE, platform)
    ? // Digest the canonical spelling so every way of writing the default socket
      // derives the same name — the pipe is a shared address, not a per-caller one.
      windowsPipeNameFor(path.resolve(socketPath))
    : socketPath;
}

/**
 * The fixed default socket every `wave daemon` subcommand talks to (spec:
 * 默认 socket 固定，形态随平台). No `--socket` override exists, so this is the
 * only address the client side ever uses.
 */
export const DEFAULT_DAEMON_SOCKET = resolveDaemonSocket(
  process.platform,
  DEFAULT_DAEMON_SOCKET_FILE,
);

/**
 * Translate a `listen` failure on a daemon address. `EADDRINUSE` is the shape a
 * second daemon takes when the first one already holds the name — on Windows that
 * is the *only* shape, since a pipe name has no stale file to probe first (the
 * POSIX path detects the same situation by connecting to the socket file). The
 * raw errno tells a user nothing actionable, so it becomes the same sentence both
 * platforms report.
 */
export function describeListenError(
  socketPath: string,
  err: NodeJS.ErrnoException,
): Error {
  if (err.code === "EADDRINUSE") {
    return new Error(
      `Another wave daemon is already listening on ${socketPath}`,
    );
  }
  return err;
}

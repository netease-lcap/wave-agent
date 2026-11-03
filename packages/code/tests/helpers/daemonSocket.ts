/**
 * A socket address the daemon tests can actually bind on this platform.
 *
 * POSIX gets a file socket under the temp dir. Windows has no file sockets at all
 * (libuv rejects a non-`\\.\pipe\` path with `EACCES`), so the same tests run
 * against a named pipe — which is also what the shipped default socket is on that
 * platform (`src/daemon/socketPath.ts`). Deriving the address here keeps the
 * suite exercising the real transport on Windows instead of skipping it.
 *
 * Seeds must stay unique per server: pipe names live in a machine-global
 * namespace, so concurrent workers must not collide.
 */

import * as os from "node:os";
import * as path from "node:path";

let counter = 0;

export function daemonTestSocketPath(seed: string): string {
  const unique = `${seed}-${process.pid}-${Date.now()}-${counter++}`;
  return process.platform === "win32"
    ? `\\\\.\\pipe\\wave-daemon-test-${unique}`
    : path.join(os.tmpdir(), `wave-daemon-test-${unique}.sock`);
}

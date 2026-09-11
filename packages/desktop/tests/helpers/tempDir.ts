import * as fs from "fs";
import * as os from "os";

/**
 * %TEMP% on some Windows machines resolves through an 8.3 short name
 * (e.g. C:\Users\LIUYIQ~1\...). libuv's Windows fs-event backend asserts
 * (src\win\fs-event.c) when ReadDirectoryChangesW reports long-form event
 * names that don't prefix-match the short-form watch dir — the whole process
 * aborts the first time a watched directory sees an event.
 *
 * Suites that run real Agents/CLIs under the temp dir must start from a
 * long-form root instead. `fs.realpathSync()` alone keeps short names; only
 * the `.native()` variant expands them.
 */
export function longFormTempDir(): string {
  const tmp = os.tmpdir();
  if (process.platform !== "win32") {
    return tmp;
  }
  try {
    return fs.realpathSync.native(tmp);
  } catch {
    return tmp;
  }
}

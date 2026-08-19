import * as os from "os";
import * as path from "path";

/**
 * %TEMP% on some Windows machines resolves through an 8.3 short name
 * (e.g. C:\Users\LIUYIQ~1\...). libuv's Windows fs-event backend asserts
 * (src\win\fs-event.c) when ReadDirectoryChangesW reports long-form event
 * names that don't prefix-match the short-form watch dir — the whole process
 * aborts when a watched file is created then deleted. Tests that run real
 * watchers (chokidar/FileWatcherService) or real Agents under the temp dir
 * must use a long-form temp dir instead when the default one contains a
 * short name.
 */
export function longFormTempDir(): string {
  const tmp = os.tmpdir();
  // 8.3 short names always match `~N` (e.g. LIUYIQ~1); healthy temp dirs
  // don't contain that pattern.
  if (process.platform === "win32" && /~\d/.test(tmp)) {
    return path.join(process.env.LOCALAPPDATA ?? os.homedir(), "Temp");
  }
  return tmp;
}

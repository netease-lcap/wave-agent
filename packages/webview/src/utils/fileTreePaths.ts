import { normalizeFilePath } from "./messageUtils";

/**
 * Path arithmetic for the file panel's directory tree. Pure string work: the
 * webview has no `path` module, and the same helpers have to serve POSIX remote
 * paths and win32 local ones — the separator style of the parent decides the
 * child's, so `C:\repo` keeps backslashes while `/home/u/repo` keeps slashes.
 */

/** `<dir>/<name>` with the parent's own separator style. */
export const childPath = (dir: string, name: string): string => {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return `${dir.replace(/[\\/]+$/, "")}${sep}${name}`;
};

/** Last segment — what the tree's root row and a tab show. */
export const baseNameOf = (path: string): string => {
  const normalized = normalizeFilePath(path);
  const cut = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  return cut >= 0 ? normalized.slice(cut + 1) || normalized : normalized;
};

/** Parent directory, or the input itself when it is a root. */
export const parentOf = (path: string): string => {
  const normalized = normalizeFilePath(path);
  const cut = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  // Keep the root's own slash (`/repo` → `/`, `C:\repo` → `C:\`).
  if (cut < 0) return normalized;
  const parent = normalized.slice(0, cut);
  return parent === "" || /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent;
};

/** Is `path` the root itself or somewhere under it? */
export const isUnder = (path: string, root: string): boolean => {
  const p = normalizeFilePath(path);
  const r = normalizeFilePath(root).replace(/[\\/]+$/, "");
  return p === r || p.startsWith(`${r}/`) || p.startsWith(`${r}\\`) || r === "";
};

/**
 * Every ancestor directory of `path` down to (and including) `root` — what
 * 「在文件树中显示」 has to expand so the row becomes reachable. Stops at the
 * root so a path outside the tree cannot expand the whole filesystem.
 */
export const ancestorsWithin = (path: string, root: string): string[] => {
  const out: string[] = [];
  let current = parentOf(path);
  const stop = normalizeFilePath(root).replace(/[\\/]+$/, "");
  while (isUnder(current, root) || current === stop) {
    out.push(current);
    const next = parentOf(current);
    if (next === current) break;
    current = next;
  }
  return out;
};

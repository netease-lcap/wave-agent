import { parentOf } from "./fileTreePaths";
import { normalizeFilePath } from "./messageUtils";

/**
 * Where a `<a href>` inside a rendered markdown file points, if that is a local
 * file the panel can open.
 *
 * The panel renders markdown into the app document, so an unresolved click is a
 * real navigation of the whole window — a relative href resolves against the
 * app's own URL (`file://…/app.asar/webview/…`), not against the file being
 * read. That is the incident this exists for: `[spec](020-mini-app/spec.md)` in
 * `docs/specs/index.md` tried to load `app.asar/webview/020-mini-app/spec.md`.
 *
 * Resolution follows the markdown source, i.e. the *directory of the file being
 * previewed* — `[x](../a.md)` from `/repo/docs/index.md` is `/repo/a.md`.
 *
 * Returns null when the link is not a local file (external scheme, in-page
 * `#anchor`, empty), which means "leave the click to its default handler".
 */
export const resolveMarkdownLinkTarget = (
  href: string,
  currentFilePath: string,
): string | null => {
  const raw = href.trim();
  // `#section` scrolls within the document — never a file.
  if (!raw || raw.startsWith("#")) return null;

  // A link may carry `?query` / `#fragment`: neither is part of the path.
  const pathPart = raw.split("#")[0].split("?")[0];
  if (!pathPart) return null;
  const decoded = tryDecode(pathPart);

  if (/^file:/i.test(decoded)) return fileUrlToPath(decoded);
  // Any other scheme (http, https, mailto, data, javascript…) has its own
  // handler — the panel must not turn it into a filesystem read.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) return null;

  if (isAbsolutePath(decoded)) return normalizeFilePath(decoded);
  if (!currentFilePath) return null;
  return normalizeFilePath(`${parentOf(currentFilePath)}/${decoded}`);
};

/** `/repo/x.md` and `C:\repo\x.md` — already rooted, nothing to resolve. */
const isAbsolutePath = (path: string): boolean =>
  /^([A-Za-z]:[\\/]|\/)/.test(path);

/** Markdown URLs percent-encode (spaces above all); a stray `%` must not throw. */
const tryDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** `file:///repo/x.md` → `/repo/x.md`; `file:///C:/repo/x.md` → `C:/repo/x.md`. */
const fileUrlToPath = (href: string): string | null => {
  let pathname: string;
  try {
    pathname = new URL(href).pathname;
  } catch {
    return null;
  }
  const decoded = tryDecode(pathname);
  if (!decoded) return null;
  // URL pathnames are always POSIX: strip the `/` that precedes a drive letter.
  return normalizeFilePath(decoded.replace(/^\/([A-Za-z]:)/, "$1"));
};

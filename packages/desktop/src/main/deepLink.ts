/**
 * `wave://` deep link contract (spec: docs/specs/desktop/desktop-deep-link.md).
 *
 * Protocol *registration* and the three platform receive paths live in
 * `index.ts`; this module owns only the URL itself so it can be unit-tested
 * without Electron.
 *
 * ```
 * wave://clone?repo=<url>&ref=<branch>&prompt=<text>
 * ```
 *
 * The link carries **no credential of any kind**: authentication is whatever
 * this machine is already logged in with (the Wave SSO token in `auth.json`).
 * A link is forged-able by any web page, so it must never be able to install an
 * identity. Unknown query keys are ignored.
 *
 * Three load-bearing constraints (spec「边界情况」):
 *  - Whole-URL length is capped well below the Windows `ShellExecute` ceiling
 *    (2046–2083, measured) because going over fails *silently* — the browser
 *    still shows its "open this app?" prompt and then nothing happens. The cap
 *    has to be enforced here, on the app side, or the failure is unreadable.
 *  - The repository address is limited to http(s)/ssh. Local paths and
 *    `file://` are rejected: the link is an unauthenticated entry point any web
 *    page can forge, so it must not be able to reach the local filesystem. A
 *    password in the URL is rejected for the mirror-image reason — git would
 *    copy it into `.git/config`.
 *  - Everything is percent-encoded on the wire (Chinese prompts inflate ~9
 *    bytes per character), and a malformed escape must degrade to the raw text
 *    rather than aborting the whole link.
 */

export const DEEP_LINK_SCHEME = "wave";

/** Sole action defined today (spec「非目标」: no open-session/open-file links). */
export const DEEP_LINK_CLONE_ACTION = "clone";

/**
 * Conservative whole-URL budget: half of the measured Windows ceiling, leaving
 * room for the handler executable path (which shares the same budget).
 */
export const MAX_DEEP_LINK_LENGTH = 1000;

/** Thrown for every rejection reason; the message is shown to the user as-is. */
export class DeepLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeepLinkError";
  }
}

export interface CloneDeepLink {
  action: typeof DEEP_LINK_CLONE_ACTION;
  /** Repository address without userinfo (credentials never travel in it). */
  repo: string;
  ref?: string;
  prompt?: string;
}

/**
 * Locate a deep link inside `process.argv` / a `second-instance` command line.
 *
 * Never index by position: Chromium appends its own switches to a second
 * instance's argv and the documented order is not guaranteed. Windows may also
 * hand the URL over still wrapped in quotes (the registry template is
 * `"exe" "%1"`), which `normalizeDeepLink` strips.
 */
export function findDeepLink(args: readonly string[]): string | undefined {
  for (const arg of args) {
    if (typeof arg !== "string") continue;
    const normalized = normalizeDeepLink(arg);
    if (normalized.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}://`)) {
      return normalized;
    }
  }
  return undefined;
}

/** Parse and validate a `wave://clone` link. @throws DeepLinkError */
export function parseCloneDeepLink(rawInput: string): CloneDeepLink {
  const raw = normalizeDeepLink(rawInput);

  if (raw.length > MAX_DEEP_LINK_LENGTH) {
    throw new DeepLinkError(
      `链接过长（${raw.length} 字符，上限 ${MAX_DEEP_LINK_LENGTH}）`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new DeepLinkError("链接格式无效");
  }

  if (parsed.protocol.toLowerCase() !== `${DEEP_LINK_SCHEME}:`) {
    throw new DeepLinkError(`不支持的协议：${parsed.protocol}`);
  }

  // `wave://clone?…` puts the action in the authority; browsers sometimes
  // normalize to `wave:///clone?…`, which lands in the path instead.
  const action = (
    parsed.hostname ||
    parsed.pathname.split("/").find(Boolean) ||
    ""
  ).toLowerCase();
  if (action !== DEEP_LINK_CLONE_ACTION) {
    throw new DeepLinkError(`不支持的唤起动作：${action || "(空)"}`);
  }

  const params = parseQuery(rawQueryPart(raw));

  const repo = (params.get("repo") ?? "").trim();
  if (!repo) {
    throw new DeepLinkError("链接缺少仓库地址（repo）");
  }
  if (!isSupportedRepoUrl(repo)) {
    throw new DeepLinkError(`不支持的仓库地址：${repo}`);
  }

  const ref = (params.get("ref") ?? "").trim();
  if (ref && !isValidRef(ref)) {
    throw new DeepLinkError(`分支名非法：${ref}`);
  }

  // `?? undefined`-style empty strings collapse: an absent prompt/ref and an
  // empty one behave identically downstream. Any other key — a credential a
  // sender decided to add, say — is simply not read.
  return {
    action: DEEP_LINK_CLONE_ACTION,
    repo,
    ...(ref ? { ref } : {}),
    ...(params.get("prompt") ? { prompt: params.get("prompt") } : {}),
  };
}

/** `https://host/path` / `ssh://user@host:port/path` — a scheme we can clone. */
const NETWORK_REPO_URL_RE = /^(?:https?|ssh):\/\/[^\s/]+/i;

/**
 * scp-like `git@host:group/repo.git`. `[^\s/@:]+` for the user part on purpose:
 * a `:` there would be a password, which the `https?`/`ssh` branch rejects too.
 */
const SCP_LIKE_REPO_RE = /^[^\s/@:]+@[^\s/:]+:[^\s]+$/;

/**
 * http(s) and ssh only. `file://`, bare local paths and `git://` are rejected —
 * a link is an unauthenticated entry point, so it must not name the local
 * filesystem. The scp-like `git@host:group/repo.git` form counts as ssh.
 *
 * A *password* in the URL's userinfo is rejected as well: `git clone
 * https://user:pass@host/repo.git` writes the remote URL into `.git/config`, so
 * accepting one would persist a credential on disk (spec「凭据不复用到任何落盘
 * 位置」story 2 场景 6). A bare username stays legal — ssh needs `git@host`.
 */
export function isSupportedRepoUrl(repo: string): boolean {
  if (SCP_LIKE_REPO_RE.test(repo)) return true;
  if (!NETWORK_REPO_URL_RE.test(repo)) return false;
  return !hasUrlPassword(repo);
}

/** True when the authority carries `user:pass@` (rather than `user@`/no user). */
function hasUrlPassword(repo: string): boolean {
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#\s]*)/i.exec(repo)?.[1] ?? "";
  const at = authority.lastIndexOf("@");
  if (at < 0) return false;
  return authority.slice(0, at).includes(":");
}

/**
 * Branch/tag sanity check. The value is passed to git as a separate argv
 * element (no shell), so this is defence in depth, not injection control — it
 * keeps option-looking refs (`-x`) and git's own ref grammar violations out.
 */
export function isValidRef(ref: string): boolean {
  if (!ref || ref.length > 255) return false;
  if (/[\s~^:?*[\\]/.test(ref)) return false;
  if (ref.startsWith("-") || ref.startsWith(".")) return false;
  if (ref.includes("..") || ref.includes("@{")) return false;
  if (ref.includes("//")) return false;
  if (ref.endsWith("/") || ref.endsWith(".") || ref.endsWith(".lock"))
    return false;
  return true;
}

/**
 * Directory name to clone into: the last path segment of the repository, minus
 * a `.git` suffix. The user picks the *parent* directory (VS Code's Git: Clone
 * behaves the same), so the link can never name an absolute destination.
 */
export function repoDirectoryName(repo: string): string {
  const withoutTrailingSlash = repo.replace(/\/+$/, "");
  const segments = withoutTrailingSlash.split(/[/:]/).filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  const name = last.replace(/\.git$/i, "").trim();
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) {
    return "";
  }
  return name;
}

/** Trim whitespace and peel the quotes Windows may leave around the URL. */
function normalizeDeepLink(input: string): string {
  let value = (input ?? "").trim();
  while (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return value;
}

/**
 * The query string, sliced out of the *raw* input rather than read back from
 * `URL.search`: `URL` re-serializes what it parsed, so a stray `%` in the source
 * (`prompt=100%完成`) comes back double-mangled (`100%%E5%AE%8C…`) instead of
 * degrading to the text the sender wrote. The `#` cut mirrors URL semantics.
 */
function rawQueryPart(raw: string): string {
  const start = raw.indexOf("?");
  if (start < 0) return "";
  const query = raw.slice(start + 1);
  const hash = query.indexOf("#");
  return hash < 0 ? query : query.slice(0, hash);
}

/**
 * Query parser that does not go through `URLSearchParams`: its `+` → space
 * rule is form-encoding specific, and `decodeURIComponent` throws on a lone
 * `%`. Both are handled explicitly so one malformed byte cannot abort the link.
 */
function parseQuery(search: string): Map<string, string> {
  const params = new Map<string, string>();
  const query = search.startsWith("?") ? search.slice(1) : search;
  if (!query) return params;
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = decodeComponent(eq < 0 ? pair : pair.slice(0, eq));
    if (params.has(key)) continue;
    params.set(key, decodeComponent(eq < 0 ? "" : pair.slice(eq + 1)));
  }
  return params;
}

function decodeComponent(value: string): string {
  try {
    // `+` means space in form-encoded URLs (URLSearchParams) and is never a
    // literal `+` in encodeURIComponent output (that arrives as `%2B`), so
    // mapping it keeps both senders readable.
    return decodeURIComponent(value.replace(/\+/g, "%20"));
  } catch {
    return value;
  }
}

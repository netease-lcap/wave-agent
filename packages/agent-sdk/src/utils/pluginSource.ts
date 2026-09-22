/**
 * Marketplace plugin entry `source` parsing (spec plugin A-021).
 *
 * Two shapes are accepted:
 * - **string** — a Git URL (`http://` / `https://` / `git@` / `ssh://`, optionally
 *   `url#ref`) or a path relative to the marketplace checkout.
 * - **object** — `{"source":"url","url":…}` (whole repo) or
 *   `{"source":"git-subdir","url":…,"path":…}` (subdirectory of that repo), both
 *   optionally carrying `ref` (branch/tag) and `sha` (pinned commit, wins over `ref`).
 *
 * Tolerance is per-entry (spec plugin「兼容 Claude Code 生态的市场清单与插件」场景 4):
 * an unrecognized shape yields `undefined` so only that entry fails, never the
 * whole marketplace listing.
 */

const GIT_URL_PREFIXES = ["http://", "https://", "git@", "ssh://"];

export interface LocalPluginSource {
  kind: "local";
  /** Path relative to the marketplace checkout. */
  path: string;
}

export interface GitPluginSource {
  kind: "git";
  url: string;
  /** Branch or tag. */
  ref?: string;
  /** Pinned commit; when present it is checked out after cloning. */
  sha?: string;
  /** Subdirectory inside the cloned repository that holds the plugin. */
  subdir?: string;
}

export type ParsedPluginSource = LocalPluginSource | GitPluginSource;

export function isGitUrl(value: string): boolean {
  return GIT_URL_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function parsePluginSource(
  source: unknown,
): ParsedPluginSource | undefined {
  if (typeof source === "string") {
    return parseStringSource(source);
  }
  if (source && typeof source === "object") {
    return parseObjectSource(source as Record<string, unknown>);
  }
  return undefined;
}

function parseStringSource(source: string): ParsedPluginSource | undefined {
  const trimmed = source.trim();
  if (!trimmed) return undefined;
  if (!isGitUrl(trimmed)) {
    return { kind: "local", path: trimmed };
  }
  const hashIndex = trimmed.indexOf("#");
  if (hashIndex === -1) {
    return { kind: "git", url: trimmed };
  }
  const url = trimmed.slice(0, hashIndex);
  const ref = trimmed.slice(hashIndex + 1);
  return { kind: "git", url, ref: ref || undefined };
}

function parseObjectSource(
  source: Record<string, unknown>,
): ParsedPluginSource | undefined {
  const declaration = source.source;
  if (declaration !== "url" && declaration !== "git-subdir") {
    return undefined;
  }
  const url = typeof source.url === "string" ? source.url.trim() : "";
  if (!url) return undefined;

  const ref =
    typeof source.ref === "string" && source.ref ? source.ref : undefined;
  const sha =
    typeof source.sha === "string" && source.sha ? source.sha : undefined;

  if (declaration === "url") {
    return { kind: "git", url, ref, sha };
  }

  const subdir = typeof source.path === "string" ? source.path.trim() : "";
  if (!subdir) return undefined;
  return { kind: "git", url, ref, sha, subdir };
}

/**
 * Renders an unrecognized `source` for error messages so install failures name
 * the offending shape instead of hiding it (spec plugin A-021).
 */
export function describePluginSource(source: unknown): string {
  if (typeof source === "string") return JSON.stringify(source);
  if (source && typeof source === "object") {
    const json = JSON.stringify(source);
    return json.length > 200 ? `${json.slice(0, 200)}…` : json;
  }
  return String(source);
}

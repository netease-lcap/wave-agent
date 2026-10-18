/**
 * OpenTelemetry Standard Attributes
 *
 * The attribute surface every signal shares (see
 * docs/specs/enterprise/opentelemetry.md): which session a record belongs to,
 * who it belongs to, where it ran and — opt-in — which repository it touched.
 *
 * Deliberately free of `instrumentation.js` / `metrics.js` imports: both of
 * them reach for this module, and a cycle here would make the import order
 * decide whether an attribute resolves. Everything below is therefore
 * self-contained and resolved lazily, at the moment a record is made.
 */

import type { Attributes } from "@opentelemetry/api";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuthService,
  getOrCreateAnonymousId,
} from "../services/authService.js";
import type { HostEntrypoint } from "../constants/telemetry.js";

/** What the caller knows about the record it is about to make. */
export interface StandardAttributeContext {
  /** Session the record belongs to → `session.id` */
  sessionId?: string;
  /** Session working directory — used only to derive `vcs.repository.*` */
  workdir?: string;
  /** Whether repository attributes may be resolved (opt-in, default off) */
  includeRepository?: boolean;
  /** Host entrypoint that created the session → `app.entrypoint` */
  entrypoint?: HostEntrypoint;
}

/**
 * Get telemetry attributes for the current session.
 *
 * Priority:
 * 1. SSO authenticated → server-provided user.id + user.email
 * 2. Not authenticated → persistent anonymous ID from ~/.wave/config.json
 */
export function getTelemetryAttributes(): Record<string, string> {
  try {
    const user = AuthService.getInstance().getAuthUser();
    if (user) {
      const attrs: Record<string, string> = { "user.id": user.id };
      if (user.email) {
        attrs["user.email"] = user.email;
      }
      return attrs;
    }
  } catch {
    // AuthService not available or not authenticated
  }

  // Fallback to anonymous ID
  return { "user.id": getOrCreateAnonymousId() };
}

/** Terminal type, e.g. `vscode`, `iTerm.app`, `xterm-256color`. */
export function getTerminalType(): string | undefined {
  return (
    process.env.TERM_PROGRAM?.trim() || process.env.TERM?.trim() || undefined
  );
}

/**
 * The entrypoint a session declared when it was created — re-exported from its
 * own module so callers that need nothing else from this file (identity, the
 * repository lookup) can import it without dragging that machinery along.
 */
export { entrypointOf } from "./entrypoint.js";

let cachedServiceVersion: string | undefined;

/**
 * Version of the package this module shipped in.
 *
 * Read from the manifest next to the built files rather than from
 * `npm_package_version`: that env var only exists in an npm script, so a
 * packaged host reported `unknown` and the collector split one fleet into
 * "unknown" plus one series per version.
 */
export function getServiceVersion(): string {
  if (cachedServiceVersion !== undefined) return cachedServiceVersion;

  try {
    const manifest = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "package.json",
    );
    const parsed = JSON.parse(readFileSync(manifest, "utf-8")) as {
      version?: unknown;
    };
    cachedServiceVersion =
      typeof parsed.version === "string" ? parsed.version : "unknown";
  } catch {
    cachedServiceVersion = "unknown";
  }
  return cachedServiceVersion;
}

/**
 * Drop credentials from a remote URL before it is exported.
 *
 * `https://user:token@gitlab.corp/x/y.git` is a legal remote and a real one on
 * CI machines; the token is not part of the repository's identity. The scp-like
 * form (`git@github.com:owner/repo.git`) is left alone — there the `git` before
 * the `@` is the SSH user, not a credential.
 */
function sanitizeRemoteUrl(remote: string): string {
  if (!remote.includes("://")) return remote;
  return remote.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/]*@/i, "$1");
}

function splitRemote(
  remote: string,
): { host: string; path: string } | undefined {
  const scpLike = /^[^/@]+@([^:/]+):(.+)$/.exec(remote);
  if (scpLike) {
    return { host: scpLike[1], path: scpLike[2] };
  }
  try {
    const url = new URL(remote);
    return { host: url.hostname, path: url.pathname.replace(/^\/+/, "") };
  } catch {
    return undefined;
  }
}

function providerOf(host: string): string {
  const lower = host.toLowerCase();
  if (lower === "github.com" || lower.endsWith(".github.com")) return "github";
  if (lower === "gitlab.com" || lower.includes("gitlab")) return "gitlab";
  return "unknown";
}

/**
 * Derive the `vcs.repository.*` attributes from a git remote URL.
 *
 * Returns undefined when the URL carries no usable host/namespace — the whole
 * group is then dropped rather than filled with placeholders, so a collector
 * never sees an empty repository name.
 */
export function repositoryAttributesFromRemote(
  remote: string,
): Attributes | undefined {
  const trimmed = remote.trim();
  const parts = splitRemote(trimmed);
  if (!parts) return undefined;

  const segments = parts.path.split("/").filter(Boolean);
  if (segments.length < 2) return undefined;

  const name = segments[segments.length - 1].replace(/\.git$/, "");
  const owner = segments.slice(0, -1).join("/");
  if (!name || !owner) return undefined;

  return {
    "vcs.repository.url.full": sanitizeRemoteUrl(trimmed),
    "vcs.owner.name": owner,
    "vcs.repository.name": name,
    "vcs.provider.name": providerOf(parts.host),
  };
}

/** One `git remote get-url origin` per workdir, success or failure. */
const repositoryCache = new Map<string, Attributes | undefined>();

/** The `vcs.repository.*` attributes of a session's working directory, if any. */
export function getRepositoryAttributes(
  workdir?: string,
): Attributes | undefined {
  if (!workdir) return undefined;
  if (repositoryCache.has(workdir)) return repositoryCache.get(workdir);

  let attributes: Attributes | undefined;
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: workdir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    }).trim();
    if (remote) {
      attributes = repositoryAttributesFromRemote(remote);
    }
  } catch {
    // Not a git repository, no `origin`, or no git on PATH — no attributes.
  }

  repositoryCache.set(workdir, attributes);
  return attributes;
}

/**
 * The standard attributes of one record.
 *
 * Identity and terminal type always apply; `session.id` applies whenever the
 * caller knows the session (the metrics module applies the
 * `OTEL_METRICS_INCLUDE_SESSION_ID` switch before calling); repository
 * attributes only when explicitly enabled; the entrypoint whenever the session's
 * creator declared one. Neither is ever filled with a placeholder — a record
 * simply carries no `app.entrypoint` when nobody declared it.
 */
export function standardAttributes(
  context: StandardAttributeContext = {},
): Attributes {
  const attributes: Attributes = { ...getTelemetryAttributes() };

  const terminalType = getTerminalType();
  if (terminalType) {
    attributes["terminal.type"] = terminalType;
  }
  if (context.sessionId) {
    attributes["session.id"] = context.sessionId;
  }
  if (context.entrypoint) {
    attributes["app.entrypoint"] = context.entrypoint;
  }
  if (context.includeRepository) {
    Object.assign(attributes, getRepositoryAttributes(context.workdir));
  }

  return attributes;
}

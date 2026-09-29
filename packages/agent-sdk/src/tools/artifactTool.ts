import { readFileSync } from "fs";
import { readFile, realpath, stat } from "fs/promises";
import path from "path";
import { marked } from "marked";
import { ARTIFACT_TOOL_NAME } from "../constants/tools.js";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { authService, createAuthAwareFetch } from "../services/authService.js";
import { logger } from "../utils/globalLogger.js";
import { persistToolResultBuffer } from "../utils/toolResultStorage.js";
import {
  recordArtifact,
  getArtifactByFilePath,
  getRecordedVersion,
  recordVersion,
  markArtifactReadApproved,
  isArtifactReadApproved,
  markAssetWriteApproved,
  isAssetWriteApproved,
} from "../services/artifactSession.js";
import {
  extractArtifactSlug,
  isValidArtifactSlug,
  fetchFrameMeta,
  readArtifactContent,
  persistArtifactContent,
  summarizeArtifactAsReader,
  type FrameMeta,
} from "../services/artifactContent.js";
import {
  ARTIFACT_LIST_DEFAULT_LIMIT,
  ARTIFACT_LIST_MAX_LIMIT,
  ARTIFACT_SCOPES,
  fetchArtifactList,
  isArtifactScope,
  type ArtifactListRow,
  type ArtifactScope,
} from "../services/artifactList.js";
import {
  ASSET_ALLOWED_EXTENSIONS,
  ASSET_COPY_MAX_IDS,
  assetContentTypeFor,
  assetFileExtension,
  assetSizeLimitFor,
  copyAssets,
  deleteAsset,
  formatMiB,
  isAssetId,
  isTextContentType,
  listAssets,
  normalizeAssetId,
  readAsset,
  uploadAsset,
} from "../services/artifactAssets.js";
import { formatSize } from "../services/contentSummarizer.js";

// --- Limits ---
const DEPLOY_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 15_000;
/** Server-side content limit — POSTs above this get a 413. */
const ARTIFACT_MAX_CONTENT_BYTES = 16 * 1024 * 1024; // 16MB
const LABEL_MAX_LENGTH = 60;
/** Server-side title limit — POSTs above this get a 400. */
const TITLE_MAX_LENGTH = 1000;
const DEFAULT_FAVICON = "📄";

const PUBLISH_ACTION = "publish";
const LIST_ACTION = "list";
const READ_ACTION = "read";
const UPLOAD_ASSET_ACTION = "upload_asset";
const LIST_ASSETS_ACTION = "list_assets";
const READ_ASSET_ACTION = "read_asset";
const DELETE_ASSET_ACTION = "delete_asset";
const COPY_FROM_ACTION = "copy_from";

/** Actions that change an artifact's asset store and therefore need confirming. */
const ASSET_WRITE_ACTIONS: readonly string[] = [
  UPLOAD_ASSET_ACTION,
  DELETE_ASSET_ACTION,
  COPY_FROM_ACTION,
];

/** Server response shape for a successful deploy (HTTP 201). */
interface DeployResponse {
  url: string;
  slug: string;
  path?: string;
  title?: string;
  version: string;
}

function isValidFavicon(favicon: string): boolean {
  if (!favicon || favicon.trim().length === 0) return false;
  // Count code points excluding variation selectors (👨‍👩‍👧 counts as 3 and is
  // rejected — only simple 1-2 emoji are accepted per the server contract).
  const codePoints = [...favicon].filter((cp) => cp !== "\uFE0F");
  if (codePoints.length < 1 || codePoints.length > 2) return false;
  return codePoints.every((cp) => {
    // \p{Emoji} also matches ASCII digits/letters — plain text is not an emoji.
    if (/[A-Za-z0-9]/.test(cp)) return false;
    return /\p{Emoji}/u.test(cp);
  });
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

/**
 * The file's basename without extension — CC's last-resort title. HTML publishes
 * always send a non-empty `title` this way, which is what closes the title chain;
 * Markdown publishes use it as their filename identity (see the publish path).
 */
function basenameTitle(filePath: string): string | undefined {
  const base = path.basename(filePath, path.extname(filePath)).trim();
  return base || undefined;
}

/**
 * Render Markdown to a complete HTML document (client-side md→HTML). The injected
 * `<title>` carries the file's **filename identity** — CC keeps Markdown pages on
 * their file name, so `title` never enters the tag.
 */
function renderMarkdown(md: string, title?: string): string {
  const body = marked.parse(md, { async: false }) as string;
  const titleTag = title ? `<title>${escapeHtml(title)}</title>` : "";
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${titleTag}</head><body>${body}</body></html>`;
}

function denyResult(permissionResult: {
  behavior: string;
  message?: string;
}): ToolResult {
  return {
    success: false,
    content: "",
    error: `${ARTIFACT_TOOL_NAME} operation denied by user, reason: ${permissionResult.message || "No reason provided"}`,
  };
}

/** Shared auth gate — every action needs a logged-in account. */
function authErrorFor(verb: string): string | null {
  if (authService.getSSOToken()) return null;
  return `${ARTIFACT_TOOL_NAME}: not authenticated. Run /login to connect your account before ${verb}.`;
}

/**
 * Resolve the artifact slug an action targets. Outside callers hand us a page
 * URL; slugs are also accepted so a model can reuse a slug it just listed.
 */
function resolveSlug(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (isValidArtifactSlug(trimmed)) return trimmed;
  const fromUrl = extractArtifactSlug(trimmed);
  return fromUrl && isValidArtifactSlug(fromUrl) ? fromUrl : null;
}

/**
 * Network locations are refused before any filesystem access: an upload must
 * read a local file, and a network path can be re-resolved to something else
 * mid-flight.
 */
function isNetworkPath(rawPath: string): boolean {
  return (
    /^[\\/]{2}/.test(rawPath) ||
    rawPath === "/net" ||
    rawPath.startsWith("/net/")
  );
}

/**
 * Confirm an asset write (upload / delete / copy). Unlike publishing, the
 * standing rule is hidden: a persistent rule would silently authorise writes to
 * every later artifact, so approval stays scoped to this artifact and session.
 */
async function confirmAssetWrite(
  context: ToolContext,
  slug: string,
  params: Record<string, unknown>,
  warning: string,
): Promise<ToolResult | null> {
  const sessionId = context.sessionId || "";
  if (!context.permissionManager) return null;
  if (sessionId && isAssetWriteApproved(sessionId, slug)) return null;

  const permissionContext = context.permissionManager.createContext(
    ARTIFACT_TOOL_NAME,
    context.permissionMode || "default",
    context.canUseToolCallback,
    params,
    context.toolCallId,
  );
  permissionContext.warning = warning;
  permissionContext.hidePersistentOption = true;
  const permissionResult =
    await context.permissionManager.checkPermission(permissionContext);
  if (permissionResult.behavior === "deny") {
    return denyResult(permissionResult);
  }
  if (sessionId) markAssetWriteApproved(sessionId, slug);
  return null;
}

// --- List action ---

function formatListRow(row: ArtifactListRow, host: string): string {
  const favicon = row.favicon ? `${row.favicon} ` : "";
  const updated = row.updatedAt ? ` (updated ${row.updatedAt})` : "";
  return `- ${favicon}${row.title} — ${host}/code/artifact/${encodeURIComponent(row.slug)}${updated}`;
}

/**
 * Enumerate the account's artifacts, grouped by how they relate to it. Scoping
 * and truncation are client-side because the server returns one fixed page.
 */
async function listArtifacts(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const scopeRaw = typeof args.scope === "string" ? args.scope.trim() : "";
  let scope: ArtifactScope = "mine";
  if (scopeRaw) {
    if (!isArtifactScope(scopeRaw)) {
      return {
        success: false,
        content: "",
        error: `${ARTIFACT_TOOL_NAME}: scope must be one of ${ARTIFACT_SCOPES.join(", ")} (got "${scopeRaw}")`,
      };
    }
    scope = scopeRaw;
  }

  const limitRaw = args.limit;
  let limit = ARTIFACT_LIST_DEFAULT_LIMIT;
  if (limitRaw !== undefined) {
    if (
      typeof limitRaw !== "number" ||
      !Number.isInteger(limitRaw) ||
      limitRaw < 1
    ) {
      return {
        success: false,
        content: "",
        error: `${ARTIFACT_TOOL_NAME}: limit must be a positive integer (got ${JSON.stringify(limitRaw)})`,
      };
    }
    if (limitRaw > ARTIFACT_LIST_MAX_LIMIT) {
      return {
        success: false,
        content: "",
        error: `${ARTIFACT_TOOL_NAME}: limit must be at most ${ARTIFACT_LIST_MAX_LIMIT} (got ${limitRaw})`,
      };
    }
    limit = limitRaw;
  }

  const authError = authErrorFor("listing artifacts");
  if (authError) return { success: false, content: "", error: authError };

  const outcome = await fetchArtifactList(scope, limit, {
    abortSignal: context.abortSignal,
  });
  if (outcome.kind === "error") {
    return {
      success: false,
      content: "",
      error: `${ARTIFACT_TOOL_NAME}: ${outcome.error}`,
    };
  }

  const { rows, truncated } = outcome;
  const host = authService.getServerUrl();
  const lines = [`Artifacts (scope: ${scope}) — ${rows.length} listed`];
  if (rows.length === 0) {
    lines.push("", "No artifacts matched.");
  } else {
    for (const rel of ["mine", "shared"] as const) {
      const group = rows.filter((row) => row.rel === rel);
      if (group.length === 0) continue;
      lines.push("", `(${rel})`);
      for (const row of group) lines.push(formatListRow(row, host));
    }
  }
  if (truncated) {
    lines.push(
      "",
      `More matches exist — raise "limit" (max ${ARTIFACT_LIST_MAX_LIMIT}) or narrow "scope".`,
    );
  }

  return {
    success: true,
    content: lines.join("\n"),
    shortResult: `Listed ${rows.length} artifact${rows.length === 1 ? "" : "s"} (scope: ${scope})`,
  };
}

// --- Read action ---

/**
 * Read an artifact back. Owned artifacts return raw HTML (inline CSS/JS intact)
 * so the page can be edited or debugged; artifacts shared by someone else go
 * through the fast model and only the summary reaches the conversation.
 */
async function readArtifact(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (!url) {
    return {
      success: false,
      content: "",
      error: `${ARTIFACT_TOOL_NAME}: missing required parameter "url" for a read`,
    };
  }
  const slug = extractArtifactSlug(url);
  if (!slug) {
    return {
      success: false,
      content: "",
      error: `${ARTIFACT_TOOL_NAME}: url must point to an artifact page ({host}/code/artifact/{slug})`,
    };
  }
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";

  if (!authService.getSSOToken()) {
    return {
      success: false,
      content: "",
      error: `${ARTIFACT_TOOL_NAME}: not authenticated. Run /login to connect your account before reading artifacts.`,
    };
  }

  const readResult = await readArtifactContent(slug, {
    url,
    abortSignal: context.abortSignal,
  });
  if (readResult.kind === "error") {
    return {
      success: false,
      content: "",
      error: `${ARTIFACT_TOOL_NAME}: ${readResult.error}`,
    };
  }

  const artifact = readResult.artifact;
  const sessionId = context.sessionId || "";
  if (sessionId && artifact.version) {
    // Reading counts as seeing the latest version, so a follow-up republish of
    // this artifact is not flagged as stale.
    recordVersion(sessionId, slug, artifact.version);
  }

  if (artifact.ownership === "reader") {
    // Someone else's page: the content is third-party, so ask once per session
    // before it reaches the model, and never hand back the full text.
    if (context.permissionManager && !isArtifactReadApproved(sessionId, slug)) {
      const permissionContext = context.permissionManager.createContext(
        ARTIFACT_TOOL_NAME,
        context.permissionMode || "default",
        context.canUseToolCallback,
        {
          action: READ_ACTION,
          url,
          ...(prompt ? { prompt } : {}),
        },
        context.toolCallId,
      );
      permissionContext.warning =
        "读取他人分享的 artifact：其内容将以摘要形式进入对话上下文。";
      // Session-scoped approval: a standing rule would silently allow any
      // other page later.
      permissionContext.hidePersistentOption = true;
      const permissionResult =
        await context.permissionManager.checkPermission(permissionContext);
      if (permissionResult.behavior === "deny") {
        return denyResult(permissionResult);
      }
      if (sessionId) markArtifactReadApproved(sessionId, slug);
    }
    return summarizeArtifactAsReader(url, prompt, artifact.html, context);
  }

  const lines = [`Artifact: ${url}`];
  if (artifact.version) lines.push(`Version: ${artifact.version}`);
  const persisted = persistArtifactContent(artifact.html);
  return {
    success: true,
    content: `${lines.join("\n")}\n\n${persisted ?? artifact.html}`,
    shortResult: `Read artifact ${slug}${artifact.version ? ` (v${artifact.version})` : ""} — ${formatSize(artifact.bytes)} of HTML`,
  };
}

// --- Publish action ---

async function publishArtifact(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const filePath =
    typeof args.file_path === "string" ? args.file_path.trim() : "";
  if (!filePath) {
    return {
      success: false,
      content: "",
      error: `${ARTIFACT_TOOL_NAME}: missing required parameter "file_path"`,
    };
  }

  const faviconRaw =
    typeof args.favicon === "string" ? args.favicon.trim() : "";
  const favicon = faviconRaw || DEFAULT_FAVICON;
  if (!isValidFavicon(favicon)) {
    return {
      success: false,
      content: "",
      error: `${ARTIFACT_TOOL_NAME}: favicon must be 1-2 emoji characters (e.g. "📄" or "🔖"), no text, URLs, or HTML markup`,
    };
  }

  // `label` is the short name for THIS publish (CC), not a title fallback — it
  // only feeds the version list, so it is never auto-filled.
  const labelRaw = typeof args.label === "string" ? args.label.trim() : "";
  const label = labelRaw || undefined;
  if (label !== undefined && label.length > LABEL_MAX_LENGTH) {
    return {
      success: false,
      content: "",
      error: `${ARTIFACT_TOOL_NAME}: label must be at most ${LABEL_MAX_LENGTH} characters (got ${label.length})`,
    };
  }

  // `title` is the artifact title, HTML publishes only (CC). It is rejected at
  // the same length the server enforces, so an over-long title fails here instead
  // of costing a round trip (the request would come back a 400 either way).
  const titleRaw = typeof args.title === "string" ? args.title.trim() : "";
  if (titleRaw.length > TITLE_MAX_LENGTH) {
    return {
      success: false,
      content: "",
      error: `${ARTIFACT_TOOL_NAME}: title must be at most ${TITLE_MAX_LENGTH} characters (got ${titleRaw.length})`,
    };
  }
  const explicitTitle = titleRaw || undefined;

  const force = args.force === true;
  const urlRaw = typeof args.url === "string" ? args.url.trim() : "";
  const url = urlRaw || undefined;
  let slug: string | null | undefined;
  if (url) {
    slug = extractArtifactSlug(url);
    if (!slug) {
      return {
        success: false,
        content: "",
        error: `${ARTIFACT_TOOL_NAME}: url must point to an artifact page ({host}/code/artifact/{slug})`,
      };
    }
  }

  // Resolve and read the file (relative to the workdir).
  const absolutePath = path.resolve(context.workdir, filePath);
  const ext = path.extname(absolutePath).toLowerCase();
  if (ext !== ".html" && ext !== ".md") {
    return {
      success: false,
      content: "",
      error: `${ARTIFACT_TOOL_NAME}: only .html and .md files can be published as artifacts (got "${ext || "no extension"}")`,
    };
  }
  let fileContent: string;
  try {
    fileContent = readFileSync(absolutePath, "utf-8");
  } catch {
    return {
      success: false,
      content: "",
      error: `${ARTIFACT_TOOL_NAME}: file not found or unreadable: ${filePath}`,
    };
  }

  // CC's title chain is <title> tag (wins, server-side) → `title` parameter →
  // file basename, and the client is the one that supplies that last resort — so
  // an .html publish always sends a non-empty `title`. Markdown keeps its file
  // name identity instead: the tag injected below carries it, and the `title`
  // parameter does not apply.
  const fileTitle = basenameTitle(filePath);
  const title = ext === ".html" ? (explicitTitle ?? fileTitle) : undefined;

  const content =
    ext === ".md" ? renderMarkdown(fileContent, fileTitle) : fileContent;
  const contentBytes = Buffer.byteLength(content, "utf-8");
  if (contentBytes > ARTIFACT_MAX_CONTENT_BYTES) {
    return {
      success: false,
      content: "",
      error: `${ARTIFACT_TOOL_NAME}: content exceeds the ${Math.floor(ARTIFACT_MAX_CONTENT_BYTES / 1024 / 1024)}MB server limit (${(contentBytes / 1024 / 1024).toFixed(1)}MB). Reduce the file or split it up.`,
    };
  }

  if (!authService.getSSOToken()) {
    return {
      success: false,
      content: "",
      error: `${ARTIFACT_TOOL_NAME}: not authenticated. Run /login to connect your account before publishing artifacts.`,
    };
  }

  const sessionId = context.sessionId || "";
  const signal = context.abortSignal
    ? AbortSignal.any([
        context.abortSignal,
        AbortSignal.timeout(DEPLOY_TIMEOUT_MS),
      ])
    : AbortSignal.timeout(DEPLOY_TIMEOUT_MS);

  // Redeploy: probe current metadata for baseVersion, shared-live detection,
  // and the stale-version guard.
  let serverVersion: string | undefined;
  let sharedLive = false;
  if (url && slug) {
    const metaResult = await fetchFrameMeta(slug, {
      abortSignal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (metaResult.kind === "error") {
      return {
        success: false,
        content: "",
        error: `${ARTIFACT_TOOL_NAME}: artifact not found at ${url}. It may have been deleted or the URL is invalid.`,
      };
    }
    const meta: FrameMeta = metaResult.meta;
    serverVersion = meta.version;
    sharedLive = !!(meta.perm && meta.perm.mode !== "owner" && !meta.shared);
    const recorded = getRecordedVersion(sessionId, slug);
    if (recorded !== undefined && recorded !== meta.version && !force) {
      return {
        success: false,
        content: "",
        error: `${ARTIFACT_TOOL_NAME}: stale version — this artifact has been updated to version ${meta.version} since this session last saw version ${recorded}. Pass "force": true to overwrite it anyway.`,
      };
    }
  }

  // Permission check: first publish and shared-live redeploys require
  // confirmation; republishing a file/artifact this session already
  // confirmed once auto-allows (matching Claude Code's behavior).
  const publishedThisSession =
    !!getArtifactByFilePath(sessionId, filePath) ||
    (slug ? getRecordedVersion(sessionId, slug) !== undefined : false);
  const needsConfirm = !publishedThisSession || sharedLive;

  if (context.permissionManager && needsConfirm) {
    const permissionContext = context.permissionManager.createContext(
      ARTIFACT_TOOL_NAME,
      context.permissionMode || "default",
      context.canUseToolCallback,
      {
        file_path: filePath,
        ...(favicon !== DEFAULT_FAVICON ? { favicon } : {}),
        ...(label !== undefined ? { label } : {}),
        ...(url !== undefined ? { url } : {}),
        ...(force ? { force: true } : {}),
      },
      context.toolCallId,
    );
    if (sharedLive) {
      permissionContext.warning =
        "此 artifact 处于 shared-live 状态（共享且实时更新），重新部署后所有访问者都会立即看到新内容。";
      permissionContext.hidePersistentOption = true;
    }
    const permissionResult =
      await context.permissionManager.checkPermission(permissionContext);
    if (permissionResult.behavior === "deny") {
      return denyResult(permissionResult);
    }
  }

  // Deploy.
  const serverUrl = authService.getServerUrl();
  const authFetch = createAuthAwareFetch(globalThis.fetch);
  const body: Record<string, unknown> = {
    content,
    favicon,
    ...(title !== undefined ? { title } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(serverVersion !== undefined ? { baseVersion: serverVersion } : {}),
    ...(force ? { force: true } : {}),
  };

  let res: Response;
  try {
    res = await authFetch(`${serverUrl}/api/frame/deploy/direct`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    logger?.warn("Artifact deploy request failed", { error: String(err) });
    return {
      success: false,
      content: "",
      error: `${ARTIFACT_TOOL_NAME}: failed to reach the server: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (res.status === 201) {
    const deploy = data as unknown as DeployResponse;
    recordArtifact(sessionId, filePath, {
      url: deploy.url,
      slug: deploy.slug,
      version: deploy.version,
    });
    const lines = [`Artifact published: ${deploy.url}`];
    if (deploy.path) lines.push(`Path: ${deploy.path}`);
    if (deploy.title) lines.push(`Title: ${deploy.title}`);
    lines.push(`Version: ${deploy.version}`);
    return {
      success: true,
      content: lines.join("\n"),
      shortResult: `Published ${filePath} → ${deploy.url}`,
    };
  }

  if (res.status === 409) {
    const live = typeof data.live === "string" ? data.live : undefined;
    if (live && slug) {
      recordVersion(sessionId, slug, live);
    }
    const serverMessage =
      typeof data.message === "string"
        ? data.message
        : typeof data.error === "string"
          ? data.error
          : "the artifact has been updated by someone else";
    return {
      success: false,
      content: "",
      error: `${ARTIFACT_TOOL_NAME}: conflict detected — ${serverMessage}${live ? ` (live version: ${live})` : ""}. Pass "force": true to overwrite the live version.`,
    };
  }

  if (res.status === 413) {
    return {
      success: false,
      content: "",
      error: `${ARTIFACT_TOOL_NAME}: the published content is too large (server limit is 16MB). Reduce the file or split it up.`,
    };
  }

  if (res.status === 400) {
    const serverMessage =
      typeof data.message === "string"
        ? data.message
        : typeof data.error === "string"
          ? data.error
          : "the server rejected the content";
    return {
      success: false,
      content: "",
      error: `${ARTIFACT_TOOL_NAME}: the server rejected the publish — ${serverMessage}`,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      success: false,
      content: "",
      error: `${ARTIFACT_TOOL_NAME}: authentication failed (HTTP ${res.status}). Run /login again and retry.`,
    };
  }

  logger?.warn("Artifact deploy unexpected status", {
    status: res.status,
    statusText: res.statusText,
  });
  return {
    success: false,
    content: "",
    error: `${ARTIFACT_TOOL_NAME}: server returned HTTP ${res.status} ${res.statusText}`,
  };
}

// --- Asset actions ---

function assetError(message: string): ToolResult {
  return {
    success: false,
    content: "",
    error: `${ARTIFACT_TOOL_NAME}: ${message}`,
  };
}

/** Resolve the `url` argument asset actions need to locate their artifact. */
function requireSlug(args: Record<string, unknown>): string | ToolResult {
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (!url) {
    return assetError(
      `missing required parameter "url" (the artifact page URL)`,
    );
  }
  const slug = resolveSlug(url);
  if (!slug) {
    return assetError(
      `url must be an artifact page URL ({host}/code/artifact/{slug}) or an artifact slug (got "${url}")`,
    );
  }
  return slug;
}

/** Resolve an `asset_id` argument, accepting a bare id or a `_blob/{id}` ref. */
function requireAssetId(args: Record<string, unknown>): string | ToolResult {
  const raw = typeof args.asset_id === "string" ? args.asset_id.trim() : "";
  if (!raw) {
    return assetError(`missing required parameter "asset_id"`);
  }
  const assetId = normalizeAssetId(raw);
  if (!assetId) {
    return assetError(
      `asset_id must be a 32-character hex asset id or a _blob/{id} reference (got "${raw}")`,
    );
  }
  return assetId;
}

/**
 * Read the local file an `upload_asset` names, enforcing the client-side file
 * semantics: a local regular file inside the session's readable zone with an
 * allowlisted extension, within the per-asset ceiling, and unchanged across the
 * read (a file rewritten mid-flight must not upload as the checked file).
 */
async function readLocalUploadFile(
  filePath: string,
  context: ToolContext,
): Promise<
  | { kind: "ok"; bytes: Buffer; contentType: string; resolvedPath: string }
  | { kind: "error"; error: string }
> {
  if (isNetworkPath(filePath)) {
    return {
      kind: "error",
      error: `upload_asset reads only local files — "${filePath}" names a network path (a UNC share, /net automount, or a device-style path). Copy it to a local disk and upload the copy.`,
    };
  }

  const absolutePath = path.resolve(context.workdir, filePath);
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(absolutePath);
  } catch {
    return {
      kind: "error",
      error: `file not found or unreadable: ${filePath}`,
    };
  }

  let info;
  try {
    info = await stat(resolvedPath);
  } catch {
    return {
      kind: "error",
      error: `file not found or unreadable: ${filePath}`,
    };
  }
  if (!info.isFile()) {
    return {
      kind: "error",
      error: `${filePath} must name a regular file to upload`,
    };
  }

  if (
    context.permissionManager &&
    !context.permissionManager.isPathInSafeZone(resolvedPath)
  ) {
    return {
      kind: "error",
      error: `only files this session is allowed to read can be uploaded — ${filePath} is outside the working directory. Add its folder with /add-dir, or copy it into the working directory first.`,
    };
  }

  const contentType = assetContentTypeFor(resolvedPath);
  if (!contentType) {
    const ext = path.extname(resolvedPath).toLowerCase();
    return {
      kind: "error",
      error: `only these file types are accepted: ${ASSET_ALLOWED_EXTENSIONS.join(", ")} (got "${ext || "no extension"}")`,
    };
  }

  if (info.size === 0) {
    return {
      kind: "error",
      error: `${filePath} is empty — nothing to upload`,
    };
  }
  const limitBytes = assetSizeLimitFor(contentType);
  if (info.size > limitBytes) {
    const svg = contentType === "image/svg+xml" ? "SVG " : "";
    return {
      kind: "error",
      error: `${filePath} is ${formatSize(info.size)}, over the ${formatMiB(limitBytes)} ${svg}per-asset limit — compress or split it`,
    };
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(resolvedPath);
  } catch {
    return {
      kind: "error",
      error: `cannot read ${filePath}`,
    };
  }

  const after = await stat(resolvedPath).catch(() => null);
  if (
    !after ||
    after.ino !== info.ino ||
    after.size !== info.size ||
    after.mtimeMs !== info.mtimeMs
  ) {
    return {
      kind: "error",
      error: `${filePath} was moved, was replaced, or was rewritten during the read — retry the upload so the file that uploads is the one that was checked.`,
    };
  }

  return { kind: "ok", bytes, contentType, resolvedPath };
}

async function uploadAssetAction(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const filePath =
    typeof args.file_path === "string" ? args.file_path.trim() : "";
  if (!filePath) {
    return assetError(
      `missing required parameter "file_path" for an upload_asset`,
    );
  }
  const slug = requireSlug(args);
  if (typeof slug !== "string") return slug;

  const authError = authErrorFor("uploading assets");
  if (authError)
    return assetError(authError.replace(`${ARTIFACT_TOOL_NAME}: `, ""));

  const local = await readLocalUploadFile(filePath, context);
  if (local.kind === "error") return assetError(local.error);

  const denied = await confirmAssetWrite(
    context,
    slug,
    { action: UPLOAD_ASSET_ACTION, file_path: filePath, url: args.url },
    `上传本地文件 ${filePath} 为 artifact ${slug} 的资源：文件内容会存到服务端，能访问该 artifact 的人都能取到。`,
  );
  if (denied) return denied;

  const outcome = await uploadAsset(slug, local.bytes, local.contentType, {
    abortSignal: context.abortSignal,
  });
  if (outcome.kind === "error") return assetError(outcome.error);

  const asset = outcome.value;
  const lines = [
    `Asset uploaded: ${asset.asset_id}`,
    `Reference it in the page as: _blob/${asset.asset_id}`,
    `Type: ${asset.content_type || local.contentType}`,
    `Size: ${formatSize(asset.size_bytes)}`,
  ];
  if (asset.sha256) lines.push(`sha256: ${asset.sha256}`);
  return {
    success: true,
    content: lines.join("\n"),
    shortResult: `Uploaded ${filePath} → asset ${asset.asset_id}`,
  };
}

async function listAssetsAction(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const slug = requireSlug(args);
  if (typeof slug !== "string") return slug;
  const after = typeof args.after === "string" ? args.after.trim() : "";

  const authError = authErrorFor("listing assets");
  if (authError)
    return assetError(authError.replace(`${ARTIFACT_TOOL_NAME}: `, ""));

  const outcome = await listAssets(slug, after || undefined, {
    abortSignal: context.abortSignal,
  });
  if (outcome.kind === "error") return assetError(outcome.error);

  const { assets, usage, next } = outcome.value;
  const lines = [
    `Assets of ${String(args.url)} — ${usage.files}/${usage.max_files} file(s), ${formatSize(usage.bytes)} of ${formatMiB(usage.max_bytes)}`,
  ];
  if (assets.length === 0) {
    lines.push("", "No assets.");
  } else {
    lines.push("");
    for (const asset of assets) {
      const created = asset.created_at ? `  ${asset.created_at}` : "";
      lines.push(
        `- ${asset.asset_id}  ${asset.content_type || "unknown"}  ${formatSize(asset.size_bytes)}${created}`,
      );
    }
  }
  if (next) {
    lines.push("", `More assets — call again with "after": "${next}"`);
  }

  return {
    success: true,
    content: lines.join("\n"),
    shortResult: `Listed ${assets.length} asset(s) of ${slug}`,
  };
}

async function readAssetAction(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const slug = requireSlug(args);
  if (typeof slug !== "string") return slug;
  const assetId = requireAssetId(args);
  if (typeof assetId !== "string") return assetId;

  const authError = authErrorFor("reading assets");
  if (authError)
    return assetError(authError.replace(`${ARTIFACT_TOOL_NAME}: `, ""));

  const outcome = await readAsset(slug, assetId, {
    abortSignal: context.abortSignal,
  });
  if (outcome.kind === "error") return assetError(outcome.error);

  const { bytes, contentType, ownership } = outcome.value;
  const sessionId = context.sessionId || "";

  // Someone else's asset is third-party content: confirm once per artifact
  // before it reaches the conversation, exactly as the `read` action does.
  if (
    ownership === "reader" &&
    context.permissionManager &&
    !isArtifactReadApproved(sessionId, slug)
  ) {
    const permissionContext = context.permissionManager.createContext(
      ARTIFACT_TOOL_NAME,
      context.permissionMode || "default",
      context.canUseToolCallback,
      { action: READ_ASSET_ACTION, url: args.url, asset_id: assetId },
      context.toolCallId,
    );
    permissionContext.warning =
      "读取他人分享 artifact 的资源：其内容将进入对话上下文。";
    permissionContext.hidePersistentOption = true;
    const permissionResult =
      await context.permissionManager.checkPermission(permissionContext);
    if (permissionResult.behavior === "deny")
      return denyResult(permissionResult);
    if (sessionId) markArtifactReadApproved(sessionId, slug);
  }

  const described = `${contentType || "application/octet-stream"}, ${formatSize(bytes.byteLength)}`;
  if (isTextContentType(contentType)) {
    const text = bytes.toString("utf-8");
    const persisted = persistArtifactContent(text);
    return {
      success: true,
      content: `Asset ${assetId} (${described})\n\n${persisted ?? text}`,
      shortResult: `Read asset ${assetId} (${contentType || "text"})`,
    };
  }

  const written = persistToolResultBuffer(
    bytes,
    "artifact-asset",
    assetFileExtension(contentType),
  );
  if (!written) {
    return assetError(`failed to write asset ${assetId} to a temporary file`);
  }
  return {
    success: true,
    content: `Asset ${assetId} (${described}) written to ${written}\nUse Read to view it.`,
    shortResult: `Read asset ${assetId} (${contentType || "binary"})`,
  };
}

async function deleteAssetAction(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const slug = requireSlug(args);
  if (typeof slug !== "string") return slug;
  const assetId = requireAssetId(args);
  if (typeof assetId !== "string") return assetId;

  const authError = authErrorFor("deleting assets");
  if (authError)
    return assetError(authError.replace(`${ARTIFACT_TOOL_NAME}: `, ""));

  const denied = await confirmAssetWrite(
    context,
    slug,
    { action: DELETE_ASSET_ACTION, url: args.url, asset_id: assetId },
    `删除 artifact ${slug} 的资源 ${assetId}：引用它的页面位置会失效。`,
  );
  if (denied) return denied;

  const outcome = await deleteAsset(slug, assetId, {
    abortSignal: context.abortSignal,
  });
  if (outcome.kind === "error") return assetError(outcome.error);

  return {
    success: true,
    content: outcome.value.deleted
      ? `Deleted asset ${assetId} from ${String(args.url)}.`
      : `Asset ${assetId} was already gone — nothing was deleted.`,
    shortResult: outcome.value.deleted
      ? `Deleted asset ${assetId}`
      : `Asset ${assetId} already gone`,
  };
}

async function copyFromAction(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const slug = requireSlug(args);
  if (typeof slug !== "string") return slug;

  const fromRaw = typeof args.from === "string" ? args.from.trim() : "";
  if (!fromRaw) {
    return assetError(
      `missing required parameter "from" (the source artifact's slug or page URL)`,
    );
  }
  const fromSlug = resolveSlug(fromRaw);
  if (!fromSlug) {
    return assetError(
      `from must be an artifact slug or page URL (got "${fromRaw}")`,
    );
  }

  const rawIds = args.asset_ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return assetError(
      `"asset_ids" must be a non-empty array of asset ids (1-${ASSET_COPY_MAX_IDS})`,
    );
  }
  if (rawIds.length > ASSET_COPY_MAX_IDS) {
    return assetError(
      `"asset_ids" accepts at most ${ASSET_COPY_MAX_IDS} ids (got ${rawIds.length})`,
    );
  }
  const assetIds: string[] = [];
  for (const raw of rawIds) {
    const id = typeof raw === "string" ? normalizeAssetId(raw) : null;
    if (!id) {
      return assetError(
        `"asset_ids" entries must be 32-character hex asset ids (got ${JSON.stringify(raw)})`,
      );
    }
    assetIds.push(id);
  }
  if (new Set(assetIds).size !== assetIds.length) {
    return assetError(`"asset_ids" must be distinct`);
  }
  if (assetIds.some((id) => !isAssetId(id))) {
    return assetError(`"asset_ids" entries must be 32-character hex asset ids`);
  }

  const authError = authErrorFor("copying assets");
  if (authError)
    return assetError(authError.replace(`${ARTIFACT_TOOL_NAME}: `, ""));

  const denied = await confirmAssetWrite(
    context,
    slug,
    {
      action: COPY_FROM_ACTION,
      url: args.url,
      from: fromRaw,
      asset_ids: assetIds,
    },
    `从 artifact ${fromSlug} 复制资源到 ${slug}：将在目标 artifact 中产生独立副本。`,
  );
  if (denied) return denied;

  const outcome = await copyAssets(slug, fromSlug, assetIds, {
    abortSignal: context.abortSignal,
  });
  if (outcome.kind === "error") return assetError(outcome.error);

  const copies = outcome.value;
  const lines = [
    `Copied ${copies.length} asset(s) from ${fromSlug} into ${String(args.url)}:`,
  ];
  for (const copy of copies) {
    lines.push(
      `- ${copy.from_id ?? "?"} → ${copy.asset_id}  ${copy.content_type || "unknown"}  ${formatSize(copy.size_bytes)}`,
    );
  }
  if (copies.length !== assetIds.length) {
    lines.push(
      "",
      `Only ${copies.length} of ${assetIds.length} were confirmed — run list_assets on the target to check.`,
    );
  }

  return {
    success: true,
    content: lines.join("\n"),
    shortResult: `Copied ${copies.length} asset(s) into ${slug}`,
  };
}

export const artifactTool: ToolPlugin = {
  name: ARTIFACT_TOOL_NAME,
  isConcurrencySafe: false,
  config: {
    type: "function",
    function: {
      name: ARTIFACT_TOOL_NAME,
      description:
        "Publish local HTML or Markdown files as shareable web pages (artifacts), read a published artifact back, " +
        "list the artifacts this account can reach, and manage an artifact's assets (images, fonts, data files the page references). " +
        `\`action: "publish"\` (the default when omitted) publishes a file: each publish returns a private URL you can share; ` +
        "the page is only accessible to you unless you change its sharing. Only .html and .md files are supported — inline content " +
        "is not accepted. Markdown files are rendered to HTML automatically. Pass `url` (an existing artifact URL) to redeploy that " +
        "artifact, or omit it to republish a file already published in this session. Use `force` to overwrite an artifact that has " +
        `been updated by someone else. \`action: "read"\` returns the current content of an artifact you pass as \`url\`: artifacts you ` +
        "own come back as raw HTML with inline CSS/JS intact (use it to keep editing, style-check, or debug a published page), while " +
        "artifacts shared by someone else come back as an isolated summary steered by the optional `prompt`. " +
        `\`action: "list"\` enumerates the artifacts this account can reach (\`scope\`: "mine" by default, "shared", or "all"), ` +
        "so you can find a page when you do not have its URL. " +
        `Asset actions all take the artifact as \`url\`: \`action: "upload_asset"\` (+ \`file_path\`) stores a local file and returns an ` +
        "id the page references as `_blob/{id}`; " +
        `\`action: "list_assets"\` lists what is stored (with quota usage, and a cursor in \`after\` for the next page); ` +
        `\`action: "read_asset"\` (+ \`asset_id\`) fetches one back; ` +
        `\`action: "delete_asset"\` (+ \`asset_id\`) removes one; ` +
        `\`action: "copy_from"\` (+ \`from\` + \`asset_ids\`) copies assets from another artifact into this one.`,
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              PUBLISH_ACTION,
              LIST_ACTION,
              READ_ACTION,
              UPLOAD_ASSET_ACTION,
              LIST_ASSETS_ACTION,
              READ_ASSET_ACTION,
              DELETE_ASSET_ACTION,
              COPY_FROM_ACTION,
            ],
            description:
              'The action to perform: "publish" (default) publishes a local file, "read" returns an artifact\'s current content, "list" enumerates the account\'s artifacts, and "upload_asset" / "list_assets" / "read_asset" / "delete_asset" / "copy_from" manage an artifact\'s assets.',
          },
          file_path: {
            type: "string",
            description:
              'Path to a local file (relative to the working directory). For "publish": a .html or .md file. For "upload_asset": any file whose extension is an accepted asset type.',
          },
          favicon: {
            type: "string",
            description:
              "1-2 emoji characters shown as the page favicon (no text, URLs, or HTML). Defaults to 📄. Only used when publishing.",
          },
          title: {
            type: "string",
            description:
              "Title for the artifact — the name shown in the browser tab and gallery. Only used when publishing an .html file. Prefer a <title> tag at the top of the HTML itself: this parameter fills in only when the file lacks one in the first 8KB, and never overrides the tag. When neither is present the file name is used. Markdown pages keep their filename identity instead.",
          },
          label: {
            type: "string",
            description: `A short name for this publish, max ${LABEL_MAX_LENGTH} characters (e.g. "Draft to legal"). Optional — a few words, not a description. Only used when publishing.`,
          },
          url: {
            type: "string",
            description:
              "Artifact URL, e.g. https://host/code/artifact/abc123 (an artifact slug is also accepted). When publishing: the existing artifact to redeploy (omit when republishing a file already published earlier in this session). For read and every asset action: the artifact to act on (required).",
          },
          force: {
            type: "boolean",
            description:
              "Set true to overwrite an artifact that was updated since this session last saw it (stale version or conflict). Only used when publishing.",
          },
          prompt: {
            type: "string",
            description:
              'Optional steering for action "read" when the artifact is shared by someone else — e.g. "how is the layout structured?" or "what does it render?". Ignored for artifacts you own.',
          },
          scope: {
            type: "string",
            enum: [...ARTIFACT_SCOPES],
            description:
              'Which artifacts "list" returns: "mine" (default) = you own them, "shared" = someone shared them with you, "all" = both.',
          },
          limit: {
            type: "number",
            description: `Maximum rows for "list" (default ${ARTIFACT_LIST_DEFAULT_LIMIT}, max ${ARTIFACT_LIST_MAX_LIMIT}). Ignored by other actions.`,
          },
          asset_id: {
            type: "string",
            description:
              'The asset to act on, for "read_asset" / "delete_asset" — the 32-character hex id returned by "list_assets" or "upload_asset" (a _blob/{id} reference is also accepted).',
          },
          asset_ids: {
            type: "array",
            items: { type: "string" },
            description: `For "copy_from": the source artifact's asset ids to copy, 1-${ASSET_COPY_MAX_IDS} distinct ids, ordered.`,
          },
          after: {
            type: "string",
            description:
              'For "list_assets": the cursor from a previous listing\'s "next" field, to fetch the following page.',
          },
          from: {
            type: "string",
            description:
              'For "copy_from": the SOURCE artifact to copy assets out of, as a slug or page URL. Assets are copied into the artifact named by `url`.',
          },
        },
        required: [],
      },
    },
  },
  // Value only, never the tool name: the collapsed row renders
  // "<tool name> <compactParams>", so wrapping the value in "Artifact(...)"
  // printed the name twice.
  formatCompactParams: (params: Record<string, unknown>) => {
    const url = typeof params.url === "string" ? params.url : "";
    switch (params.action) {
      case LIST_ACTION: {
        const scope = typeof params.scope === "string" ? params.scope : "mine";
        return `list ${scope}`;
      }
      case READ_ACTION:
        return `read ${url}`;
      case UPLOAD_ASSET_ACTION: {
        const filePath =
          typeof params.file_path === "string" ? params.file_path : "";
        return `upload ${filePath}`;
      }
      case LIST_ASSETS_ACTION:
        return `list assets ${url}`;
      case READ_ASSET_ACTION: {
        const assetId =
          typeof params.asset_id === "string" ? params.asset_id : "";
        return `read asset ${assetId}${url ? ` of ${url}` : ""}`;
      }
      case DELETE_ASSET_ACTION: {
        const assetId =
          typeof params.asset_id === "string" ? params.asset_id : "";
        return `delete asset ${assetId}${url ? ` of ${url}` : ""}`;
      }
      case COPY_FROM_ACTION: {
        const ids = Array.isArray(params.asset_ids)
          ? params.asset_ids.length
          : 0;
        const from = typeof params.from === "string" ? params.from : "";
        return `copy ${ids} asset(s) ${from} → ${url}`;
      }
      default: {
        const filePath =
          typeof params.file_path === "string" ? params.file_path : "";
        return `${filePath}${url ? ` → ${url}` : ""}`;
      }
    }
  },
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const actionRaw = typeof args.action === "string" ? args.action.trim() : "";
    const action = actionRaw || PUBLISH_ACTION;
    if (
      ![
        PUBLISH_ACTION,
        LIST_ACTION,
        READ_ACTION,
        ...ASSET_WRITE_ACTIONS,
        LIST_ASSETS_ACTION,
        READ_ASSET_ACTION,
      ].includes(action)
    ) {
      return {
        success: false,
        content: "",
        error: `${ARTIFACT_TOOL_NAME}: unknown action "${actionRaw}"`,
      };
    }

    switch (action) {
      case LIST_ACTION:
        return listArtifacts(args, context);
      case READ_ACTION:
        return readArtifact(args, context);
      case UPLOAD_ASSET_ACTION:
        return uploadAssetAction(args, context);
      case LIST_ASSETS_ACTION:
        return listAssetsAction(args, context);
      case READ_ASSET_ACTION:
        return readAssetAction(args, context);
      case DELETE_ASSET_ACTION:
        return deleteAssetAction(args, context);
      case COPY_FROM_ACTION:
        return copyFromAction(args, context);
      default:
        return publishArtifact(args, context);
    }
  },
};

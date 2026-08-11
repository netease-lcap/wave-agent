import { readFileSync } from "fs";
import path from "path";
import { marked } from "marked";
import { ARTIFACT_TOOL_NAME } from "../constants/tools.js";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { authService, createAuthAwareFetch } from "../services/authService.js";
import { logger } from "../utils/globalLogger.js";
import {
  recordArtifact,
  getArtifactByFilePath,
  getRecordedVersion,
  recordVersion,
} from "../services/artifactSession.js";

// --- Limits ---
const DEPLOY_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 15_000;
/** Server-side content limit — POSTs above this get a 413. */
const ARTIFACT_MAX_CONTENT_BYTES = 16 * 1024 * 1024; // 16MB
const LABEL_MAX_LENGTH = 60;
const DEFAULT_FAVICON = "📄";

/** Server response shape for a successful deploy (HTTP 201). */
interface DeployResponse {
  url: string;
  slug: string;
  path?: string;
  title?: string;
  version: string;
}

/** Frame metadata returned by `GET /api/frame/{slug}?via=model_read`. */
interface FrameMeta {
  slug: string;
  version: string;
  title?: string;
  favicon?: string;
  perm?: { mode: "owner" | "users" | "org"; role?: string };
  url?: string;
  contentUrl?: string;
  /** Empty/missing = shared-live (readers see live updates); non-empty = pinned. */
  shared?: string;
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

/** Extract the artifact slug from a `{host}/code/artifact/{slug}` URL. */
function extractSlugFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/code\/artifact\/([^/]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
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

/** Render Markdown to a complete HTML document (client-side md→HTML). */
function renderMarkdown(md: string, title?: string): string {
  const body = marked.parse(md, { async: false }) as string;
  const titleTag = title ? `<title>${escapeHtml(title)}</title>` : "";
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${titleTag}</head><body>${body}</body></html>`;
}

/** Probe an artifact's current metadata (`via=model_read` marks model access). */
async function probeFrame(
  slug: string,
  signal: AbortSignal,
): Promise<FrameMeta | null> {
  const serverUrl = authService.getServerUrl();
  const authFetch = createAuthAwareFetch(globalThis.fetch);
  try {
    const res = await authFetch(
      `${serverUrl}/api/frame/${encodeURIComponent(slug)}?via=model_read`,
      { method: "GET", signal },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      logger?.warn("Artifact probe failed", {
        slug,
        status: res.status,
        statusText: res.statusText,
      });
      return null;
    }
    return (await res.json()) as FrameMeta;
  } catch (err) {
    logger?.warn("Artifact probe error", { slug, error: String(err) });
    return null;
  }
}

export const artifactTool: ToolPlugin = {
  name: ARTIFACT_TOOL_NAME,
  isConcurrencySafe: false,
  config: {
    type: "function",
    function: {
      name: ARTIFACT_TOOL_NAME,
      description:
        "Publish local HTML or Markdown files as shareable web pages (artifacts). " +
        "Each publish returns a private URL you can share; the page is only accessible to you " +
        "unless you change its sharing. Only .html and .md files are supported — inline content " +
        "is not accepted. Markdown files are rendered to HTML automatically. " +
        "Pass `url` (an existing artifact URL) to redeploy that artifact, " +
        "or omit it to republish a file already published in this session. " +
        "Use `force` to overwrite an artifact that has been updated by someone else.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description:
              "Path to the .html or .md file to publish (relative to the working directory). The file must exist.",
          },
          favicon: {
            type: "string",
            description:
              "1-2 emoji characters shown as the page favicon (no text, URLs, or HTML). Defaults to 📄.",
          },
          label: {
            type: "string",
            description: `Optional short label for the artifact (max ${LABEL_MAX_LENGTH} characters).`,
          },
          url: {
            type: "string",
            description:
              "Existing artifact URL to redeploy, e.g. https://host/code/artifact/abc123. Omit when republishing a file already published earlier in this session.",
          },
          force: {
            type: "boolean",
            description:
              "Set true to overwrite an artifact that was updated since this session last saw it (stale version or conflict).",
          },
        },
        required: ["file_path"],
      },
    },
  },
  formatCompactParams: (params: Record<string, unknown>) => {
    const filePath =
      typeof params.file_path === "string" ? params.file_path : "";
    const url = typeof params.url === "string" ? params.url : "";
    return `${ARTIFACT_TOOL_NAME}(${filePath}${url ? ` → ${url}` : ""})`;
  },
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
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

    const labelRaw = typeof args.label === "string" ? args.label.trim() : "";
    const label = labelRaw || undefined;
    if (label !== undefined && label.length > LABEL_MAX_LENGTH) {
      return {
        success: false,
        content: "",
        error: `${ARTIFACT_TOOL_NAME}: label must be at most ${LABEL_MAX_LENGTH} characters (got ${label.length})`,
      };
    }

    const force = args.force === true;
    const urlRaw = typeof args.url === "string" ? args.url.trim() : "";
    const url = urlRaw || undefined;
    let slug: string | null | undefined;
    if (url) {
      slug = extractSlugFromUrl(url);
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

    const content =
      ext === ".md" ? renderMarkdown(fileContent, label) : fileContent;
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
      const meta = await probeFrame(
        slug,
        AbortSignal.timeout(PROBE_TIMEOUT_MS),
      );
      if (!meta) {
        return {
          success: false,
          content: "",
          error: `${ARTIFACT_TOOL_NAME}: artifact not found at ${url}. It may have been deleted or the URL is invalid.`,
        };
      }
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
        return {
          success: false,
          content: "",
          error: `${ARTIFACT_TOOL_NAME} operation denied by user, reason: ${permissionResult.message || "No reason provided"}`,
        };
      }
    }

    // Deploy.
    const serverUrl = authService.getServerUrl();
    const authFetch = createAuthAwareFetch(globalThis.fetch);
    const body: Record<string, unknown> = {
      content,
      favicon,
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

    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

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
  },
};

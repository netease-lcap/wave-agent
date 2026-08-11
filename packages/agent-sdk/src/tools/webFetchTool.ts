import TurndownService from "turndown";
import { LRUCache } from "lru-cache";
import { WEB_FETCH_TOOL_NAME } from "../constants/tools.js";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { logger } from "../utils/globalLogger.js";
import { isArtifactEnabled } from "../services/artifactAvailability.js";
import { authService, createAuthAwareFetch } from "../services/authService.js";
import { recordVersion } from "../services/artifactSession.js";
import {
  buildPersistedOutputMessage,
  generatePreview,
  persistToolResult,
} from "../utils/toolResultStorage.js";

// --- Security Limits ---
const MAX_HTTP_CONTENT_LENGTH = 10 * 1024 * 1024; // 10MB
const FETCH_TIMEOUT_MS = 60_000; // 60s
const MAX_REDIRECTS = 10;
const MAX_MARKDOWN_LENGTH = 100_000;
const USER_AGENT = "Wave-User (+https://github.com/netease-lcap/wave-agent)";
/** Artifact HTML beyond this size is persisted to a temp file (path + head preview). */
const ARTIFACT_PREVIEW_BYTES = 2 * 1024; // ~2KB

// --- Cache (LRU with 15min TTL, 50MB max) ---
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const CACHE_MAX_BYTES = 50 * 1024 * 1024; // 50MB

interface CacheEntry {
  bytes: number;
  code: number;
  codeText: string;
  content: string;
  contentType: string;
}

const cache = new LRUCache<string, CacheEntry>({
  ttl: CACHE_TTL,
  maxSize: CACHE_MAX_BYTES,
  sizeCalculation: (entry) => entry.bytes,
});

// --- Helpers ---

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

type URLValidationResult = { valid: true } | { valid: false; error: string };

function validateURL(url: string): URLValidationResult {
  if (url.length > 2000) {
    return {
      valid: false,
      error: "URL exceeds maximum length of 2000 characters",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    return {
      valid: false,
      error: `Invalid URL: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, error: "URL must not contain username or password" };
  }

  const hostParts = parsed.hostname.split(".");
  if (hostParts.length < 2) {
    return {
      valid: false,
      error: "URL hostname must have at least two parts (e.g., example.com)",
    };
  }

  return { valid: true };
}

function isPermittedRedirect(
  originalUrl: string,
  redirectUrl: string,
): boolean {
  try {
    const original = new URL(originalUrl);
    const redirect = new URL(redirectUrl);
    const origHost = original.host;
    const redirHost = redirect.host;

    // Same host
    if (origHost === redirHost) return true;

    // www. variation (e.g., example.com <-> www.example.com)
    const bareOrig = origHost.replace(/^www\./, "");
    const bareRedir = redirHost.replace(/^www\./, "");
    if (bareOrig === bareRedir) return true;

    return false;
  } catch {
    return false;
  }
}

// --- Artifact read channel ---

/** Extract the artifact slug from a `{host}/code/artifact/{slug}` URL. */
function extractArtifactSlug(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/code\/artifact\/([^/]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

type ArtifactReadResult =
  | {
      kind: "ok";
      slug: string;
      version: string;
      markdown: string;
      bytes: number;
    }
  | { kind: "error"; error: string };

/**
 * Fetch artifact metadata (`via=model_read`) then the HTML content (Bearer).
 * Returns markdown (HTML converted via turndown) on success.
 */
async function readArtifact(
  url: string,
  slug: string,
  abortSignal?: AbortSignal,
): Promise<ArtifactReadResult> {
  const serverUrl = authService.getServerUrl();
  const authFetch = createAuthAwareFetch(globalThis.fetch);
  const signal = abortSignal
    ? AbortSignal.any([abortSignal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
    : AbortSignal.timeout(FETCH_TIMEOUT_MS);

  let meta: Record<string, unknown>;
  try {
    const metaRes = await authFetch(
      `${serverUrl}/api/frame/${encodeURIComponent(slug)}?via=model_read`,
      { method: "GET", signal },
    );
    if (metaRes.status === 404) {
      return {
        kind: "error",
        error: `Artifact not found: ${url} (it may have been deleted)`,
      };
    }
    if (!metaRes.ok) {
      return {
        kind: "error",
        error: `Failed to fetch artifact metadata: ${metaRes.status} ${metaRes.statusText}`,
      };
    }
    meta = (await metaRes.json()) as Record<string, unknown>;
  } catch (error) {
    logger?.warn("Artifact read metadata failed", {
      slug,
      error: String(error),
    });
    return {
      kind: "error",
      error: `Failed to fetch artifact metadata: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const contentUrl = typeof meta.contentUrl === "string" ? meta.contentUrl : "";
  const version = typeof meta.version === "string" ? meta.version : "";
  if (!contentUrl) {
    return {
      kind: "error",
      error: "Artifact metadata did not include a contentUrl",
    };
  }

  let html: string;
  try {
    const contentRes = await authFetch(
      new URL(contentUrl, serverUrl).toString(),
      { method: "GET", signal },
    );
    if (!contentRes.ok) {
      return {
        kind: "error",
        error: `Failed to fetch artifact content: ${contentRes.status} ${contentRes.statusText}`,
      };
    }
    html = await contentRes.text();
  } catch (error) {
    logger?.warn("Artifact read content failed", {
      slug,
      error: String(error),
    });
    return {
      kind: "error",
      error: `Failed to fetch artifact content: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const turndownService = new TurndownService();
  const markdown = turndownService.turndown(html);
  return {
    kind: "ok",
    slug,
    version,
    markdown,
    bytes: new TextEncoder().encode(markdown).length,
  };
}

/**
 * Process an artifact read result: persist content >~2KB to a temp file
 * (return file path + head preview), run the prompt, attach artifactRead metadata.
 */
async function processArtifactRead(
  url: string,
  prompt: string,
  markdown: string,
  slug: string,
  version: string,
  context: ToolContext,
): Promise<ToolResult> {
  const bytes = new TextEncoder().encode(markdown).length;
  let aiInput = markdown;
  let persistedMessage = "";
  if (bytes > ARTIFACT_PREVIEW_BYTES) {
    const filePath = persistToolResult(markdown, "artifact");
    if (filePath) {
      persistedMessage = buildPersistedOutputMessage(
        markdown.length,
        filePath,
        generatePreview(markdown),
      );
      aiInput = persistedMessage;
    } else {
      aiInput =
        markdown.substring(0, MAX_MARKDOWN_LENGTH) +
        "\n\n... (content truncated, failed to persist full output)";
    }
  }

  const result = await processWithAI(
    url,
    prompt,
    aiInput,
    200,
    "OK",
    context,
    bytes,
  );
  result.metadata = { artifactRead: { slug, ver: version } };
  if (persistedMessage) {
    // Append the persisted-output message so the model can Read the full content.
    result.content = result.content
      ? result.content + "\n\n" + persistedMessage
      : persistedMessage;
  }
  return result;
}

// --- Tool ---

export const webFetchTool: ToolPlugin = {
  name: WEB_FETCH_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: WEB_FETCH_TOOL_NAME,
      description: `IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs. Before using this tool, check if the URL points to an authenticated service (e.g. Google Docs, Confluence, Jira, GitHub). If so, look for a specialized MCP tool that provides authenticated access.

- Fetches content from a specified URL and processes it using an AI model
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Processes the content with the prompt using a small, fast model
- Returns the model's response about the content
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions.
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - Content exceeding ${formatSize(MAX_MARKDOWN_LENGTH)} will be truncated
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - Includes an LRU cache with a 15-minute TTL for faster responses when repeatedly accessing the same URL
  - When a URL redirects to a different host, the tool will inform you and provide the redirect URL in a special format. You should then make a new WebFetch request with the redirect URL to fetch the content.
  - For GitHub URLs, prefer using the gh CLI via Bash instead (e.g., gh pr view, gh issue view, gh api).`,
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to fetch content from",
            format: "uri",
          },
          prompt: {
            type: "string",
            description: "The prompt to run on the fetched content",
          },
        },
        required: ["url", "prompt"],
        additionalProperties: false,
      },
    },
  },
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    let url = args.url as string;
    const prompt = args.prompt as string;

    if (!url || !prompt) {
      return {
        success: false,
        content: "",
        error: "Both url and prompt parameters are required",
      };
    }

    // Upgrade HTTP to HTTPS
    if (url.startsWith("http://")) {
      url = "https://" + url.substring(7);
    }

    // Validate URL
    const validation = validateURL(url);
    if (!validation.valid) {
      return {
        success: false,
        content: "",
        error: validation.error,
      };
    }

    // Artifact URL interception: {host}/code/artifact/{slug} goes through the
    // dedicated read channel (via=model_read + Bearer) instead of a public fetch.
    // Only when the Artifact tool is enabled (spec 6.4: disabled = no interception).
    if (isArtifactEnabled(context.workdir)) {
      const artifactSlug = extractArtifactSlug(url);
      if (artifactSlug) {
        const readResult = await readArtifact(
          url,
          artifactSlug,
          context.abortSignal,
        );
        if (readResult.kind === "error") {
          return { success: false, content: "", error: readResult.error };
        }
        if (context.sessionId && readResult.version) {
          // Keep the stale-version guard in sync with what the model has seen.
          recordVersion(context.sessionId, artifactSlug, readResult.version);
        }
        return processArtifactRead(
          url,
          prompt,
          readResult.markdown,
          artifactSlug,
          readResult.version,
          context,
        );
      }
    }

    try {
      const cached = cache.get(url);
      if (cached) {
        const markdown = cached.content;
        return processWithAI(
          url,
          prompt,
          markdown,
          cached.code,
          cached.codeText,
          context,
        );
      }

      // Fetch with redirect following
      const result = await fetchWithRedirects(url, context.abortSignal);

      if (result.kind === "redirect") {
        return {
          success: true,
          content: `REDIRECT_TO: ${result.redirectUrl}\nThe URL redirected to a different host. Please make a new WebFetch request with this redirect URL if you wish to continue.`,
        };
      }

      if (result.kind === "error") {
        return {
          success: false,
          content: "",
          error: result.error,
        };
      }

      const { response, finalUrl } = result;

      if (!response.ok) {
        return {
          success: false,
          content: "",
          error: `Failed to fetch URL: ${response.status} ${response.statusText}`,
        };
      }

      const contentLengthHeader = response.headers.get("content-length");
      const contentLength = contentLengthHeader
        ? parseInt(contentLengthHeader, 10)
        : null;
      if (contentLength !== null && contentLength > MAX_HTTP_CONTENT_LENGTH) {
        return {
          success: false,
          content: "",
          error: `Content too large: ${formatSize(contentLength)} exceeds limit of ${formatSize(MAX_HTTP_CONTENT_LENGTH)}`,
        };
      }

      const html = await response.text();
      const turndownService = new TurndownService();
      let markdown = turndownService.turndown(html);

      const markdownBytes = new TextEncoder().encode(markdown).length;

      // Truncate if too large
      if (markdown.length > MAX_MARKDOWN_LENGTH) {
        markdown =
          markdown.substring(0, MAX_MARKDOWN_LENGTH) +
          `[Content truncated at ${MAX_MARKDOWN_LENGTH} characters due to length limit.]`;
      }

      // Store in LRU cache
      cache.set(finalUrl, {
        bytes: markdownBytes,
        code: response.status,
        codeText: response.statusText,
        content: markdown,
        contentType: response.headers.get("content-type") || "",
      });

      return processWithAI(
        finalUrl,
        prompt,
        markdown,
        response.status,
        response.statusText,
        context,
        markdownBytes,
      );
    } catch (error) {
      logger.error(`WebFetch failed for ${url}:`, error);
      return {
        success: false,
        content: "",
        error: `WebFetch failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
  formatCompactParams: (params: Record<string, unknown>) => {
    return `Fetch ${params.url}`;
  },
};

// --- Fetch with redirect following ---

async function fetchWithRedirects(
  initialUrl: string,
  abortSignal?: AbortSignal,
  redirectCount = 0,
): Promise<
  | { kind: "response"; response: Response; finalUrl: string }
  | { kind: "redirect"; redirectUrl: string }
  | { kind: "error"; error: string }
> {
  if (redirectCount >= MAX_REDIRECTS) {
    return {
      kind: "error",
      error: `Too many redirects (max ${MAX_REDIRECTS})`,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  // Forward the context's abort signal if provided
  if (abortSignal) {
    abortSignal.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }

  let response: Response;
  try {
    response = await fetch(initialUrl, {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/markdown, text/html, */*",
      },
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (location) {
      const redirectUrl = new URL(location, initialUrl).toString();

      if (!isPermittedRedirect(initialUrl, redirectUrl)) {
        return { kind: "redirect", redirectUrl };
      }

      // Follow permitted redirect recursively
      return fetchWithRedirects(redirectUrl, abortSignal, redirectCount + 1);
    }
  }

  return { kind: "response", response, finalUrl: initialUrl };
}

// --- AI Processing ---

async function processWithAI(
  url: string,
  prompt: string,
  markdown: string,
  statusCode: number,
  statusText: string,
  context: ToolContext,
  contentSize?: number,
): Promise<ToolResult> {
  if (!context.aiManager || !context.aiService) {
    return {
      success: false,
      content: markdown,
      error: "AI Manager or AI Service not available for processing content",
    };
  }

  const modelConfig = context.aiManager.getModelConfig();
  const fastModel = modelConfig.fastModel;

  const aiResponse = await context.aiService.processWebContent({
    gatewayConfig: context.aiManager.getGatewayConfig(),
    modelConfig: modelConfig,
    content: markdown,
    prompt: prompt,
    model: fastModel,
    abortSignal: context.abortSignal,
  });

  const sizeStr =
    contentSize !== undefined ? formatSize(contentSize) : "unknown size";
  const statusStr = `${statusCode} ${statusText}`.trim();

  return {
    success: true,
    content: aiResponse.content || "",
    shortResult: `Received ${sizeStr} (${statusStr}) from ${url}`,
  };
}

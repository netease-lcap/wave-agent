import { LRUCache } from "lru-cache";
import { WEB_FETCH_TOOL_NAME } from "../constants/tools.js";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { logger } from "../utils/globalLogger.js";
import { isArtifactEnabled } from "../services/artifactAvailability.js";
import { recordVersion } from "../services/artifactSession.js";
import {
  extractArtifactSlug,
  htmlToMarkdown,
  readArtifactContent,
  summarizeArtifactAsReader,
} from "../services/artifactContent.js";
import {
  formatSize,
  processContentWithAI,
} from "../services/contentSummarizer.js";
import { persistToolResultBuffer } from "../utils/toolResultStorage.js";

// --- Security Limits ---
const MAX_HTTP_CONTENT_LENGTH = 10 * 1024 * 1024; // 10MB
const FETCH_TIMEOUT_MS = 60_000; // 60s
const MAX_REDIRECTS = 10;
const MAX_MARKDOWN_LENGTH = 100_000;
const USER_AGENT = "Wave-User (+https://github.com/netease-lcap/wave-agent)";

// --- Cache (LRU with 15min TTL, 50MB max) ---
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const CACHE_MAX_BYTES = 50 * 1024 * 1024; // 50MB

interface CacheEntry {
  bytes: number;
  code: number;
  codeText: string;
  content: string;
  contentType: string;
  /** Set for binary fetches: the file the bytes were written to. */
  persistedPath?: string;
  persistedSize?: number;
}

const cache = new LRUCache<string, CacheEntry>({
  ttl: CACHE_TTL,
  maxSize: CACHE_MAX_BYTES,
  sizeCalculation: (entry) => entry.bytes,
});

// --- Helpers ---

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

/**
 * Content types that carry text or markup. Everything else — images, PDFs,
 * fonts, archives — is binary and must not travel through the text channel.
 * Claude Code decides this with the same allowlist.
 */
function isBinaryContentType(contentType: string): boolean {
  if (!contentType) return false;
  const mime = contentType.split(";")[0].trim();
  if (mime.startsWith("text/")) return false;
  if (mime.endsWith("+json") || mime === "application/json") return false;
  if (mime.endsWith("+xml") || mime === "application/xml") return false;
  if (mime.startsWith("application/javascript")) return false;
  if (mime === "application/x-www-form-urlencoded") return false;
  return true;
}

/** `image/png; charset=binary` → `png`, used only as the persisted file suffix. */
function binaryExtension(contentType: string): string {
  return contentType.split(";")[0].split("/")[1]?.split("+")[0] ?? "";
}

/**
 * HTML is the only body worth converting. Markdown, plain text, JSON and XML
 * are already text: running them through turndown parses them as HTML, which
 * collapses every newline into one line and escapes the markup characters.
 * Claude Code branches on `text/html` the same way; the sniff covers responses
 * that ship no content-type at all.
 */
function isHtmlResponse(contentType: string, body: string): boolean {
  if (contentType) return contentType.includes("text/html");
  return /^\s*</.test(body);
}

/**
 * A binary fetch reports the file its bytes landed in, never the bytes
 * themselves. The cached entry carries the same path, so a repeat fetch
 * re-announces the file instead of downloading it again — Claude Code reuses
 * `persistedPath` the same way.
 */
function savedBinaryMessage({
  status,
  contentType,
  size,
  filePath,
}: {
  status: string;
  contentType: string;
  size: string;
  filePath?: string;
}): string {
  return filePath
    ? `Fetched ${status} — ${contentType}, ${size} of binary content.\nSaved to: ${filePath}\nRead that file with the Read tool if you need its contents.`
    : `Fetched ${contentType}, ${size} of binary content, but it could not be saved to a file.`;
}

// --- Tool ---

export const webFetchTool: ToolPlugin = {
  name: WEB_FETCH_TOOL_NAME,
  defer: true,
  searchHint: "fetch a URL and extract its readable text to read or summarize",
  leanPrompt: `Fetches a URL, converts HTML to markdown, and answers \`prompt\` about it with a small, fast model. Read-only; no files are modified.

- The URL must be fully formed; HTTP is upgraded to HTTPS.
- WILL FAIL for authenticated or private URLs (Google Docs, Confluence, Jira, GitHub) — look for an MCP tool that has authenticated access instead.
- HTML is converted; markdown, JSON and plain text are passed through as-is; binary responses are saved to a file you can Read.
- Content over ${formatSize(MAX_MARKDOWN_LENGTH)} is truncated, and very large results may be summarized.
- If the tool reports a redirect to another host, call it again with the redirect URL.`,
  config: {
    type: "function",
    function: {
      name: WEB_FETCH_TOOL_NAME,
      description: `IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs. Before using this tool, check if the URL points to an authenticated service (e.g. Google Docs, Confluence, Jira, GitHub). If so, look for a specialized MCP tool that provides authenticated access.

- Fetches content from a specified URL and processes it using an AI model
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Non-HTML text (markdown, JSON, XML, plain text) is passed through as-is; binary responses (images, PDFs) are saved to a file whose path is reported
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
        const readResult = await readArtifactContent(artifactSlug, {
          url,
          abortSignal: context.abortSignal,
        });
        if (readResult.kind === "error") {
          return { success: false, content: "", error: readResult.error };
        }
        const { slug, version } = readResult.artifact;
        if (context.sessionId && version) {
          // Keep the stale-version guard in sync with what the model has seen.
          recordVersion(context.sessionId, slug, version);
        }
        const result = await summarizeArtifactAsReader(
          url,
          prompt,
          readResult.artifact,
          context,
        );
        result.metadata = { artifactRead: { slug, ver: version } };
        return result;
      }
    }

    try {
      const cached = cache.get(url);
      if (cached) {
        // A cached binary fetch only has a path to report — nothing to send to
        // the model.
        if (cached.persistedPath) {
          return {
            success: true,
            content: savedBinaryMessage({
              status: `${cached.code} ${cached.codeText}`.trim(),
              contentType: cached.contentType,
              size: formatSize(cached.persistedSize ?? cached.bytes),
              filePath: cached.persistedPath,
            }),
          };
        }

        const markdown = cached.content;
        return processContentWithAI(
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

      const contentType = (
        response.headers.get("content-type") || ""
      ).toLowerCase();

      // Binary payloads cannot travel through the text channel: decoding them
      // yields mojibake, so they land on disk for the Read tool instead.
      if (isBinaryContentType(contentType)) {
        const bytes = Buffer.from(await response.arrayBuffer());
        const status = `${response.status} ${response.statusText}`.trim();
        const filePath = persistToolResultBuffer(
          bytes,
          "webfetch",
          binaryExtension(contentType),
        );

        // Only a saved file is worth caching: without a path there is nothing
        // to re-announce, and a cached empty body would silently starve the
        // model on the next request.
        if (filePath) {
          cache.set(finalUrl, {
            bytes: bytes.length,
            code: response.status,
            codeText: response.statusText,
            content: "",
            contentType,
            persistedPath: filePath,
            persistedSize: bytes.length,
          });
        }

        return {
          success: true,
          content: savedBinaryMessage({
            status,
            contentType,
            size: formatSize(bytes.length),
            filePath,
          }),
        };
      }

      const body = await response.text();

      let text = isHtmlResponse(contentType, body)
        ? htmlToMarkdown(body)
        : body;

      const textBytes = new TextEncoder().encode(text).length;

      // Truncate if too large
      if (text.length > MAX_MARKDOWN_LENGTH) {
        text =
          text.substring(0, MAX_MARKDOWN_LENGTH) +
          `[Content truncated at ${MAX_MARKDOWN_LENGTH} characters due to length limit.]`;
      }

      // Store in LRU cache
      cache.set(finalUrl, {
        bytes: textBytes,
        code: response.status,
        codeText: response.statusText,
        content: text,
        contentType,
      });

      return processContentWithAI(
        finalUrl,
        prompt,
        text,
        response.status,
        response.statusText,
        context,
        textBytes,
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

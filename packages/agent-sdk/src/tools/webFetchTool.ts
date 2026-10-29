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

/**
 * Characters handed to the answering model in one call. A longer page is not
 * silently cut: the call reads this interval verbatim, previews what follows
 * with a second (summarizing) call, and reports the `offset` needed to continue
 * where it stopped. Claude Code caps its WebFetch helper at the same 100,000.
 */
const MAX_VERBATIM_CHARS = 100_000;

/** Ceiling on the summary of the part that did not fit the verbatim interval. */
const OVERFLOW_SUMMARY_MAX_CHARS = 8_000;

const USER_AGENT = "Wave-User (+https://github.com/netease-lcap/wave-agent)";

// --- Cache (LRU with 15min TTL, 50MB max) ---
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const CACHE_MAX_BYTES = 50 * 1024 * 1024; // 50MB

interface CacheEntry {
  bytes: number;
  code: number;
  codeText: string;
  /** The page's whole readable text, not one interval of it — an `offset` read
   * must be servable from the cache without downloading the page again. */
  content: string;
  contentType: string;
  /** Set for binary fetches: the file the bytes were written to. */
  persistedPath?: string;
  persistedSize?: number;
}

const cache = new LRUCache<string, CacheEntry>({
  ttl: CACHE_TTL,
  // Sweep expired entries on their own: without this an entry only leaves when
  // a later write pushes the total over `maxSize`, so one expired 10MB page can
  // sit in memory indefinitely. Claude Code schedules the same sweep.
  ttlAutopurge: true,
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

/**
 * One verbatim interval of a page, plus what is left over after it. The
 * answering model only ever sees `body`; `remainingChars` is what the caller has
 * not covered and needs another call (with `endOffset`) to reach.
 */
interface WebContentChunk {
  /** Verbatim interval handed to the answering model. */
  body: string;
  /** Absolute offset just past `body` — also the `offset` of the next read. */
  endOffset: number;
  /** Characters from `endOffset` to the end of the page. */
  remainingChars: number;
}

function buildWebContentChunk(
  content: string,
  offset: number,
): WebContentChunk {
  const body = content.slice(offset, offset + MAX_VERBATIM_CHARS);
  const endOffset = offset + body.length;
  return {
    body,
    endOffset,
    remainingChars: Math.max(0, content.length - endOffset),
  };
}

/** Tolerate a string or a negative offset; anything unusable means "from the start". */
function normalizeOffset(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function pastEndMessage(offset: number, totalChars: number): string {
  if (totalChars === 0) {
    return "The page has no readable text, so there is nothing to read.";
  }
  return `No content after offset ${offset}: the page's readable text is ${totalChars} characters long, so offsets 0–${
    totalChars - 1
  } are the ones that read anything. Use offset 0 to read from the start.`;
}

/**
 * Summarize the part that did not fit the verbatim interval, so one call still
 * covers the whole page cheaply. The same prompt is applied to the overflow —
 * Claude Code's helper does the same — and the text goes through the same
 * untrusted-content fence, because it lands in the conversation as well.
 * Returns undefined on any failure: the caller then reports that the range was
 * not read rather than pretending the answer covered the page.
 */
async function summarizeOverflow(
  prompt: string,
  overflow: string,
  context: ToolContext,
): Promise<string | undefined> {
  if (!context.aiManager || !context.aiService) return undefined;

  const modelConfig = context.aiManager.getModelConfig();
  try {
    const response = await context.aiService.processWebContent({
      gatewayConfig: context.aiManager.getGatewayConfig(),
      modelConfig,
      content: overflow,
      prompt,
      model: modelConfig.fastModel,
      abortSignal: context.abortSignal,
    });
    const summary = response.content?.trim();
    if (!summary) return undefined;
    return summary.length > OVERFLOW_SUMMARY_MAX_CHARS
      ? `${summary.slice(0, OVERFLOW_SUMMARY_MAX_CHARS)}…`
      : summary;
  } catch (error) {
    logger.error("WebFetch overflow summary failed:", error);
    return undefined;
  }
}

/**
 * Compose the result for a read that does not cover the whole page. It has to
 * be explicit about three things, because the model only sees this text: which
 * characters the answer is based on, which characters it is not, and the
 * `offset` that reaches the rest — otherwise a truncated page reads like a
 * complete one.
 */
function composeChunkedResult({
  url,
  answer,
  offset,
  chunk,
  totalChars,
  previewedChars,
  summary,
}: {
  url: string;
  answer: string;
  offset: number;
  chunk: WebContentChunk;
  totalChars: number;
  previewedChars: number;
  summary?: string;
}): string {
  const previewEnd = chunk.endOffset + previewedChars;
  const parts = [
    `Read characters ${offset}–${chunk.endOffset} of ${totalChars} from ${url}. The answer below is based on that verbatim range only.`,
    answer,
  ];

  // Nothing left over (an offset read that landed exactly on the last
  // interval): the banner already says which range was read, and there is
  // nothing to preview or continue to.
  if (chunk.remainingChars === 0) return parts.join("\n\n");

  parts.push(
    summary
      ? `--- Summary of characters ${chunk.endOffset}–${previewEnd} (not read verbatim) ---\n\n${summary}`
      : `--- Characters ${chunk.endOffset}–${previewEnd} were not read ---\n\nTheir summary could not be generated, so these ${previewedChars} characters went unread.`,
  );

  const unreadTail = chunk.remainingChars - previewedChars;
  if (unreadTail > 0) {
    parts.push(
      `A further ${unreadTail} characters (from ${previewEnd} to ${totalChars}) were neither read nor summarized.`,
    );
  }

  parts.push(
    `This page is not fully covered. To read further, call WebFetch again with the same url and offset: ${chunk.endOffset}.`,
  );

  return parts.join("\n\n");
}

/**
 * Answer `prompt` about `text`, reading at most one verbatim interval of it.
 * A page that fits in one interval behaves exactly as it did before chunking
 * existed: one model call and the model's answer, nothing appended.
 */
async function answerFromText({
  url,
  prompt,
  text,
  code,
  codeText,
  offset,
  context,
}: {
  url: string;
  prompt: string;
  text: string;
  code: number;
  codeText: string;
  offset: number;
  context: ToolContext;
}): Promise<ToolResult> {
  const chunk = buildWebContentChunk(text, offset);
  if (!chunk.body) {
    return { success: true, content: pastEndMessage(offset, text.length) };
  }

  const answer = await processContentWithAI(
    url,
    prompt,
    chunk.body,
    code,
    codeText,
    context,
    new TextEncoder().encode(text).length,
  );
  if (!answer.success) return answer;
  if (offset === 0 && chunk.remainingChars === 0) return answer;

  // The preview is capped at one interval too: a 10MB page must not turn into a
  // second full-size model call.
  const preview = text.slice(
    chunk.endOffset,
    chunk.endOffset + MAX_VERBATIM_CHARS,
  );
  const summary = preview
    ? await summarizeOverflow(prompt, preview, context)
    : undefined;

  return {
    ...answer,
    content: composeChunkedResult({
      url,
      answer: answer.content,
      offset,
      chunk,
      totalChars: text.length,
      previewedChars: preview.length,
      summary,
    }),
  };
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
- Content over ${formatSize(MAX_VERBATIM_CHARS)} is read in intervals: the answer covers one interval verbatim, the next part is summarized, and the result reports the \`offset\` to continue from.
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
  - Content exceeding ${formatSize(MAX_VERBATIM_CHARS)} is read in intervals; the result reports the \`offset\` to continue from
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
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
          offset: {
            type: "number",
            description: `Character offset into the page's readable text to start reading from. Omit it for the first read. When the result says the page is not fully covered, it reports the offset to continue from — pass that value back to read the next part.`,
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
    const offset = normalizeOffset(args.offset);

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

        return answerFromText({
          url,
          prompt,
          text: cached.content,
          code: cached.code,
          codeText: cached.codeText,
          offset,
          context,
        });
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
          cache.set(url, {
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

      const text = isHtmlResponse(contentType, body)
        ? htmlToMarkdown(body)
        : body;

      // The whole readable text, not one interval of it — chunking happens per
      // read, so a cached page must still be able to answer an `offset` read.
      // Keyed by the URL the caller asked for, never by where a permitted
      // same-host redirect landed: `cache.get(url)` looks up exactly that key,
      // so storing under the redirect target meant a site that redirects
      // `example.com` → `www.example.com` never hit its own cache. Claude Code
      // keys its WebFetch cache the same way.
      cache.set(url, {
        bytes: new TextEncoder().encode(text).length,
        code: response.status,
        codeText: response.statusText,
        content: text,
        contentType,
      });

      return answerFromText({
        url: finalUrl,
        prompt,
        text,
        code: response.status,
        codeText: response.statusText,
        offset,
        context,
      });
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

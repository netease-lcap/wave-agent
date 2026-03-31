import TurndownService from "turndown";
import { WEB_FETCH_TOOL_NAME } from "../constants/tools.js";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { logger } from "../utils/globalLogger.js";

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const cache = new Map<string, { content: string; timestamp: number }>();

function getFromCache(url: string): string | null {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.content;
  }
  if (cached) {
    cache.delete(url);
  }
  return null;
}

function setToCache(url: string, content: string) {
  cache.set(url, { content, timestamp: Date.now() });
}

// Clean up cache every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [url, cached] of cache.entries()) {
    if (now - cached.timestamp >= CACHE_TTL) {
      cache.delete(url);
    }
  }
}, CACHE_TTL);

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
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - Includes a self-cleaning 15-minute cache for faster responses when repeatedly accessing the same URL
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

    // Check for GitHub URLs
    if (url.includes("github.com")) {
      return {
        success: false,
        content: "",
        error:
          "For GitHub URLs, please use the 'gh' CLI via the Bash tool instead (e.g., 'gh pr view', 'gh issue view', 'gh api').",
      };
    }

    try {
      let markdown = getFromCache(url);

      if (!markdown) {
        const response = await fetch(url, {
          redirect: "manual",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          },
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (location) {
            const redirectUrl = new URL(location, url).toString();
            const originalHost = new URL(url).host;
            const redirectHost = new URL(redirectUrl).host;

            if (originalHost !== redirectHost) {
              return {
                success: true,
                content: `REDIRECT_TO: ${redirectUrl}\nThe URL redirected to a different host. Please make a new WebFetch request with this redirect URL if you wish to continue.`,
              };
            }
            // If same host, we could follow it, but the requirement says "When a URL redirects to a different host, the tool will inform you".
            // For simplicity and following the requirement strictly, let's just return the redirect for different hosts.
            // If it's the same host, we can try to fetch again or just return it too.
            return {
              success: true,
              content: `REDIRECT_TO: ${redirectUrl}\nThe URL redirected. Please make a new WebFetch request with this redirect URL.`,
            };
          }
        }

        if (!response.ok) {
          return {
            success: false,
            content: "",
            error: `Failed to fetch URL: ${response.status} ${response.statusText}`,
          };
        }

        const html = await response.text();
        const turndownService = new TurndownService();
        markdown = turndownService.turndown(html);
        setToCache(url, markdown);
      }

      // Process with AI
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

      return {
        success: true,
        content: aiResponse.content || "",
        shortResult: `Processed content from ${url}`,
      };
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

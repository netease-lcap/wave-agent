import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("../../src/services/authService.js", () => ({
  authService: {
    getServerUrl: vi.fn(),
  },
  createAuthAwareFetch: vi.fn((innerFetch: typeof fetch) => innerFetch),
}));

vi.mock("../../src/services/artifactAvailability.js", () => ({
  isArtifactEnabled: vi.fn(),
}));

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/utils/toolResultStorage.js", () => ({
  persistToolResult: vi
    .fn()
    .mockReturnValue("/tmp/wave-tool-results/artifact_1.txt"),
  buildPersistedOutputMessage: vi.fn(
    (len: number, filePath: string, preview: string) =>
      `<persisted-output>${len} chars -> ${filePath} preview: ${preview}</persisted-output>`,
  ),
  generatePreview: vi.fn((s: string) => s.substring(0, 100)),
}));

import { authService } from "../../src/services/authService.js";
import { isArtifactEnabled } from "../../src/services/artifactAvailability.js";
import { webFetchTool } from "../../src/tools/webFetchTool.js";
import type { ToolContext } from "../../src/tools/types.js";
import {
  clearArtifactSession,
  getRecordedVersion,
} from "../../src/services/artifactSession.js";

const SESSION_ID = "test-session";
const SERVER_URL = "https://server.test";
const ARTIFACT_URL = "https://server.test/code/artifact/abc";
const CONTENT_URL = "/api/frame/abc/content";

function jsonResponse(status: number, body: unknown): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Not Found",
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(body as string),
  };
}

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workdir: "/test/workdir",
    sessionId: SESSION_ID,
    aiManager: {
      getModelConfig: vi.fn().mockReturnValue({
        model: "gpt-4",
        fastModel: "gpt-3.5-turbo",
      }),
      getGatewayConfig: vi.fn().mockReturnValue({
        apiKey: "test-key",
        baseURL: "https://api.openai.com/v1",
      }),
    } as unknown as ToolContext["aiManager"],
    aiService: {
      processWebContent: vi.fn().mockResolvedValue({
        content: "This is a summary of the artifact.",
      }),
    } as unknown as ToolContext["aiService"],
    ...overrides,
  } as ToolContext;
}

describe("webFetchTool artifact interception", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    clearArtifactSession(SESSION_ID);
    (authService.getServerUrl as Mock).mockReturnValue(SERVER_URL);
    (isArtifactEnabled as Mock).mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearArtifactSession(SESSION_ID);
  });

  it("should read via the dedicated channel and summarize the markdown", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/frame/abc?via=model_read")) {
        return Promise.resolve(
          jsonResponse(200, {
            slug: "abc",
            version: "v3",
            contentUrl: CONTENT_URL,
          }),
        );
      }
      if (url === `${SERVER_URL}${CONTENT_URL}`) {
        return Promise.resolve(
          jsonResponse(
            200,
            "<html><body><h1>Artifact Title</h1><p>Body text</p></body></html>",
          ),
        );
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal("fetch", fetchMock);

    const context = makeContext();
    const result = await webFetchTool.execute(
      { url: ARTIFACT_URL, prompt: "Summarize" },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe("This is a summary of the artifact.");
    expect(result.metadata).toEqual({
      artifactRead: { slug: "abc", ver: "v3" },
    });
    // Metadata probe goes through via=model_read, content through the Bearer URL.
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER_URL}/api/frame/abc?via=model_read`,
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `${SERVER_URL}${CONTENT_URL}`,
      expect.any(Object),
    );
    // The AI sees the converted markdown, not raw HTML.
    expect(context.aiService!.processWebContent).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Artifact Title"),
        prompt: "Summarize",
      }),
    );
    // The read version is recorded for the stale-version guard.
    expect(getRecordedVersion(SESSION_ID, "abc")).toBe("v3");
  });

  it("should report a 404 artifact as deleted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, {})));
    const result = await webFetchTool.execute(
      { url: ARTIFACT_URL, prompt: "Summarize" },
      makeContext(),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain(
      "Artifact not found: https://server.test/code/artifact/abc",
    );
  });

  it("should persist large artifact content and surface the persisted-output message", async () => {
    const largeHtml = `<html><body><p>${"x".repeat(5000)}</p></body></html>`;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/frame/abc?via=model_read")) {
        return Promise.resolve(
          jsonResponse(200, {
            slug: "abc",
            version: "v1",
            contentUrl: CONTENT_URL,
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, largeHtml));
    });
    vi.stubGlobal("fetch", fetchMock);

    const context = makeContext();
    const result = await webFetchTool.execute(
      { url: ARTIFACT_URL, prompt: "Summarize" },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("<persisted-output>");
    // The model is fed the persisted-output message, not 5KB of raw content.
    expect(context.aiService!.processWebContent).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("<persisted-output>"),
      }),
    );
    expect(result.metadata).toEqual({
      artifactRead: { slug: "abc", ver: "v1" },
    });
  });

  it("should NOT intercept artifact URLs when the feature is disabled", async () => {
    (isArtifactEnabled as Mock).mockReturnValue(false);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: vi
        .fn()
        .mockResolvedValue("<html><body><h1>Direct fetch</h1></body></html>"),
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await webFetchTool.execute(
      { url: ARTIFACT_URL, prompt: "Summarize" },
      makeContext(),
    );

    expect(result.success).toBe(true);
    // Falls through to the normal fetch path with the raw artifact URL.
    expect(fetchMock).toHaveBeenCalledWith(ARTIFACT_URL, expect.any(Object));
    expect(result.metadata).toBeUndefined();
  });
});

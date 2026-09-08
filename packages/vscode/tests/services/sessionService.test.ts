import { describe, test, expect, vi } from "vitest";
import type { SessionMetadata } from "wave-agent-sdk/types";
import { SessionService } from "../../src/services/sessionService";
import type { StdioClient } from "../../src/stdio/stdioClient";

// The vitest config aliases "vscode" to tests/__mocks__/vscode.ts, whose
// workspace.workspaceFolders[0].uri.fsPath is "/test-workspace" — the workdir
// SessionService must pass through to the CLI listSessions RPC.

function makeSession(
  id: string,
  sessionType: SessionMetadata["sessionType"] = "main",
  seq = 0,
): SessionMetadata {
  return {
    id,
    sessionType,
    workdir: "/test-workspace",
    createdAt: new Date(2026, 0, 1, 0, 0, seq),
    lastActiveAt: new Date(2026, 0, 1, 0, 0, seq),
    latestTotalTokens: 0,
    firstMessage: `first message ${id}`,
  };
}

function createService(sessionList: SessionMetadata[]) {
  const utilityClient = {
    request: vi.fn().mockResolvedValue({ sessions: sessionList }),
  };
  const service = new SessionService(utilityClient as unknown as StdioClient);
  return { service, utilityClient };
}

describe("SessionService.getSessionsList", () => {
  test("requests sessions for the first workspace folder", async () => {
    const { service, utilityClient } = createService([]);
    await service.getSessionsList();
    expect(utilityClient.request).toHaveBeenCalledWith("listSessions", {
      workdir: "/test-workspace",
    });
  });

  test("keeps only main sessions and preserves their order", async () => {
    const sessions = [
      makeSession("session-oldest", "main", 1),
      makeSession("session-subagent", "subagent", 2),
      makeSession("session-newest", "main", 3),
    ];
    const { service } = createService(sessions);
    const result = await service.getSessionsList();
    expect(result.map((s) => s.id)).toEqual([
      "session-oldest",
      "session-newest",
    ]);
  });

  test("returns every main session — no cap hides sessions past the tenth", async () => {
    // Regression: the history popup has no pagination, so a host-side slice
    // would make sessions older than the cap unreachable from the UI.
    const sessions = Array.from({ length: 12 }, (_, i) =>
      makeSession(`session-${i + 1}`, "main", i),
    );
    sessions.push(makeSession("session-subagent", "subagent", 99));
    const { service } = createService(sessions);
    const result = await service.getSessionsList();
    expect(result).toHaveLength(12);
    expect(result.map((s) => s.id)).toEqual(
      Array.from({ length: 12 }, (_, i) => `session-${i + 1}`),
    );
  });

  test("propagates failures from the underlying CLI request", async () => {
    const utilityClient = {
      request: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const service = new SessionService(utilityClient as unknown as StdioClient);
    await expect(service.getSessionsList()).rejects.toThrow("boom");
  });
});

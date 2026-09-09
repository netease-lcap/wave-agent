import { describe, expect, it, vi } from "vitest";
import { StdioAgent } from "wave-agent-sdk/stdio";
import type { JsonRpcClient } from "../../src/main/stdio/jsonRpcClient";
import type { NotificationRouter } from "wave-agent-sdk/stdio";

describe("StdioAgent.getSkillMetadata", () => {
  it("requests skill metadata with the sessionId and returns the skills array", async () => {
    const request = vi.fn(async () => ({
      skills: [
        {
          name: "deep-research",
          description: "Deep research",
          type: "builtin",
        },
      ],
    }));
    const agent = new StdioAgent(
      { request } as unknown as JsonRpcClient,
      {} as unknown as NotificationRouter,
      {},
    );
    agent.sessionId = "sess-1";

    const skills = await agent.getSkillMetadata();

    expect(request).toHaveBeenCalledWith(
      "getSkillMetadata",
      undefined,
      "sess-1",
    );
    expect(skills).toEqual([
      { name: "deep-research", description: "Deep research", type: "builtin" },
    ]);
  });
});

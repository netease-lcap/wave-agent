/**
 * Real-command hook integration tests.
 *
 * Covers docs/specs/automation/hooks.md scenarios that the mocked suites
 * (tests/agent/hooks-exitcode-output/*, which stub executeHooks) cannot:
 * hook commands are REALLY executed through the OS shell via
 * Agent.create({ hooks }) and verified through agent.messages, per the
 * spec's "测试验证需求": 成功反馈 / 场景 1 (UserPromptSubmit stdout
 * injection), 阻止性错误处理 / 场景 1-2 (PreToolUse/PostToolUse exit 2)
 * and 异步 Hook 执行 / 场景 1 (async hooks don't block).
 *
 * TEST_HOOK_EXECUTION opts out of the NODE_ENV=test short-circuit in
 * executeCommand (see hook-windows-execution.test.ts).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { Agent } from "../../src/agent.js";
import * as aiService from "../../src/services/aiService.js";
import type { PartialHookConfiguration } from "../../src/types/hooks.js";

vi.mock("../../src/services/aiService.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/services/aiService.js")>();
  return {
    ...actual,
    callAgent: vi.fn(),
  };
});

// Let hook commands really spawn (executeCommand short-circuits under test).
process.env.TEST_HOOK_EXECUTION = "true";

/** Concatenated text of a message's text blocks (Message content lives in blocks). */
function blockText(m: {
  blocks?: Array<{ type: string; content?: unknown }>;
}): string {
  return (m.blocks ?? [])
    .map((b) =>
      b.type === "text" ? String((b as { content: string }).content ?? "") : "",
    )
    .join("\n");
}

describe("Hook real-command execution (spec automation/hooks.md)", () => {
  let agent: Agent | undefined;
  let callAgent: ReturnType<typeof vi.fn>;
  let workdir: string;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-hook-real-"));
    callAgent = vi.mocked(aiService.callAgent);
    callAgent.mockClear();
  });

  afterEach(async () => {
    if (agent) {
      await agent.destroy();
      agent = undefined;
    }
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("blocks the tool and surfaces stderr when PreToolUse exits 2 (hooks.md / Hook 阻止性错误处理 / 场景 1)", async () => {
    const hooks: PartialHookConfiguration = {
      PreToolUse: [
        {
          matcher: "Write",
          hooks: [
            {
              type: "command",
              command:
                "node -e 'console.error(\"BLOCKED_BY_PRE_HOOK\"); process.exit(2)'",
            },
          ],
        },
      ],
    };
    agent = await Agent.create({ workdir, hooks });

    const target = path.join(workdir, "blocked.txt");
    callAgent
      .mockResolvedValueOnce({
        content: "",
        tool_calls: [
          {
            id: "call_hook",
            type: "function" as const,
            function: {
              name: "Write",
              arguments: JSON.stringify({
                file_path: target,
                content: "should not be written",
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      })
      .mockResolvedValueOnce({
        content: "I could not write the file.",
        finish_reason: "stop",
      });

    await agent.sendMessage("write the file");

    // Tool was blocked: the real Write tool never touched the filesystem.
    expect(fs.existsSync(target)).toBe(false);

    // The ToolBlock result carries the hook stderr (spec verification mode).
    const assistantMessage = agent.messages.find(
      (m) => m.role === "assistant" && m.blocks?.some((b) => b.type === "tool"),
    );
    const toolBlock = assistantMessage?.blocks?.find((b) => b.type === "tool");
    expect(toolBlock).toBeDefined();
    expect(String((toolBlock as { result?: unknown }).result)).toContain(
      "BLOCKED_BY_PRE_HOOK",
    );
    // The AI loop continued after the block (second call happened).
    expect(callAgent).toHaveBeenCalledTimes(2);
  });

  it("injects UserPromptSubmit stdout as a second user message (hooks.md / Hook 成功反馈 / 场景 1)", async () => {
    const hooks: PartialHookConfiguration = {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: "node -e 'console.log(\"HOOK_ADDED_CONTEXT\")'",
            },
          ],
        },
      ],
    };
    agent = await Agent.create({ workdir, hooks });
    callAgent.mockResolvedValue({ content: "ok", finish_reason: "stop" });

    await agent.sendMessage("hello");

    const userMessages = agent.messages.filter((m) => m.role === "user");
    // Spec: two user messages, the second carrying the hook stdout.
    expect(userMessages.length).toBeGreaterThanOrEqual(2);
    const hookContext = userMessages.find((m) =>
      blockText(m).includes("HOOK_ADDED_CONTEXT"),
    );
    expect(hookContext).toBeDefined();
  });

  it("lets PostToolUse exit 2 report stderr without undoing the tool (hooks.md / Hook 阻止性错误处理 / 场景 2)", async () => {
    const hooks: PartialHookConfiguration = {
      PostToolUse: [
        {
          matcher: "Write",
          hooks: [
            {
              type: "command",
              command:
                "node -e 'console.error(\"POST_HOOK_ERR\"); process.exit(2)'",
            },
          ],
        },
      ],
    };
    agent = await Agent.create({
      workdir,
      hooks,
      // The real Write tool needs permission approval to actually execute.
      canUseTool: async () => ({ behavior: "allow" }),
    });

    const target = path.join(workdir, "written.txt");
    callAgent
      .mockResolvedValueOnce({
        content: "",
        tool_calls: [
          {
            id: "call_post",
            type: "function" as const,
            function: {
              name: "Write",
              arguments: JSON.stringify({
                file_path: target,
                content: "written",
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      })
      .mockResolvedValueOnce({
        content: "File written.",
        finish_reason: "stop",
      });

    await agent.sendMessage("write a file");

    // The tool itself succeeded (PostToolUse runs after execution).
    expect(fs.existsSync(target)).toBe(true);
    // The hook stderr reaches the conversation as a user message.
    const hookError = agent.messages.find(
      (m) => m.role === "user" && blockText(m).includes("POST_HOOK_ERR"),
    );
    expect(hookError).toBeDefined();
    // AI continued after the non-blocking hook error.
    expect(callAgent).toHaveBeenCalledTimes(2);
  });

  it("runs async hooks in the background without blocking the turn (hooks.md / 异步 Hook 执行 / 场景 1)", async () => {
    const markerFile = path.join(workdir, "async-hook-done.txt");
    const hooks: PartialHookConfiguration = {
      Stop: [
        {
          hooks: [
            {
              type: "command",
              async: true,
              command: `node -e 'setTimeout(() => require("fs").writeFileSync(process.argv[1], "done"), 600)' ${markerFile}`,
            },
          ],
        },
      ],
    };
    agent = await Agent.create({ workdir, hooks });
    callAgent.mockResolvedValue({ content: "finished", finish_reason: "stop" });

    await agent.sendMessage("wrap up");

    // The turn returned before the 600ms async hook finished.
    expect(fs.existsSync(markerFile)).toBe(false);

    // The async hook completes in the background afterwards.
    const start = Date.now();
    while (!fs.existsSync(markerFile) && Date.now() - start < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(fs.existsSync(markerFile)).toBe(true);
  });
});

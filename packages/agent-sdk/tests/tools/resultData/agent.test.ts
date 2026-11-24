import path from "path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { agentTool } from "../../../src/tools/agentTool.js";
import {
  AGENT_NO_OUTPUT_MARKER,
  renderAgentResultData,
  type AgentResultData,
} from "../../../src/tools/resultData/agent.js";
import { TaskManager } from "../../../src/services/taskManager.js";
import {
  SubagentManager,
  type SubagentInstance,
} from "../../../src/managers/subagentManager.js";
import type { BackgroundTaskManager } from "../../../src/managers/backgroundTaskManager.js";
import type { ToolManager } from "../../../src/managers/toolManager.js";
import type { IForegroundTaskManager } from "../../../src/types/processes.js";
import type { SubagentConfiguration } from "../../../src/utils/subagentParser.js";
import type { ToolContext, ToolResult } from "../../../src/tools/types.js";
import { Container } from "../../../src/utils/container.js";

vi.mock("../../../src/managers/subagentManager.js");

/**
 * Golden 断言（issue #3055 阶段 1）：`Agent` 的 `data` 经它自己的渲染器还原出来的
 * 文本，必须与工具当场产出的 `content` 逐字相等。期望值全部手写、不从 `content`
 * 抄——抄一遍只能证明两边用了同一个渲染器。
 *
 * 同步分支的正文是子代理报告（可能几十 KB），它在 `data.content` 里（与 CC 的
 * `data.content` 同名同义）：阶段 2 起它是正文唯一的来源，所以这里断的是整段文本
 * ——报告 + 尾部——由 `data` 重建后逐字相等。
 */

const OUTPUT_FILE = path.join(path.resolve("/tmp"), "task_12345.log");
const BG_OUTPUT_FILE = path.join(path.resolve("/tmp"), "task_bg.log");

const gpConfig: SubagentConfiguration = {
  name: "general-purpose",
  description: "General-purpose agent",
  systemPrompt: "You are an agent...",
  model: "fastModel",
  filePath: "<builtin:general-purpose>",
  scope: "builtin",
  priority: 3,
};

/** 一次性内置代理：CC 为它们跳过尾部（`AgentTool/constants.ts:9-12`）。 */
const exploreConfig: SubagentConfiguration = {
  ...gpConfig,
  name: "Explore",
  filePath: "<builtin:Explore>",
};

let manager: SubagentManager;

/** 报告正文里的那句话；它就在 `data.content` 里。 */
const REPORT = "I found 3 files.";

const instance = (over: Record<string, unknown> = {}): SubagentInstance =>
  ({
    subagentId: "gp-test-id",
    usedTools: [],
    messageManager: {
      getMessages: vi.fn(() => [
        { blocks: [{ type: "tool" }, { type: "tool" }] },
        { blocks: [{ type: "tool" }] },
      ]),
      getLatestTotalTokens: vi.fn(() => 1234),
    },
    ...over,
  }) as unknown as SubagentInstance;

/** 一个工具都没调、一个 token 都没花的实例。 */
const emptyInstance = (): SubagentInstance =>
  instance({
    messageManager: {
      getMessages: vi.fn(() => []),
      getLatestTotalTokens: vi.fn(() => 0),
    },
  });

const backgroundTasks = (
  id: string,
  outputFile: string,
): BackgroundTaskManager =>
  ({
    getTask: vi.fn((taskId: string) =>
      taskId === id ? { id, outputPath: outputFile } : undefined,
    ),
  }) as unknown as BackgroundTaskManager;

const context = (over: Partial<ToolContext> = {}): ToolContext => ({
  abortSignal: new AbortController().signal,
  workdir: path.resolve("/test/workdir"),
  taskManager: new TaskManager(new Container(), "test-session"),
  subagentManager: manager,
  ...over,
});

/** 渲染 `data` 并断言它逐字等于工具给的 `content`。 */
const expectRendersBack = (result: ToolResult) => {
  expect(renderAgentResultData(result.data as AgentResultData)).toBe(
    result.content,
  );
};

/** 耗时是唯一不确定的字段，断言前统一冻结。 */
const freezeDuration = (text: string) =>
  text.replace(/duration_ms: \d+/, "duration_ms: <n>");

describe("Agent data → 文本渲染器 golden", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    manager = {
      getConfigurations: vi.fn(() => [gpConfig]),
      findSubagent: vi.fn(),
      createInstance: vi.fn(),
      executeAgent: vi.fn(),
      backgroundInstance: vi.fn(),
      cleanupInstance: vi.fn(),
    } as unknown as SubagentManager;
  });

  describe("后台启动（async_launched）", () => {
    const launchInBackground = () =>
      agentTool.execute(
        {
          description: "Background task",
          prompt: "Do something in background",
          subagent_type: "general-purpose",
          run_in_background: true,
        },
        context({
          backgroundTaskManager: backgroundTasks("task_12345", OUTPUT_FILE),
        }),
      );

    beforeEach(() => {
      vi.mocked(manager.findSubagent).mockResolvedValue(gpConfig);
      vi.mocked(manager.createInstance).mockResolvedValue(instance());
      vi.mocked(manager.executeAgent).mockResolvedValue("task_12345");
    });

    it("调用方没有 Read/Bash 时只说「别重复干活」，不给 output_file", async () => {
      const result = await launchInBackground();

      expect(result.data).toEqual({
        status: "async_launched",
        agentId: "task_12345",
        description: "Background task",
        outputFile: OUTPUT_FILE,
        canReadOutputFile: false,
      });
      expect(result.content).toBe(
        [
          "Async agent launched successfully.",
          "agentId: task_12345 (internal ID - do not mention to user.)",
          "The agent is working in the background. You will be notified automatically when it completes.",
          "Briefly tell the user what you launched and end your response. Do not generate any other text — agent results will arrive in a subsequent message.",
        ].join("\n"),
      );
      expectRendersBack(result);
    });

    it("调用方有 Read 时给出 output_file 与「用 Read/Bash 看进度」", async () => {
      const toolManager = {
        list: () => [{ name: "Read" }],
      } as unknown as ToolManager;

      const result = await agentTool.execute(
        {
          description: "Background task",
          prompt: "Do something in background",
          subagent_type: "general-purpose",
          run_in_background: true,
        },
        context({
          backgroundTaskManager: backgroundTasks("task_12345", OUTPUT_FILE),
          toolManager,
        }),
      );

      expect(result.data).toMatchObject({ canReadOutputFile: true });
      expect(result.content).toBe(
        [
          "Async agent launched successfully.",
          "agentId: task_12345 (internal ID - do not mention to user.)",
          "The agent is working in the background. You will be notified automatically when it completes.",
          "Do not duplicate this agent's work — avoid working with the same files or topics it is using. Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
          `output_file: ${OUTPUT_FILE}`,
          "If asked, you can check progress before completion by using Read or Bash tail on the output file.",
        ].join("\n"),
      );
      expectRendersBack(result);
    });

    it("用户把前台运行转后台：同一份异步 data，id 换成后台 task", async () => {
      let backgroundHandler: (() => Promise<void>) | undefined;
      const foregroundTaskManager = {
        registerForegroundTask: (task: {
          backgroundHandler: () => Promise<void>;
        }) => {
          backgroundHandler = task.backgroundHandler;
        },
        unregisterForegroundTask: () => {},
      } as unknown as IForegroundTaskManager;

      vi.mocked(manager.backgroundInstance).mockResolvedValue("task_bg");
      vi.mocked(manager.executeAgent).mockImplementation(async () => {
        await backgroundHandler!();
        return "done";
      });

      const result = await agentTool.execute(
        {
          description: "Foreground task",
          prompt: "Do something",
          subagent_type: "general-purpose",
        },
        context({
          foregroundTaskManager,
          backgroundTaskManager: backgroundTasks("task_bg", BG_OUTPUT_FILE),
          toolManager: {
            list: () => [{ name: "Bash" }],
          } as unknown as ToolManager,
        }),
      );

      expect(result.backgroundedByUser).toBe(true);
      expect(result.backgroundTaskId).toBe("task_bg");
      expect(result.data).toEqual({
        status: "async_launched",
        agentId: "task_bg",
        description: "Foreground task",
        outputFile: BG_OUTPUT_FILE,
        canReadOutputFile: true,
      });
      expect(result.content).toBe(
        [
          "Async agent launched successfully.",
          "agentId: task_bg (internal ID - do not mention to user.)",
          "The agent is working in the background. You will be notified automatically when it completes.",
          "Do not duplicate this agent's work — avoid working with the same files or topics it is using. Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
          `output_file: ${BG_OUTPUT_FILE}`,
          "If asked, you can check progress before completion by using Read or Bash tail on the output file.",
        ].join("\n"),
      );
      expectRendersBack(result);
    });
  });

  describe("同步完成（completed）", () => {
    const runSync = (config: SubagentConfiguration, report: string) => {
      vi.mocked(manager.findSubagent).mockResolvedValue(config);
      vi.mocked(manager.createInstance).mockResolvedValue(instance());
      vi.mocked(manager.executeAgent).mockResolvedValue(report);
      return agentTool.execute(
        {
          description: "Test task",
          prompt: "Test prompt",
          subagent_type: config.name,
        },
        context(),
      );
    };

    it("正文原样在前，尾部是 agentId + usage", async () => {
      const result = await runSync(gpConfig, REPORT);

      expect(result.data).toEqual({
        status: "completed",
        agentId: "gp-test-id",
        agentType: "general-purpose",
        totalToolUseCount: 3,
        totalDurationMs: expect.any(Number),
        totalTokens: 1234,
        // 子代理报告的全文（CC 的 `data.content`，那边是 text block 数组）。
        content: REPORT,
      });
      expect(freezeDuration(result.content)).toBe(
        [
          REPORT,
          "agentId: gp-test-id",
          "<usage>total_tokens: 1234",
          "tool_uses: 3",
          "duration_ms: <n></usage>",
        ].join("\n"),
      );
      // 渲染器从 `data` 重建整段：报告在上、尾部在下，与 `content` 逐字相等。
      const rendered = renderAgentResultData(result.data as AgentResultData);
      expect(freezeDuration(rendered)).toBe(freezeDuration(result.content));
    });

    it("子代理一个字都没回时补 CC 的 no-output 标记", async () => {
      const result = await runSync(gpConfig, "");

      expect(result.data).toEqual({
        status: "completed",
        agentId: "gp-test-id",
        agentType: "general-purpose",
        totalToolUseCount: 3,
        totalDurationMs: expect.any(Number),
        totalTokens: 1234,
        // 一个字都没回：`data.content` 是空串，标记由渲染器补。
        content: "",
      });
      expect(freezeDuration(result.content)).toBe(
        [
          "(Subagent completed but returned no output.)",
          "agentId: gp-test-id",
          "<usage>total_tokens: 1234",
          "tool_uses: 3",
          "duration_ms: <n></usage>",
        ].join("\n"),
      );
      // 这句是 CC 的原文（`AgentTool.tsx:1347-1350`），不是随手写的占位。
      expect(AGENT_NO_OUTPUT_MARKER).toBe(
        "(Subagent completed but returned no output.)",
      );
    });

    it("一次性内置代理（Explore）整段跳过尾部", async () => {
      const result = await runSync(exploreConfig, REPORT);

      expect(result.content).toBe(REPORT);
      // 尾部整段跳过，所以 `data` 重建出来的就是报告本身。
      expect(renderAgentResultData(result.data as AgentResultData)).toBe(
        REPORT,
      );
    });
  });

  describe("失败分支不带 data", () => {
    it("子代理什么都没产出：失败，错误文本走 content 与 error", async () => {
      vi.mocked(manager.findSubagent).mockResolvedValue(gpConfig);
      vi.mocked(manager.createInstance).mockResolvedValue(emptyInstance());
      vi.mocked(manager.executeAgent).mockRejectedValue(
        new Error("429 Too Many Requests"),
      );

      const result = await agentTool.execute(
        {
          description: "Test",
          prompt: "Test",
          subagent_type: "general-purpose",
        },
        context(),
      );

      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.content).toBe(
        "Agent delegation failed: 429 Too Many Requests",
      );
      expect(result.error).toBe(
        "Agent delegation failed: 429 Too Many Requests",
      );
    });

    it("中途被取消：失败，不把半截产出当结果", async () => {
      const controller = new AbortController();
      controller.abort();
      vi.mocked(manager.findSubagent).mockResolvedValue(gpConfig);
      vi.mocked(manager.createInstance).mockResolvedValue(instance());
      vi.mocked(manager.executeAgent).mockRejectedValue(
        new Error("Agent was aborted"),
      );

      const result = await agentTool.execute(
        {
          description: "Test",
          prompt: "Test",
          subagent_type: "general-purpose",
        },
        context({ abortSignal: controller.signal }),
      );

      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.content).toBe("");
      expect(result.error).toBe("Agent was aborted");
    });
  });
});

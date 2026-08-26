import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import {
  ASK_USER_QUESTION_TOOL_NAME,
  type Message,
  type Task,
} from "wave-agent-sdk";
import {
  screenshotWebp,
  elementScreenshotWebp,
} from "../e2e/utils/screenshot.js";

test.describe("SDD Workflow Iterate Screenshots", () => {
  test("capture iterating-an-existing-spec stages with mock data", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 400, height: 800 });

    await injector.simulateExtensionMessage("setInitialState", {
      messages: [],
      isStreaming: false,
      sessions: [],
      configurationData: {
        apiKey: "sk-ant-api03-CXB9pH2k...mH8wQz",
        baseURL: "https://api.anthropic.com/v1",
        model: "claude-sonnet-4-20250514",
        fastModel: "claude-haiku-4-20250514",
      },
      permissionMode: "default",
    });

    // ---- Stage 1: updating the existing spec ----
    const userMessage: Message = {
      id: "msg_sdd_iterate_user",
      role: "user",
      timestamp: "2025-07-10T10:00:00.000Z",
      blocks: [
        {
          type: "text",
          content:
            "我们已有客户管理系统（CRM）的规格说明 `docs/specs/crm/customer-management.md`（4 个用户故事、12 个验收场景）。现在想新增一个客户自动分级的功能：根据跟进频率和合同金额自动计算客户等级；另外把客户档案的标签从手动维护改成根据行为自动生成。",
        },
      ],
    };
    const specUpdateReply: Message = {
      id: "msg_sdd_iterate_spec",
      role: "assistant",
      timestamp: "2025-07-10T10:00:02.000Z",
      blocks: [
        {
          type: "text",
          content:
            "好的，我更新既有规格 `docs/specs/crm/customer-management.md`。\n\n**本次变更：**\n- 新增用户故事：客户自动分级（按跟进频率、合同金额自动计算客户等级）\n- 修改用户故事：客户档案标签由手动维护改为行为自动生成\n\n更新后共 5 个用户故事、15 个验收场景，稍后请你确认。",
        },
      ],
    };
    await injector.updateMessages([userMessage, specUpdateReply]);

    // 任务列表：规格更新进行中
    await injector.simulateExtensionMessage("updateTasks", {
      tasks: [
        {
          id: "1",
          subject: "更新功能规格",
          description:
            "更新客户管理系统的功能规格说明（新增客户自动分级、调整标签规则）",
          status: "in_progress",
          blocks: [],
          blockedBy: [],
          metadata: {},
        },
      ],
    });
    await expect(webviewPage.getByTestId("task-list")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-sdd-iterate-update.webp",
    );

    // ---- Stage 2: spec confirmation via AskUserQuestion ----
    const confirmMsg: Message = {
      id: "msg_sdd_iterate_confirm",
      role: "assistant",
      timestamp: "2025-07-10T10:00:05.000Z",
      blocks: [
        {
          type: "tool",
          name: ASK_USER_QUESTION_TOOL_NAME,
          stage: "running",
          parameters: JSON.stringify({
            questions: [
              {
                header: "规格确认",
                question:
                  "已更新《客户管理系统》规格：新增「客户自动分级」用户故事、修改「标签自动生成」描述（现共 5 个用户故事、15 个验收场景），是否确认？",
                options: [
                  {
                    label: "确认通过",
                    description: "规格确认通过，按更新后的规格继续",
                  },
                  {
                    label: "需要修改",
                    description: "按你的反馈更新规格后重新确认",
                  },
                ],
              },
            ],
          }),
        },
      ],
    };
    await injector.updateMessages([userMessage, specUpdateReply, confirmMsg]);
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "sdd-iterate-confirm",
      toolName: ASK_USER_QUESTION_TOOL_NAME,
      confirmationType: "问题待回答",
      toolInput: {
        questions: [
          {
            header: "规格确认",
            question:
              "已更新《客户管理系统》规格：新增「客户自动分级」用户故事、修改「标签自动生成」描述（现共 5 个用户故事、15 个验收场景），是否确认？",
            options: [
              {
                label: "确认通过",
                description: "规格确认通过，按更新后的规格继续",
              },
              {
                label: "需要修改",
                description: "按你的反馈更新规格后重新确认",
              },
            ],
          },
        ],
      },
    });
    const specDialog = webviewPage.locator(".confirmation-dialog");
    await specDialog.waitFor({ state: "visible" });
    await elementScreenshotWebp(
      specDialog,
      "../../docs/public/screenshots/spec-sdd-iterate-confirm.webp",
    );
    await webviewPage.keyboard.press("Escape");
    await specDialog.waitFor({ state: "detached" });

    // ---- Stage 3: re-enter implementation after confirmation ----
    const confirmUserMessage: Message = {
      id: "msg_sdd_iterate_confirm_user",
      role: "user",
      timestamp: "2025-07-10T10:00:08.000Z",
      blocks: [
        {
          type: "text",
          content: "确认通过，开始实现吧。",
        },
      ],
    };
    const codingReply: Message = {
      id: "msg_sdd_iterate_coding",
      role: "assistant",
      timestamp: "2025-07-10T10:00:20.000Z",
      blocks: [
        {
          type: "text",
          content:
            "规格已确认。按更新后的规格开始实现：先做客户自动分级（等级计算规则 + 分级结果展示），再把客户档案的标签改为行为自动生成。",
        },
      ],
    };
    await injector.updateMessages([
      userMessage,
      specUpdateReply,
      confirmUserMessage,
      codingReply,
    ]);
    const stageTasks: Task[] = [
      {
        id: "1",
        subject: "更新功能规格",
        description:
          "更新客户管理系统的功能规格说明（新增客户自动分级、调整标签规则）",
        status: "completed",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
      {
        id: "2",
        subject: "实现变更",
        description: "按更新后的规格实现客户自动分级与标签自动生成",
        status: "in_progress",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
    ];
    await injector.simulateExtensionMessage("updateTasks", {
      tasks: stageTasks,
    });
    await expect(webviewPage.getByTestId("task-list")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-sdd-iterate-continue.webp",
    );
  });
});

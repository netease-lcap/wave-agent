import { describe, it, expect, vi } from "vitest";
import { askUserQuestionTool } from "@/tools/askUserQuestion.js";
import {
  renderAskUserQuestionResultData,
  type AskUserQuestionResultData,
} from "@/tools/resultData/askUserQuestion.js";
import type { ToolContext, ToolResult } from "@/tools/types.js";

/**
 * Golden 断言（issue #3055 阶段 1）：`AskUserQuestion` 的 `data` 经它自己的渲染器
 * 还原出来的文本，必须与工具当场产出的 `content` 逐字相等。
 *
 * 期望值是手写的字面量（CC `AskUserQuestionTool.tsx:224-244` 的原话），不是从
 * `content` 抄来的：抄一遍只能证明两边用了同一个渲染器，证明不了措辞没漂。
 */

const QUESTIONS = [
  {
    question: "Which layout?",
    header: "Layout",
    options: [{ label: "A" }, { label: "B" }],
  },
];

/** 用一份「宿主已经答完」的载荷跑一次工具，只关心成功分支。 */
const answerWith = async (
  payload: unknown,
  questions: unknown[] = QUESTIONS,
): Promise<ToolResult> => {
  const permissionManager = {
    createContext: vi.fn().mockReturnValue({}),
    checkPermission: vi.mocked(vi.fn()).mockResolvedValue({
      behavior: "allow",
      message: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  };
  const context = {
    permissionManager,
    permissionMode: "default",
  } as unknown as ToolContext;

  return askUserQuestionTool.execute(
    { questions } as unknown as Record<string, unknown>,
    context,
  );
};

const expectRendersBack = (result: ToolResult) => {
  expect(
    renderAskUserQuestionResultData(result.data as AskUserQuestionResultData),
  ).toBe(result.content);
};

describe("AskUserQuestion data → 文本渲染器 golden", () => {
  it('单选：一句「题面="答案"」加「可以继续了」，没有 JSON 骨架', async () => {
    const result = await answerWith({ answers: { "Which layout?": "A" } });

    expect(result.content).toBe(
      'User has answered your questions: "Which layout?"="A". You can now continue with the user\'s answers in mind.',
    );
    expect(result.data).toEqual({ answers: { "Which layout?": "A" } });
    expectRendersBack(result);
  });

  it("多选宿主发数组：并成 CC 的逗号串再渲染", async () => {
    const result = await answerWith(
      {
        answers: {
          "Which layout?": "A",
          "Which features?": ["Search", "Fetch"],
        },
      },
      [
        ...QUESTIONS,
        {
          question: "Which features?",
          header: "Features",
          multiSelect: true,
          options: [{ label: "Search" }, { label: "Fetch" }],
        },
      ],
    );

    expect(result.content).toBe(
      'User has answered your questions: "Which layout?"="A", "Which features?"="Search, Fetch". You can now continue with the user\'s answers in mind.',
    );
    expect(result.data).toEqual({
      answers: { "Which layout?": "A", "Which features?": "Search, Fetch" },
    });
    expectRendersBack(result);
  });

  it("预览题：选中项的预览与备注跟着答案一起给模型", async () => {
    const result = await answerWith({
      answers: { "Which layout?": "A" },
      annotations: {
        "Which layout?": {
          preview: "```\n+-----+\n| A   |\n+-----+\n```",
          notes: "wider columns please",
        },
      },
    });

    expect(result.content).toBe(
      'User has answered your questions: "Which layout?"="A" selected preview:\n```\n+-----+\n| A   |\n+-----+\n``` user notes: wider columns please. You can now continue with the user\'s answers in mind.',
    );
    expect(result.data).toEqual({
      answers: { "Which layout?": "A" },
      annotations: {
        "Which layout?": {
          preview: "```\n+-----+\n| A   |\n+-----+\n```",
          notes: "wider columns please",
        },
      },
    });
    expectRendersBack(result);
  });

  it("只写了备注没选选项：(notes only) 是答案原文，不是没答", async () => {
    const result = await answerWith({
      answers: { "Which layout?": "(notes only)" },
      annotations: { "Which layout?": { notes: "both look wrong" } },
    });

    expect(result.content).toBe(
      'User has answered your questions: "Which layout?"="(notes only)" user notes: both look wrong. You can now continue with the user\'s answers in mind.',
    );
    expectRendersBack(result);
  });

  it("「其他」里填的字原样是答案", async () => {
    const result = await answerWith({ answers: { "Which layout?": "C" } });

    expect(result.content).toBe(
      'User has answered your questions: "Which layout?"="C". You can now continue with the user\'s answers in mind.',
    );
    expectRendersBack(result);
  });

  it("老宿主只发答案表（没有 answers 包一层）也照样渲染", async () => {
    const result = await answerWith({ "Which layout?": "B" });

    expect(result.content).toBe(
      'User has answered your questions: "Which layout?"="B". You can now continue with the user\'s answers in mind.',
    );
    expect(result.data).toEqual({ answers: { "Which layout?": "B" } });
    expectRendersBack(result);
  });

  it("空白注解对象不出现在 data 里", async () => {
    const result = await answerWith({
      answers: { "Which layout?": "B" },
      annotations: {},
    });

    expect(result.data).toEqual({ answers: { "Which layout?": "B" } });
    expectRendersBack(result);
  });

  it("一个答案都没有时也是同一句话（CC 的 call 把 answers 当空表，不特判）", async () => {
    const result = await answerWith({});

    expect(result.content).toBe(
      "User has answered your questions: . You can now continue with the user's answers in mind.",
    );
    expect(result.data).toEqual({ answers: {} });
    expectRendersBack(result);
  });

  it("拒绝回答走失败分支：没有 content 也没有 data", async () => {
    const permissionManager = {
      createContext: vi.fn().mockReturnValue({}),
      checkPermission: vi.mocked(vi.fn()).mockResolvedValue({
        behavior: "deny",
        message: "User cancelled",
      }),
    };
    const context = {
      permissionManager,
      permissionMode: "default",
    } as unknown as ToolContext;

    const result = await askUserQuestionTool.execute(
      { questions: QUESTIONS } as unknown as Record<string, unknown>,
      context,
    );

    expect(result.success).toBe(false);
    expect(result.content).toBe("");
    expect(result.data).toBeUndefined();
    expect(result.error).toBe("User cancelled");
  });
});

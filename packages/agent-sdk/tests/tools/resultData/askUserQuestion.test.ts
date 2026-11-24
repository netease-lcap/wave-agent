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
 * 期望值是手写的字面量（CC 2.1.331 `1005-20922B-mDn.js:671` 的
 * `mapToolResultToToolResultBlockParam`），不是从 `content` 抄来的：抄一遍只能
 * 证明两边用了同一个渲染器，证明不了措辞没漂。
 */

const PREVIEW = "```\n+-----+\n| A   |\n+-----+\n```";

const QUESTIONS = [
  {
    question: "Which layout?",
    header: "Layout",
    options: [{ label: "A", preview: PREVIEW }, { label: "B" }],
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
      'Your questions have been answered: "Which layout?"="A". You can now continue with these answers in mind.',
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
      'Your questions have been answered: "Which layout?"="A", "Which features?"="Search, Fetch". You can now continue with these answers in mind.',
    );
    expect(result.data).toEqual({
      answers: { "Which layout?": "A", "Which features?": "Search, Fetch" },
    });
    expectRendersBack(result);
  });

  it("预览题：备注把外层句子切到「读仔细」档，预览与备注跟着答案走", async () => {
    const result = await answerWith({
      answers: { "Which layout?": "A" },
      annotations: {
        "Which layout?": { preview: PREVIEW, notes: "wider columns please" },
      },
    });

    expect(result.content).toBe(
      'The user answered: "Which layout?"="A" selected preview:\n' +
        PREVIEW +
        " notes: wider columns please. Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.",
    );
    expect(result.data).toEqual({
      answers: { "Which layout?": "A" },
      annotations: {
        "Which layout?": { preview: PREVIEW, notes: "wider columns please" },
      },
    });
    expectRendersBack(result);
  });

  it("预览但没备注：外层句子仍是「可以继续」档", async () => {
    const result = await answerWith({
      answers: { "Which layout?": "A" },
      annotations: { "Which layout?": { preview: PREVIEW } },
    });

    expect(result.content).toBe(
      'Your questions have been answered: "Which layout?"="A" selected preview:\n' +
        PREVIEW +
        ". You can now continue with these answers in mind.",
    );
    expectRendersBack(result);
  });

  it("只写了备注没选选项：哨兵渲染成 (no option selected)，(notes only) 不进文本", async () => {
    const result = await answerWith({
      answers: { "Which layout?": "(notes only)" },
      annotations: { "Which layout?": { notes: "both look wrong" } },
    });

    expect(result.content).toBe(
      'The user answered: "Which layout?"=(no option selected) notes: both look wrong. Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.',
    );
    expect(result.content).not.toContain("(notes only)");
    expect(result.data).toEqual({
      answers: { "Which layout?": "(notes only)" },
      annotations: { "Which layout?": { notes: "both look wrong" } },
    });
    expectRendersBack(result);
  });

  it("answers 里连 key 都没有、只有备注：那一题照样出现", async () => {
    const result = await answerWith({
      answers: {},
      annotations: { "Which layout?": { notes: "nothing fits" } },
    });

    expect(result.content).toBe(
      'The user answered: "Which layout?"=(no option selected) notes: nothing fits. Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.',
    );
    expectRendersBack(result);
  });

  it("「其他」里填的自定义答案：原样是答案，且换到「读仔细」档", async () => {
    const result = await answerWith({ answers: { "Which layout?": "C" } });

    expect(result.content).toBe(
      'The user answered: "Which layout?"="C". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.',
    );
    expect(result.data).toEqual({
      answers: { "Which layout?": "C" },
      readCarefully: true,
    });
    expectRendersBack(result);
  });

  it("renderer 只认 data：手写 readCarefully 一样进「读仔细」档", () => {
    expect(
      renderAskUserQuestionResultData({
        answers: { "Which layout?": "A" },
        readCarefully: true,
      }),
    ).toBe(
      'The user answered: "Which layout?"="A". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.',
    );
  });

  it("老宿主只发答案表（没有 answers 包一层）也照样渲染", async () => {
    const result = await answerWith({ "Which layout?": "B" });

    expect(result.content).toBe(
      'Your questions have been answered: "Which layout?"="B". You can now continue with these answers in mind.',
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

  it("一个答案都没有：直说用户没回答（CC 2.1.331 的最后一档）", async () => {
    const result = await answerWith({});

    expect(result.content).toBe("The user did not answer the questions.");
    expect(result.data).toEqual({ answers: {} });
    expectRendersBack(result);
  });

  it("空串答案按没答处理：整条不出现", async () => {
    const result = await answerWith({ answers: { "Which layout?": "" } });

    expect(result.content).toBe("The user did not answer the questions.");
    expect(result.data).toEqual({ answers: { "Which layout?": "" } });
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

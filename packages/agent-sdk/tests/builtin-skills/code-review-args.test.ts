import { describe, it, expect } from "vitest";
import { parseCodeReviewArgs } from "../../src/builtin/skills/code-review.js";
import {
  BUILTIN_CONTENT,
  BUILTIN_SKILL_HOOKS,
} from "../../src/builtin/index.js";

// `/code-review` 是第一个接上内置技能代码钩子的技能：档位 / 目标 / flag 在代码里
// 解析，不再指望模型从一段散文里自己猜。这些断言钉的是 Claude Code 的 `Oe()`
// 语义（2.1.332 反查得出），不是文案：
// - `--fix` / `--comment` 是唯一被剥掉的 flag，其余留在目标里；
// - 第一个位置参数是档位槽，形似档位但认不出时只加一句提示、不报错；
// - 档位之后的位置参数原样拼成目标。
describe("parseCodeReviewArgs", () => {
  it("defaults to medium when no level is given", () => {
    const { args } = parseCodeReviewArgs("");
    expect(args.level).toBe("medium");
    expect(args.levelIsDefault).toBe(true);
    expect(args.target).toBeUndefined();
    expect(args.warning).toBeUndefined();
  });

  it.each(["low", "medium", "high", "max"] as const)(
    "reads %s as the tier",
    (level) => {
      const { args } = parseCodeReviewArgs(level);
      expect(args.level).toBe(level);
      expect(args.levelIsDefault).toBe(false);
    },
  );

  it("keeps the target after the level", () => {
    const { args } = parseCodeReviewArgs("high 1234");
    expect(args.level).toBe("high");
    expect(args.target).toBe("1234");
  });

  it("reads a lone target as the target, not as a broken level", () => {
    const { args } = parseCodeReviewArgs("feat/login");
    expect(args.level).toBe("medium");
    expect(args.target).toBe("feat/login");
    expect(args.warning).toBeUndefined();
  });

  it("strips the PR-number hash the way Claude Code does", () => {
    expect(parseCodeReviewArgs("#1234").args.target).toBe("1234");
  });

  it("reads --fix and --comment wherever they sit", () => {
    const { args } = parseCodeReviewArgs("--fix high --comment 42");
    expect(args.level).toBe("high");
    expect(args.target).toBe("42");
    expect(args.fix).toBe(true);
    expect(args.comment).toBe(true);
  });

  it("degrades into a level warning instead of an error", () => {
    // "loww" 形似档位（Claude Code 的 ki 正则）但不是一个档位
    const { args } = parseCodeReviewArgs("loww");
    expect(args.level).toBe("medium");
    expect(args.levelIsDefault).toBe(true);
    expect(args.warning).toContain("loww");
    expect(args.warning).toContain("high");
    // Claude Code 的 pt(P) 会把写错的档位留在目标里，这里照做
    expect(args.target).toBe("loww");
  });

  it("treats a dropped tier name as a level warning too", () => {
    const { args } = parseCodeReviewArgs("ultra");
    expect(args.level).toBe("medium");
    expect(args.warning).toContain("ultra");
  });

  it("leaves an unknown flag inside the target, as Claude Code does", () => {
    const { args } = parseCodeReviewArgs("--nope");
    expect(args.target).toBe("--nope");
    expect(args.fix).toBe(false);
    expect(args.comment).toBe(false);
  });

  it("joins several targets into one string", () => {
    expect(parseCodeReviewArgs("123 456").args.target).toBe("123 456");
  });

  it("keeps a quoted path as one target", () => {
    expect(parseCodeReviewArgs('"packages/a b"').args.target).toBe(
      "packages/a b",
    );
  });

  it("hands the model the parsed result, so it need not re-read the prose", () => {
    const summary = parseCodeReviewArgs("high --fix 42").summary;
    expect(summary).toContain("high");
    expect(summary).toContain("42");
    expect(summary).toContain("--fix");
  });

  it("marks an implied level as the default in the summary", () => {
    expect(parseCodeReviewArgs("").summary).toContain("default");
  });

  it("carries the warning into the summary", () => {
    expect(parseCodeReviewArgs("loww").summary).toContain("loww");
  });

  // 钩子是按技能名查的，而技能名来自 SKILL.md 的 frontmatter —— 两处一旦对不上，
  // 解析结果会静默地不再注入。改名就该红。
  it("is registered under the name the skill's frontmatter declares", () => {
    const body = BUILTIN_CONTENT["skills/code-review/SKILL.md"];
    expect(body).toContain("\nname: code-review\n");
    expect(BUILTIN_SKILL_HOOKS["code-review"]?.describeArgs).toBeDefined();
  });

  // 正文必须指向注入的解析结果，否则「自己再解析一遍 $ARGUMENTS」这句话会和它对打。
  it("tells the model to read the parsed block, not re-parse", () => {
    const body = BUILTIN_CONTENT["skills/code-review/SKILL.md"];
    expect(body).toContain("read `## Arguments`");
    expect(body).not.toContain("Parse `$ARGUMENTS`");
  });
});

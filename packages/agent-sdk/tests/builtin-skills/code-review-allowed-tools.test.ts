import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import { Container } from "../../src/utils/container.js";
import { code_reviewSkill } from "../../src/builtin/skills/code-review.js";
import type { ConfigurationService } from "../../src/services/configurationService.js";
import type { PermissionCallback } from "../../src/types/permissions.js";
import { BASH_TOOL_NAME } from "../../src/constants/tools.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const WORKDIR = path.resolve("/fake/project");

/** 技能自己声明的规则，就是这份 SKILL.md 里那一行——断言的正是它真的能放行。 */
function skillRules(): string[] {
  const body = code_reviewSkill["skills/code-review/SKILL.md"];
  const line = body.split("\n").find((l) => l.startsWith("allowed-tools:"));
  if (!line) throw new Error("allowed-tools line missing");
  return line
    .replace("allowed-tools:", "")
    .split(",")
    .map((rule) => rule.trim())
    .filter(Boolean);
}

function check(command: string) {
  const container = new Container();
  container.register("CurrentWorkdir", WORKDIR);
  container.register("ConfigurationService", {
    getCurrentConfiguration: () => ({ sandbox: {} }),
  } as unknown as ConfigurationService);
  const manager = new PermissionManager(container, {
    allowedRules: skillRules(),
  });
  const ask = vi.fn().mockResolvedValue({ behavior: "allow" });
  const decision = manager.checkPermission(
    manager.createContext(
      BASH_TOOL_NAME,
      "default",
      ask as unknown as PermissionCallback,
      { command, workdir: WORKDIR },
    ),
  );
  return { decision, ask };
}

describe("/code-review allowed tools", () => {
  it("pre-authorizes reading a PR/MR diff", async () => {
    for (const command of [
      "gh pr diff 12",
      "gh pr diff 9 -R o/r",
      "gh api repos/o/r/pulls/9 -H 'Accept: application/vnd.github.diff'",
      "glab mr diff 7",
    ]) {
      const { decision, ask } = check(command);
      await expect(decision).resolves.toMatchObject({ behavior: "allow" });
      expect(ask, command).not.toHaveBeenCalled();
    }
  });

  it("pre-authorizes posting the review back", async () => {
    for (const command of [
      "gh api repos/o/r/pulls/9/comments -f body=x -f path=a.ts -f line=3",
      'glab mr note 7 -m "body"',
    ]) {
      const { decision, ask } = check(command);
      await expect(decision).resolves.toMatchObject({ behavior: "allow" });
      expect(ask, command).not.toHaveBeenCalled();
    }
  });

  it("does not turn the whole gh api into a write channel", async () => {
    const { decision, ask } = check(
      "gh api repos/o/r/issues/1 -X POST -f title=x",
    );
    // 回调被问到 ⇒ 规则没覆盖它；答案允许只是为了看清「问过」这件事
    await expect(decision).resolves.toMatchObject({ behavior: "allow" });
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

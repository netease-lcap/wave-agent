import { describe, it, expect } from "vitest";
import {
  buildCodeReviewPrompt,
  code_reviewSkill,
  resolveReviewTarget,
} from "../../src/builtin/skills/code-review.js";
import type { SkillPromptContext } from "../../src/builtin/skillHooks.js";
import { AGENT_TOOL_NAME } from "../../src/constants/tools.js";

const WITH_AGENT = {
  toolNames: [AGENT_TOOL_NAME, "Read"],
  availableSkills: [],
  gitRemoteUrl: null,
};
// 远端托管方决定裸数字是 PR 还是 MR、`--comment` 走哪一段。
const GITLAB_REMOTE = {
  ...WITH_AGENT,
  gitRemoteUrl: "git@gitlab.com:group/proj.git",
};
const BITBUCKET_REMOTE = {
  ...WITH_AGENT,
  gitRemoteUrl: "https://bitbucket.org/team/repo.git",
};

function prompt(raw: string, ctx: SkillPromptContext = WITH_AGENT): string {
  return buildCodeReviewPrompt(raw, ctx);
}

describe("resolveReviewTarget", () => {
  it("takes a bare number as a GitHub pull request", () => {
    expect(resolveReviewTarget("12")).toEqual({
      platform: "github",
      name: "GitHub pull request 12",
      command: "gh pr diff 12",
      // CC 的 Mo("{owner}/{repo}", n)：花括号原样交给模型，照着远端填
      fallback:
        "gh api repos/{owner}/{repo}/pulls/12 -H 'Accept: application/vnd.github.diff'",
      crossRepo: false,
    });
  });

  it("reads the repository out of a GitHub pull request URL", () => {
    expect(resolveReviewTarget("https://github.com/o/r/pull/9")).toEqual({
      platform: "github",
      name: "GitHub pull request https://github.com/o/r/pull/9",
      command: "gh pr diff 9 -R o/r",
      fallback:
        "gh api repos/o/r/pulls/9 -H 'Accept: application/vnd.github.diff'",
      crossRepo: true,
    });
  });

  // CC 的 `gi()`（`1091-228433B-Vdr.js:2015-2021`）：认不出是 github.com 时整条 URL
  // 交给 gh，既不拼 `-R` 也不给 `gh api repos/…` 退路。
  it("hands a self-hosted pull URL to gh whole, with no fallback", () => {
    const target = resolveReviewTarget("https://ghe.corp/o/r/pull/9");
    expect(target).toEqual({
      platform: "github",
      name: "GitHub pull request https://ghe.corp/o/r/pull/9",
      command: "gh pr diff https://ghe.corp/o/r/pull/9",
      crossRepo: true,
    });
  });

  it("still knows github.com when the URL carries a port", () => {
    expect(resolveReviewTarget("https://github.com:443/o/r/pull/9")).toEqual({
      platform: "github",
      name: "GitHub pull request https://github.com:443/o/r/pull/9",
      command: "gh pr diff 9 -R o/r",
      fallback:
        "gh api repos/o/r/pulls/9 -H 'Accept: application/vnd.github.diff'",
      crossRepo: true,
    });
  });

  // CC 的路径段字符类（`0215-6730B-aX.js:17`）挡掉 `.` 与 `..`：这类 URL 不是真链接。
  it("rejects a URL whose path segments are dot directories", () => {
    expect(
      resolveReviewTarget("https://github.com/o/../pull/9"),
    ).toBeUndefined();
    expect(
      resolveReviewTarget("https://github.com/./r/pull/9"),
    ).toBeUndefined();
  });

  it("takes !N as a GitLab merge request", () => {
    expect(resolveReviewTarget("!7")).toEqual({
      platform: "gitlab",
      name: "GitLab merge request !7",
      command: "glab mr diff 7",
    });
  });

  // CC 的 `gi()`（`1091-228433B-Vdr.js:1989`）：裸形态 1-6 位，URL 里的 iid 才 9 位。
  it("keeps the bare !N form to six digits", () => {
    expect(resolveReviewTarget("!123456")?.platform).toBe("gitlab");
    expect(resolveReviewTarget("!1234567")).toBeUndefined();
  });

  it("reads the project out of a GitLab merge request URL", () => {
    expect(
      resolveReviewTarget(
        "https://gitlab.example.com/group/sub/proj/-/merge_requests/4",
      ),
    ).toEqual({
      platform: "gitlab",
      name: "GitLab merge request group/sub/proj!4",
      command: "glab mr diff 4 -R group/sub/proj",
    });
  });

  // CC 的 `Uka()`（`0215-6730B-aX.js:206`）：裸数字看不出平台时按远端托管方判。
  it("reads a bare number as a merge request on a GitLab remote", () => {
    expect(resolveReviewTarget("12", "gitlab")).toEqual({
      platform: "gitlab",
      name: "GitLab merge request !12",
      command: "glab mr diff 12",
    });
    // 显式写了 `!12` 的当然还是 MR，与远端无关
    expect(resolveReviewTarget("!12", "github")?.platform).toBe("gitlab");
  });

  // CC 的 `gi()`（`1091-228433B-Vdr.js:1998`）：Bitbucket 上没有 gh 也没有 glab，
  // 裸数字不注入目标，让模型照常评审当前分支。
  it("injects nothing for a bare number on a Bitbucket remote", () => {
    expect(resolveReviewTarget("12", "bitbucket")).toBeUndefined();
    expect(buildCodeReviewPrompt("12", BITBUCKET_REMOTE)).not.toContain(
      "## Review target",
    );
  });

  it("leaves branch names, paths and unknown flags alone", () => {
    for (const target of ["my-branch", "src/index.ts", "--nope", ""]) {
      expect(resolveReviewTarget(target)).toBeUndefined();
    }
  });
});

describe("/code-review review target", () => {
  it("says which diff is in scope and which command reads it", () => {
    const body = prompt("12");
    expect(body).toContain("## Review target");
    expect(body).toContain("gh pr diff 12");
    expect(body).toContain("It replaces every `git diff` command");
  });

  it("offers the gh api fallback for GitHub only", () => {
    expect(prompt("12")).toContain("gh api repos/{owner}/{repo}/pulls/12");
    expect(prompt("!7")).not.toContain("gh api repos/");
    // 自建实例连 `pr diff` 的退路都没有：那段话只在有 withoutPrDiff 时出现
    const ghes = prompt("https://ghe.corp/o/r/pull/9");
    expect(ghes).toContain("gh pr diff https://ghe.corp/o/r/pull/9");
    expect(ghes).not.toContain("Some sessions have a gh with no");
  });

  it("says nothing about a target it cannot resolve", () => {
    expect(prompt("my-branch")).not.toContain("## Review target");
  });

  it("stops instead of falling back to the checkout when a fix is at stake", () => {
    expect(prompt("12")).toContain("which may not be that pull request");
    expect(prompt("--fix 12")).toContain("so nothing was reviewed");
    // 跨仓库 URL 也一样：这段改动可能根本不在这份检出里
    expect(prompt("https://github.com/o/r/pull/9")).toContain(
      "or of another repository",
    );
    expect(prompt("https://github.com/o/r/pull/9")).toContain(
      "so nothing was reviewed",
    );
  });
});

describe("/code-review --comment", () => {
  it("posts inline comments through gh api on GitHub", () => {
    const body = prompt("--comment");
    expect(body).toContain("## Posting to GitHub (--comment)");
    expect(body).toContain("gh api repos/{owner}/{repo}/pulls/{pr}/comments");
  });

  it("posts one MR note on GitLab instead", () => {
    const body = prompt("--comment !7");
    expect(body).toContain("## Posting to GitLab (--comment)");
    expect(body).toContain('glab mr note 7 -m "<body>"');
    expect(body).not.toContain("## Posting to GitHub");
  });

  // CC 的 `Uka()`：没给目标串时看远端 —— GitLab 仓库里默认评审的会是个 MR。
  it("picks the GitLab wording from the remote alone", () => {
    const body = prompt("--comment", GITLAB_REMOTE);
    expect(body).toContain("## Posting to GitLab (--comment)");
    // 没有目标串就没得填 ref，命令得仍然能读
    expect(body).toContain('glab mr note -m "<body>"');
  });

  it("says nothing when --comment was not passed", () => {
    const body = prompt("12");
    expect(body).not.toContain("## Posting to");
  });
});

describe("/code-review allowed tools", () => {
  const frontmatter = code_reviewSkill["skills/code-review/SKILL.md"];

  it("pre-authorizes the commands the target and comment sections name", () => {
    for (const rule of [
      "gh pr diff*",
      "gh api repos/*/pulls/*",
      "glab mr diff*",
      "glab mr note*",
    ]) {
      expect(frontmatter).toContain(rule);
    }
  });

  it("no longer posts through prose in Phase 5", () => {
    expect(frontmatter).not.toContain("gh pr comment");
  });
});

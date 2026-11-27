import { describe, it, expect } from "vitest";
import {
  buildCodeReviewPrompt,
  code_reviewSkill,
  resolveReviewTarget,
} from "../../src/builtin/skills/code-review.js";
import { AGENT_TOOL_NAME } from "../../src/constants/tools.js";

const WITH_AGENT = {
  toolNames: [AGENT_TOOL_NAME, "Read"],
  availableSkills: [],
};

function prompt(raw: string): string {
  return buildCodeReviewPrompt(raw, WITH_AGENT);
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

  it("takes !N as a GitLab merge request", () => {
    expect(resolveReviewTarget("!7")).toEqual({
      platform: "gitlab",
      name: "GitLab merge request !7",
      command: "glab mr diff 7",
    });
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

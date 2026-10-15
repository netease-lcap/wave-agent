import { describe, it, expect } from "vitest";
import {
  detectBashActivity,
  detectMcpActivity,
} from "@/telemetry/toolActivity.js";

describe("detectBashActivity — commits", () => {
  it("should recognize a commit and the commands around it", () => {
    expect(detectBashActivity('git commit -m "feat: x"').commits).toBe(true);
    expect(detectBashActivity("git add -A && git commit -m x").commits).toBe(
      true,
    );
    expect(detectBashActivity("git commit --amend --no-edit").commits).toBe(
      true,
    );
    expect(detectBashActivity('git commit -m "chore" | tee log').commits).toBe(
      true,
    );
  });

  it("should see through the prefixes the rule matcher strips", () => {
    // Scope flags change the repository, not the subcommand.
    expect(detectBashActivity("git -C /repo commit -m x").commits).toBe(true);
    expect(detectBashActivity("git --git-dir=/repo/.git commit").commits).toBe(
      true,
    );
    // Leading env assignments are part of the command, not of the program.
    expect(
      detectBashActivity("GIT_AUTHOR_NAME=wave git commit -m x").commits,
    ).toBe(true);
    // An absolute path to the binary.
    expect(detectBashActivity("/usr/bin/git commit -m x").commits).toBe(true);
  });

  it("should not read a commit out of another git subcommand", () => {
    expect(detectBashActivity("git log --grep commit").commits).toBe(false);
    expect(detectBashActivity("git merge feature").commits).toBe(false);
    expect(detectBashActivity("git status").commits).toBe(false);
    expect(detectBashActivity("git -C /repo log").commits).toBe(false);
    expect(detectBashActivity("git").commits).toBe(false);
  });

  it("should not read a commit out of text that merely mentions one", () => {
    expect(detectBashActivity('echo "git commit -m x"').commits).toBe(false);
    expect(detectBashActivity("npm run commit").commits).toBe(false);
    expect(detectBashActivity("cat .git/COMMIT_EDITMSG").commits).toBe(false);
    expect(detectBashActivity("").commits).toBe(false);
  });
});

describe("detectBashActivity — pull requests", () => {
  it("should recognize the create forms of both CLIs", () => {
    expect(
      detectBashActivity('gh pr create --title "x" --body "y"').pullRequests,
    ).toBe(true);
    expect(detectBashActivity("glab mr create").pullRequests).toBe(true);
    expect(
      detectBashActivity("git push -u origin HEAD && gh pr create")
        .pullRequests,
    ).toBe(true);
  });

  it("should not read a pull request out of a read or update command", () => {
    expect(detectBashActivity("gh pr view 12").pullRequests).toBe(false);
    expect(detectBashActivity("gh pr list").pullRequests).toBe(false);
    expect(detectBashActivity("glab mr list").pullRequests).toBe(false);
    expect(detectBashActivity("gh run watch").pullRequests).toBe(false);
  });

  it("should keep the two counters independent", () => {
    const both = detectBashActivity("git commit -m x && gh pr create");

    expect(both).toEqual({ commits: true, pullRequests: true });

    const neither = detectBashActivity("git status");

    expect(neither).toEqual({ commits: false, pullRequests: false });
  });

  it("should count an action once however often it appears", () => {
    // One tool call is one action; the metric is a count of calls that created.
    const activity = detectBashActivity("git commit -m a && git commit -m b");

    expect(activity.commits).toBe(true);
    expect(Object.values(activity).filter((created) => created)).toHaveLength(
      1,
    );
  });
});

describe("detectMcpActivity", () => {
  it("should recognize a create tool across servers and spellings", () => {
    expect(
      detectMcpActivity("mcp__github__create_pull_request").pullRequests,
    ).toBe(true);
    expect(
      detectMcpActivity("mcp__gitlab__create_merge_request").pullRequests,
    ).toBe(true);
    expect(
      detectMcpActivity("mcp__gitlab__createMergeRequest").pullRequests,
    ).toBe(true);
    expect(
      detectMcpActivity("mcp__acme__pull_request_create").pullRequests,
    ).toBe(true);
  });

  it("should not read a pull request out of a read or update tool", () => {
    expect(
      detectMcpActivity("mcp__github__update_pull_request").pullRequests,
    ).toBe(false);
    expect(
      detectMcpActivity("mcp__github__get_pull_request").pullRequests,
    ).toBe(false);
    expect(
      detectMcpActivity("mcp__playwright__browser_click").pullRequests,
    ).toBe(false);
  });

  it("should not count another kind of create call", () => {
    // Creating something is not creating a PR — an issue or a branch is not one.
    expect(detectMcpActivity("mcp__github__create_issue").pullRequests).toBe(
      false,
    );
    expect(detectMcpActivity("mcp__gitlab__create_branch").pullRequests).toBe(
      false,
    );
  });

  it("should never report a commit, which an MCP call leaves no command for", () => {
    expect(detectMcpActivity("mcp__git__commit").commits).toBe(false);
  });
});

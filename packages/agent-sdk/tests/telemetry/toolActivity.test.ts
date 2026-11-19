import { describe, it, expect } from "vitest";
import {
  detectShellActivity,
  detectMcpActivity,
} from "@/telemetry/toolActivity.js";

describe("detectShellActivity — commits", () => {
  it("should recognize a commit and the commands around it", () => {
    expect(detectShellActivity('git commit -m "feat: x"').commits).toBe(true);
    expect(detectShellActivity("git add -A && git commit -m x").commits).toBe(
      true,
    );
    expect(detectShellActivity("git commit --amend --no-edit").commits).toBe(
      true,
    );
    expect(detectShellActivity('git commit -m "chore" | tee log').commits).toBe(
      true,
    );
  });

  it("should see through the prefixes the rule matcher strips", () => {
    // Scope flags change the repository, not the subcommand.
    expect(detectShellActivity("git -C /repo commit -m x").commits).toBe(true);
    expect(detectShellActivity("git --git-dir=/repo/.git commit").commits).toBe(
      true,
    );
    // Leading env assignments are part of the command, not of the program.
    expect(
      detectShellActivity("GIT_AUTHOR_NAME=wave git commit -m x").commits,
    ).toBe(true);
    // An absolute path to the binary.
    expect(detectShellActivity("/usr/bin/git commit -m x").commits).toBe(true);
  });

  it("should not read a commit out of another git subcommand", () => {
    expect(detectShellActivity("git log --grep commit").commits).toBe(false);
    expect(detectShellActivity("git merge feature").commits).toBe(false);
    expect(detectShellActivity("git status").commits).toBe(false);
    expect(detectShellActivity("git -C /repo log").commits).toBe(false);
    expect(detectShellActivity("git").commits).toBe(false);
  });

  it("should not read a commit out of text that merely mentions one", () => {
    expect(detectShellActivity('echo "git commit -m x"').commits).toBe(false);
    expect(detectShellActivity("npm run commit").commits).toBe(false);
    expect(detectShellActivity("cat .git/COMMIT_EDITMSG").commits).toBe(false);
    expect(detectShellActivity("").commits).toBe(false);
  });
});

describe("detectShellActivity — pull requests", () => {
  it("should recognize the create forms of both CLIs", () => {
    expect(
      detectShellActivity('gh pr create --title "x" --body "y"').pullRequests,
    ).toBe(true);
    expect(detectShellActivity("glab mr create").pullRequests).toBe(true);
    expect(
      detectShellActivity("git push -u origin HEAD && gh pr create")
        .pullRequests,
    ).toBe(true);
  });

  it("should not read a pull request out of a read or update command", () => {
    expect(detectShellActivity("gh pr view 12").pullRequests).toBe(false);
    expect(detectShellActivity("gh pr list").pullRequests).toBe(false);
    expect(detectShellActivity("glab mr list").pullRequests).toBe(false);
    expect(detectShellActivity("gh run watch").pullRequests).toBe(false);
  });

  it("should keep the two counters independent", () => {
    const both = detectShellActivity("git commit -m x && gh pr create");

    expect(both).toEqual({ commits: true, pullRequests: true });

    const neither = detectShellActivity("git status");

    expect(neither).toEqual({ commits: false, pullRequests: false });
  });

  it("should count an action once however often it appears", () => {
    // One tool call is one action; the metric is a count of calls that created.
    const activity = detectShellActivity("git commit -m a && git commit -m b");

    expect(activity.commits).toBe(true);
    expect(Object.values(activity).filter((created) => created)).toHaveLength(
      1,
    );
  });
});

describe("detectShellActivity — PowerShell command lines", () => {
  it("should recognize a commit behind the `&` call operator", () => {
    // `&` there prefixes the command (call operator), it does not chain; the
    // splitter drops the empty head and the leaf is still `git commit …`.
    expect(detectShellActivity('& git commit -m "fix: x"').commits).toBe(true);
    expect(detectShellActivity("& git commit -m x; & git push").commits).toBe(
      true,
    );
  });

  it("should recognize a commit behind `;`, `&&` and `|`", () => {
    expect(
      detectShellActivity('git add . ; git commit -m "feat" ; git push'),
    ).toEqual({ commits: true, pullRequests: false });
    expect(detectShellActivity('git add -A && git commit -m "feat"')).toEqual({
      commits: true,
      pullRequests: false,
    });
    expect(
      detectShellActivity(
        'git commit -m "feat" 2>&1 | Out-File -FilePath log.txt',
      ).commits,
    ).toBe(true);
    expect(
      detectShellActivity('git commit -m "feat" | Tee-Object log.txt').commits,
    ).toBe(true);
  });

  it("should keep an ampersand inside a quoted message out of the split", () => {
    expect(detectShellActivity('git commit -m "fix: a & b"').commits).toBe(
      true,
    );
    expect(detectShellActivity("git commit -m 'fix: a & b'").commits).toBe(
      true,
    );
    // The quoted ampersand must not survive as a second leaf, either.
    expect(
      detectShellActivity('Write-Host "x & git commit" ; git status').commits,
    ).toBe(false);
  });

  it("should see through the flags PowerShell passes to git unchanged", () => {
    expect(detectShellActivity("git -C C:\\repo commit -m x").commits).toBe(
      true,
    );
    expect(
      detectShellActivity("git --git-dir=C:\\repo\\.git commit -m x").commits,
    ).toBe(true);
  });

  it("should recognize PR/MR creation in a PowerShell session", () => {
    expect(detectShellActivity("gh pr create --fill").pullRequests).toBe(true);
    expect(detectShellActivity("glab mr create -t x").pullRequests).toBe(true);
    expect(detectShellActivity("gh pr view 12").pullRequests).toBe(false);
  });

  it("should stay silent for PowerShell commands that only look related", () => {
    // Non-git cmdlets, PowerShell's own git-wrapper helpers and `git log`.
    expect(detectShellActivity("Get-ChildItem ; git status").commits).toBe(
      false,
    );
    expect(detectShellActivity("& git log --grep commit").commits).toBe(false);
    expect(detectShellActivity("git commit-tree HEAD^{tree}").commits).toBe(
      false,
    );
  });

  it("should miss (not invent) a commit invoked through a path or variable", () => {
    // Known conservative misses, documented in the module header: the program
    // name is not `git`, so nothing is counted rather than guessed.
    expect(
      detectShellActivity(
        '& "C:\\Program Files\\Git\\bin\\git.exe" commit -m x',
      ).commits,
    ).toBe(false);
    expect(detectShellActivity("& $env:GIT_BIN commit -m x").commits).toBe(
      false,
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

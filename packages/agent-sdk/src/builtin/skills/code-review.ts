import {
  AGENT_TOOL_NAME,
  BASH_TOOL_NAME,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  READ_TOOL_NAME,
} from "../../constants/tools.js";
import { parseCommandArguments } from "../../utils/commandArgumentParser.js";
import type { BuiltinSkillHook, SkillPromptContext } from "../skillHooks.js";

export const code_reviewSkill: Record<string, string> = {
  "skills/code-review/SKILL.md": `---
name: code-review
description: "Review the current diff for correctness bugs and reuse/simplification/efficiency cleanups at the given effort level (low/medium: fewer, high-confidence findings; high/max: broader coverage, may include lower-confidence findings)"
allowed-tools: ${BASH_TOOL_NAME}(git diff*), ${BASH_TOOL_NAME}(git status*), ${BASH_TOOL_NAME}(git log*), ${BASH_TOOL_NAME}(git show*), ${BASH_TOOL_NAME}(git blame*), ${BASH_TOOL_NAME}(git remote*), ${BASH_TOOL_NAME}(git merge-base*), ${BASH_TOOL_NAME}(command -v*), ${BASH_TOOL_NAME}(gh pr view*), ${BASH_TOOL_NAME}(gh pr diff*), ${BASH_TOOL_NAME}(gh api repos/*/pulls/*), ${BASH_TOOL_NAME}(glab mr view*), ${BASH_TOOL_NAME}(glab mr diff*), ${BASH_TOOL_NAME}(glab mr note*), ${READ_TOOL_NAME}, ${GLOB_TOOL_NAME}, ${GREP_TOOL_NAME}, ${AGENT_TOOL_NAME}
disable-model-invocation: true
---

# Code Review

Review the current branch's changes for correctness bugs and quality issues.

## Phase 1: Gather Context

First, collect the diff and metadata:

\`\`\`
GIT STATUS:
!\`git status\`

FILES MODIFIED:
!\`git diff --name-only $(git merge-base HEAD main)...HEAD 2>/dev/null || git diff --name-only HEAD~1...HEAD\`

COMMITS:
!\`git log --no-decorate $(git merge-base HEAD main 2>/dev/null || echo HEAD~1)...HEAD\`

DIFF CONTENT:
!\`git diff $(git merge-base HEAD main 2>/dev/null || echo HEAD~1)...HEAD\`
\`\`\`

If there are no changes, stop and tell the user.

## Phase 2: Determine Effort Level

The parameters are already parsed for you — read \`## Arguments\` at the end of
this skill instead of re-reading \`$ARGUMENTS\`. If that block carries a
warning, tell the user in one short line as you begin.

The tiers:
- **low**: Launch 2 agents, confidence threshold 90 (only near-certain findings)
- **medium** (default): Launch 3 agents, confidence threshold 80
- **high**: Launch 4 agents, confidence threshold 70
- **max**: Launch 5 agents, confidence threshold 60 (broader coverage, more noise)

## Phase 3: Launch Review Agents in Parallel

Use the ${AGENT_TOOL_NAME} tool to launch all agents concurrently in a single message. Pass each agent the full diff so it has the complete context.

### Agent 1: Bug Scanner (all effort levels)

Read the file changes in the diff, then do a shallow scan for obvious bugs. Avoid reading extra context beyond the changes, focusing just on the changes themselves. Focus on large bugs, and avoid small issues and nitpicks. Ignore likely false positives.

### Agent 2: AGENTS.md Compliance (all effort levels)

Audit the changes to make sure they comply with any AGENTS.md files in the repository. Check the root AGENTS.md (if it exists) and any AGENTS.md files in the directories whose files were modified. Note that AGENTS.md is guidance for AI agents as they write code, so not all instructions will be applicable during code review.

### Agent 3: Git History Context (medium and above)

Read the git blame and history of the code modified, to identify any bugs in light of that historical context.

### Agent 4: Code Reuse & Quality (high and above)

Search for existing utilities and helpers that could replace newly written code. Also review for hacky patterns: redundant state, parameter sprawl, copy-paste with slight variation, leaky abstractions, stringly-typed code, and unnecessary comments.

### Agent 5: Efficiency Review (max only)

Review the changes for efficiency: unnecessary work, missed concurrency, hot-path bloat, recurring no-op updates, unnecessary existence checks, memory leaks, and overly broad operations.

## Phase 4: Confidence Scoring

For each issue found in Phase 3, launch a parallel ${AGENT_TOOL_NAME} to independently score the issue. The scoring agent receives the PR diff, the issue description, and the list of AGENTS.md files (if any). It returns a confidence score from 0-100.

Give the scoring agent this rubric verbatim:

- **0**: Not confident at all. This is a false positive that doesn't stand up to light scrutiny, or is a pre-existing issue.
- **25**: Somewhat confident. This might be a real issue, but may also be a false positive. The agent wasn't able to verify that it's a real issue. If the issue is stylistic, it is one that was not explicitly called out in the relevant AGENTS.md.
- **50**: Moderately confident. The agent was able to verify this is a real issue, but it might be a nitpick or not happen very often in practice. Relative to the rest of the PR, it's not very important.
- **75**: Highly confident. The agent double checked the issue, and verified that it is very likely it is a real issue that will be hit in practice. The existing approach in the PR is insufficient. The issue is very important and will directly impact the code's functionality, or it is an issue that is directly mentioned in the relevant AGENTS.md.
- **100**: Absolutely certain. The agent double checked the issue, and confirmed that it is definitely a real issue, that will happen frequently in practice. The evidence directly confirms this.

## Phase 5: Filter and Deliver

1. Filter out any issues with a score below the effort level's threshold.
2. If no issues remain, say so and stop — do not post anything.
3. Otherwise, detect the platform and CLI availability:

\`\`\`
REMOTE URL:
!\`git remote get-url origin 2>/dev/null || echo "no-remote"\`

GH CLI:
!\`command -v gh 2>/dev/null || echo "not-installed"\`

GLAB CLI:
!\`command -v glab 2>/dev/null || echo "not-installed"\`
\`\`\`

4. **Output directly** (fallback): If no CLI is installed, no PR/MR exists, or the platform is unrecognized, output the findings directly instead.

Whether posting or outputting, use this format:

---

## Code Review

Found N issues:

1. <brief description of bug> (AGENTS.md says "<...>")

   \`<file>:<line range>\`

2. <brief description of bug> (bug due to <file and code snippet>)

   \`<file>:<line range>\`

---

Keep the comment brief and avoid emojis.

## False Positive Filtering

Examples of false positives to exclude:

- Pre-existing issues not introduced in this diff
- Something that looks like a bug but is not actually a bug
- Pedantic nitpicks that a senior engineer wouldn't call out
- Issues that a linter, typechecker, or compiler would catch (eg. missing or incorrect imports, type errors, broken tests, formatting issues)
- General code quality issues (eg. lack of test coverage, general security issues, poor documentation), unless explicitly required in AGENTS.md
- Issues that are called out in AGENTS.md, but explicitly silenced in the code (eg. due to a lint ignore comment)
- Changes in functionality that are likely intentional or are directly related to the broader change
- Real issues, but on lines that the user did not modify in their changes

## Notes

- Do not check build signal or attempt to build or typecheck the app. These will run separately.
- You must cite the file and line range for each finding.
- Make a todo list first.

## After the review

After the findings are reported: if \`verify\` has not run this session and
the diff has a runtime surface (not test-only or docs-only), invoke the
\`verify\` skill with the Skill tool now — this review checks that the diff
reads right; \`verify\` checks that it runs right.

## Input

$ARGUMENTS
`,
};

/**
 * `/code-review [low|medium|high|max] [--fix] [--comment] [<pr#>|<branch>|<path>]`
 *
 * Claude Code 的 `Oe()`（2.1.332 反查）逐条对齐，去掉它支持而我们还给不了的档位
 * （xhigh / ultra 云端）与 `--post` / `--max-findings`：
 * - `--fix` / `--comment` 是唯一被剥掉的 flag，其余留在目标串里（CC 的 `at()` 同款）；
 * - 第一个位置参数是档位槽。形似档位（`^(low|med|hig|max|ult)[a-z]*$`）却不是档位的，
 *   只加一句 `Ignoring unrecognized effort …` 继续跑——CC 也是这么处理的，而且这个
 *   token 会留在目标里（CC 的 `pt(P)` 把整个 P 拼起来）；
 * - 目标串剥掉反引号和开头的 `#`（`/code-review #1234` → `1234`）。
 *
 * 一处对不上 CC：它把上次用过的档位记在全局状态里复用（`codeReviewLastEffort`），
 * 我们还没有跨会话的这份存储，所以没给档位时一律 medium。
 */
const LEVELS = ["low", "medium", "high", "max"] as const;
export type CodeReviewLevel = (typeof LEVELS)[number];

/** 形似档位但不是档位——CC 的 `ki = ^(low|med|hig|xhi|max|ult)[a-z]*$`，去掉 xhi。 */
const LEVEL_LIKE = /^(low|med|hig|max|ult)[a-z]*$/;

export interface CodeReviewArgs {
  level: CodeReviewLevel;
  /** 没写档位、或写的认不出来。模型据此知道这是默认值，而不是用户明确要求的。 */
  levelIsDefault: boolean;
  target?: string;
  fix: boolean;
  comment: boolean;
  /** 档位写错时的一句提示，随正文一起交给模型，由它转述给用户。 */
  warning?: string;
}

export interface CodeReviewArgsParse {
  args: CodeReviewArgs;
  /** 给模型看的运行期上下文，接在技能正文之后。 */
  summary: string;
}

function readLevel(token: string): CodeReviewLevel | undefined {
  const lower = token.toLowerCase();
  return LEVELS.find((level) => lower === level || lower === level.slice(0, 3));
}

export function parseCodeReviewArgs(raw: string): CodeReviewArgsParse {
  const positional: string[] = [];
  let fix = false;
  let comment = false;
  for (const token of parseCommandArguments(raw)) {
    if (token === "--fix") {
      fix = true;
      continue;
    }
    if (token === "--comment") {
      comment = true;
      continue;
    }
    positional.push(token);
  }

  const first = positional[0] ?? "";
  const level = readLevel(first);
  const levelIsDefault = level === undefined;
  const warning =
    levelIsDefault && LEVEL_LIKE.test(first)
      ? `Ignoring unrecognized effort "${first}"; valid: ${LEVELS.join(", ")}.`
      : undefined;

  const joined = (level ? positional.slice(1) : positional)
    .filter(Boolean)
    .join(" ")
    // CC 的 `pt()`：剥掉反引号和开头的 `#`，于是 `/code-review #1234` 就是 PR 1234
    .replace(/`/g, "")
    .replace(/^#/, "");

  const args: CodeReviewArgs = {
    level: level ?? "medium",
    levelIsDefault,
    ...(joined ? { target: joined } : {}),
    fix,
    comment,
    ...(warning ? { warning } : {}),
  };

  return { args, summary: formatArgsSummary(args) };
}

function formatArgsSummary(args: CodeReviewArgs): string {
  const lines = [
    `- level: ${args.level}${args.levelIsDefault ? " (default — no level was given)" : ""}`,
    `- target: ${args.target ?? "(none — the working-tree diff)"}`,
    `- --fix: ${args.fix ? "yes — apply the findings after reporting them" : "no"}`,
    `- --comment: ${args.comment ? "yes — post the findings to the PR/MR" : "no"}`,
  ];
  if (args.warning) lines.push(`- warning: ${args.warning}`);
  return lines.join("\n");
}

/** CC 的 `hi()`：`--comment` 时怎么把结论发回 GitHub。MCP 那条路我方没有，只留 `gh api`。 */
const GITHUB_COMMENT_SECTION = `
## Posting to GitHub (--comment)

The \`--comment\` flag was passed. After producing the findings list, if the
review target is a GitHub pull request, post each finding as an inline PR comment
via \`gh api repos/{owner}/{repo}/pulls/{pr}/comments\` (one call per finding;
include a suggestion block only when it fully fixes the issue). If that command
is refused or fails, print the findings instead. If the target is not a pull
request, print the findings to the terminal and note that \`--comment\` was
ignored.
`;

/** CC 的 `ui()`：同一件事发到 GitLab，顺带说清 glab 没有行内评论的单条命令。 */
function renderGitlabCommentSection(target: ReviewTarget): string {
  const ref =
    target.platform === "gitlab"
      ? target.command.replace(/^glab mr diff /, "")
      : "";
  return `## Posting to GitLab (--comment)

The \`--comment\` flag was passed. After producing the findings list, if the
review target is a GitLab merge request, post the findings as one general MR
note via \`glab mr note ${ref} -m "<body>"\` (every finding with its file:line,
the issue, and the suggested fix). glab has no single verb for line-anchored
comments; those require \`glab api projects/:id/merge_requests/:iid/discussions\`,
so post the general note unless the user asks for inline threads. If glab is not
available in this session, print the findings instead. If the target is not a
merge request, print the findings to the terminal and note that \`--comment\` was
ignored.
`;
}

/**
 * `--fix` 段落，逐字取自 CC 2.1.332 的 `wi()`（`--fix` 为真、走 ReportFindings 的分支）。
 */
const FIX_SECTION = `
## Applying fixes (--fix)

The \`--fix\` flag was passed. After producing the findings list, apply the
findings to the working tree instead of stopping at the report: fix each one
directly — correctness bugs and reuse/simplification/efficiency cleanups alike.
Skip any finding whose fix would change intended behavior, require changes well
outside the reviewed diff, or that you judge to be a false positive — note the
skip rather than arguing with it. Finish with a brief summary of what was fixed
and what was skipped.
`;

/**
 * Agent 工具不可用时的覆盖段。
 *
 * CC 在同一个位置换掉**整段**正文（`di(cell, agentToolAvailable, …)` → `dt({…})`，
 * 单遍内联版）。我方正文要给用户看，所以只追加一段覆盖说明，并点明它盖住了哪两节，
 * 否则基线里那句「Use the Agent tool to launch all agents concurrently」会跟它打架。
 */
const SINGLE_PASS_SECTION = `
## Instead of Phase 3 and Phase 4 — single pass, inline

The \`${AGENT_TOOL_NAME}\` tool is not available in this session, so you cannot launch
review agents. Do that work yourself, in this same context:

- Walk the angles listed under Phase 3 one after another instead of in parallel.
  Do not skip any angle that applies at your effort level.
- Do the Phase 4 scoring yourself: re-read the diff for each issue and state the
  confidence score it would have received, with the evidence that sets it.
`;

/**
 * 评审目标是哪个 PR / MR——CC 的 `gi()` 同款，只认目标串本身写得出来的东西。
 *
 * 裸数字按 GitHub PR 处理；要指 GitLab 的合并请求就写 `!12` 或整条 GitLab URL。
 * CC 能靠 `git remote` 认出当前仓库的托管方（`TA(LRn())`），我方渲染正文时拿不到
 * 远端地址，所以这一层推断给不了。
 */
export type ReviewTarget =
  | {
      platform: "github";
      /** 报错句里点名的对象，例如 `GitHub pull request 12`。 */
      name: string;
      command: string;
      /** 老版本 gh 没有 `pr diff` 时的替代命令（CC 的 `withoutPrDiff`）。 */
      fallback: string;
      /** 目标是另一个仓库的 PR——此时本检出可能压根没有这段改动。 */
      crossRepo: boolean;
    }
  | { platform: "gitlab"; name: string; command: string };

const GITLAB_MR_URL =
  /^https?:\/\/([^/]+)\/(.+?)\/-\/merge_requests\/(\d{1,9})(?:[/?#]|$)/;
const GITHUB_PR_URL =
  /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d{1,9})(?:[/?#]|$)/;

export function resolveReviewTarget(raw: string): ReviewTarget | undefined {
  const target = raw.trim();
  if (!target) return undefined;

  const gitlabUrl = GITLAB_MR_URL.exec(target);
  if (gitlabUrl) {
    const [, , project, iid] = gitlabUrl;
    return {
      platform: "gitlab",
      name: `GitLab merge request ${project}!${iid}`,
      command: `glab mr diff ${iid} -R ${project}`,
    };
  }
  const mr = /^!(\d{1,9})$/.exec(target);
  if (mr) {
    return {
      platform: "gitlab",
      name: `GitLab merge request !${mr[1]}`,
      command: `glab mr diff ${mr[1]}`,
    };
  }

  const githubUrl = GITHUB_PR_URL.exec(target);
  if (githubUrl) {
    const [, host, owner, repo, pr] = githubUrl;
    return {
      platform: "github",
      name: `GitHub pull request https://${host}/${owner}/${repo}/pull/${pr}`,
      command: `gh pr diff ${pr} -R ${owner}/${repo}`,
      fallback: `gh api repos/${owner}/${repo}/pulls/${pr} -H 'Accept: application/vnd.github.diff'`,
      crossRepo: true,
    };
  }
  const pr = /^(\d{1,6})$/.exec(target);
  if (pr) {
    return {
      platform: "github",
      name: `GitHub pull request ${pr[1]}`,
      command: `gh pr diff ${pr[1]}`,
      // CC 的 `Mo("{owner}/{repo}", n)`：花括号留给模型照着远端填
      fallback: `gh api repos/{owner}/{repo}/pulls/${pr[1]} -H 'Accept: application/vnd.github.diff'`,
      crossRepo: false,
    };
  }
  return undefined;
}

/** CC 的 `yi()`：这一段决定「评审对象是哪个 diff」，以及读不到时怎么说。 */
function renderTargetSection(target: ReviewTarget, fix: boolean): string {
  const crossRepo = target.platform === "github" && target.crossRepo;
  const noun = target.platform === "gitlab" ? "merge request" : "pull request";
  const failure = `Could not read ${target.name}: \`${target.command}\` was refused or failed`;

  const fallback =
    target.platform === "github"
      ? `Some sessions have a gh with no \`pr diff\` command. Only if gh itself says so, run this in its
place, alone too:

\`\`\`
${target.fallback}
\`\`\`
`
      : "";

  const readFailure =
    fix || crossRepo
      ? `If that leaves you without the diff, because a command was refused or failed, stop: post nothing, change no file, and reply with only this sentence, word for word, and no list of findings, not even an empty one: "${failure}, so nothing was reviewed."`
      : `If that leaves you without the diff, because a command was refused or failed, run the \`git diff\` commands above as if no target had been passed, and review the checked-out branch instead. Then write these two sentences, word for word, above the findings: "${failure}. This review is of the checked-out branch instead, which may not be that ${noun}."`;

  return [
    `## Review target`,
    `That target is ${target.name}, and its own diff is this review's scope. Get the diff with this command, run alone, with nothing chained, piped or redirected:`,
    ["```", target.command, "```"].join("\n"),
    `It replaces every \`git diff\` command that the instructions above give for gathering the diff. This checkout may be on another branch${crossRepo ? ", or of another repository" : ""}, and must stay as it is: before you lean on a file here for context, check that it already has the diff's added lines, and where it does not, judge from the diff alone and report nothing from that file. If you start subagents, give each one the diff itself and this warning: they see none of this.${fix ? " Apply a fix only to a file that already has the diff's added lines, and list every other finding as skipped." : ""}`,
    fallback,
    readFailure,
    `Two cases end the review instead: the command answers that there is no such target, or, falling back, you find that the checked-out branch has no diff. Then reply with only one sentence that says which, and no list of findings, not even an empty one.`,
    `Use the quoted words only where you could not read the diff. Where you did read it, leave them out altogether.`,
  ]
    .filter((block) => block.trim())
    .join("\n\n");
}

/**
 * `/code-review` 的段落选择。
 *
 * 与 `parseCodeReviewArgs` 分开：解析只认参数，这里再加上运行时事实。顺序按
 * 工作流的先后：先讲这一轮怎么做（单遍内联），再讲做完之后怎么办（`--fix`）。
 */
export function buildCodeReviewPrompt(
  raw: string,
  ctx: SkillPromptContext,
): string {
  const { args } = parseCodeReviewArgs(raw);
  const target = args.target ? resolveReviewTarget(args.target) : undefined;
  const sections: string[] = [];
  // 顺序按工作流的先后：先锁定评哪个 diff，再讲这一轮怎么做，最后讲做完之后怎么办
  if (target) sections.push(renderTargetSection(target, args.fix));
  if (!ctx.toolNames.includes(AGENT_TOOL_NAME)) {
    sections.push(SINGLE_PASS_SECTION);
  }
  if (args.comment) {
    sections.push(
      target?.platform === "gitlab"
        ? renderGitlabCommentSection(target)
        : GITHUB_COMMENT_SECTION,
    );
  }
  if (args.fix) sections.push(FIX_SECTION);
  return sections.map((section) => section.trim()).join("\n\n");
}

/** 第一个接上代码钩子的内置技能：`/code-review` 的参数由这个表负责解释。 */
export const code_reviewSkillHooks: Record<string, BuiltinSkillHook> = {
  "code-review": {
    describeArgs: (raw) => parseCodeReviewArgs(raw).summary,
    buildPrompt: buildCodeReviewPrompt,
  },
};

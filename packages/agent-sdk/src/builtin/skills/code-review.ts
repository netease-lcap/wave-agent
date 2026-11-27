import {
  AGENT_TOOL_NAME,
  BASH_TOOL_NAME,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  READ_TOOL_NAME,
  REPORT_FINDINGS_TOOL_NAME,
} from "../../constants/tools.js";
import { parseCommandArguments } from "../../utils/commandArgumentParser.js";
import {
  repoPlatformOf,
  repoHostOfHost,
  type CliPlatform,
} from "../../utils/repoHost.js";
import type { BuiltinSkillHook, SkillPromptContext } from "../skillHooks.js";

export const code_reviewSkill: Record<string, string> = {
  "skills/code-review/SKILL.md": `---
name: code-review
description: "Review the current diff for correctness bugs and reuse/simplification/efficiency cleanups at the given effort level (low/medium: fewer, high-confidence findings; high/max: broader coverage, may include lower-confidence findings)"
allowed-tools: ${BASH_TOOL_NAME}(git diff*), ${BASH_TOOL_NAME}(git status*), ${BASH_TOOL_NAME}(git log*), ${BASH_TOOL_NAME}(git show*), ${BASH_TOOL_NAME}(git blame*), ${BASH_TOOL_NAME}(git remote*), ${BASH_TOOL_NAME}(git merge-base*), ${BASH_TOOL_NAME}(command -v*), ${BASH_TOOL_NAME}(gh pr view*), ${BASH_TOOL_NAME}(gh pr diff*), ${BASH_TOOL_NAME}(gh api repos/*/pulls/*), ${BASH_TOOL_NAME}(glab mr view*), ${BASH_TOOL_NAME}(glab mr diff*), ${BASH_TOOL_NAME}(glab mr note*), ${READ_TOOL_NAME}, ${GLOB_TOOL_NAME}, ${GREP_TOOL_NAME}, ${AGENT_TOOL_NAME}
---

# Code Review

Review the current branch's changes for correctness bugs and quality issues.

## Phase 0 — Gather the diff

First, collect the diff and metadata:

\`\`\`text
GIT STATUS:
!\`git status\`

FILES MODIFIED:
!\`git diff --name-only origin/HEAD...HEAD 2>/dev/null || git diff --name-only HEAD~1...HEAD\`

COMMITS:
!\`git log --no-decorate origin/HEAD...HEAD 2>/dev/null || git log --no-decorate HEAD~1...HEAD\`

DIFF CONTENT:
!\`git diff origin/HEAD...HEAD 2>/dev/null || git diff HEAD~1...HEAD\`
\`\`\`

\`origin/HEAD...HEAD\` is the whole branch against the default branch — the usual
scope. If it prints nothing, fall back to \`git diff main...HEAD\`, with the
default branch's real name in place of \`main\` (\`git branch -a\` lists them), or
\`git diff HEAD~1\` if you can't tell the base.

If the range diff is empty but \`git diff HEAD\` is not, the review is running
before the commit: use \`git diff HEAD\` and treat the working tree as the scope.
If there are no changes at all, stop and tell the user.

When you write a git command yourself instead of using one of the lines above,
never use these three forms — the shells this runs under (bash and PowerShell)
do not agree on them, and each one needs a permission prompt:

- \`@{upstream}\` or \`@{u}\` next to \`..\` or \`...\`
- commands grouped in parentheses
- shell variables such as \`$?\`

## Phase 1 — Find candidates

This run's parameters are already parsed for you — read \`## Arguments\` at the
end of this skill instead of re-reading \`$ARGUMENTS\`. If that block carries a
warning, tell the user in one short line as you begin.

Which angles run, by effort level:

- **low**: Angle A and Conventions — near-certain findings only
- **medium** (default): Angles A–E and Conventions
- **high**: all ten angles
- **max**: all ten, and report the lower-confidence candidates they turn up

Launch one agent per angle with the ${AGENT_TOOL_NAME} tool, all in a single
message, passing each the full diff so it has the complete context. If the
${AGENT_TOOL_NAME} tool is not in your tool set this run, work the angles
yourself, sequentially.

A candidate counts only when you can name the input, state, timing, or platform
that makes it wrong. "This looks off" is not a candidate, and Phase 2 will
refute it.

### Angle A — line-by-line diff scan

Read every hunk in the diff, line by line. Then Read the enclosing function for
each hunk — bugs in unchanged lines of a touched function are in scope (the diff
re-exposes them or fails to fix them). For every line ask: what input, state,
timing, or platform makes this line wrong? Look for inverted/wrong conditions,
off-by-one, null/undefined deref, missing \`await\`, falsy-zero checks,
wrong-variable copy-paste, error swallowed in catch, unescaped regex metachars.

### Angle B — removed-behavior auditor

For every line the diff DELETES or replaces, name the invariant or behavior it
enforced, then search the new code for where that invariant is re-established.
If you can't find it, that's a candidate: a removed guard, a dropped error
path, a narrowed validation, a deleted test that was covering a real case.

### Angle C — cross-file tracer

For each function the diff changes, find its callers (Grep for the symbol) and
check whether the change breaks any call site: a new precondition, a changed
return shape, a new exception, a timing/ordering dependency. Also check callees:
does a parallel change in the same diff make a call unsafe?

### Angle D — language-pitfall specialist

Scan for the classic pitfalls of the diff's language/framework — for example:
JS falsy-zero, \`==\` coercion, closure-captured loop var; Python mutable default
args, late-binding closures; Go nil-map write, range-var capture; SQL injection;
timezone/DST drift; float equality. Flag any instance the diff introduces.

### Angle E — wrapper/proxy correctness

When the diff adds or modifies a type that wraps another (cache, proxy,
decorator, adapter): check that every method routes to the wrapped instance and
not back through a registry/session/global — a caching provider holding a
\`delegate\` field that resolves IDs via \`session.get(...)\` instead of
\`delegate.get(...)\` will re-enter the cache or recurse. Also check that the
wrapper forwards all the methods the callers actually use.

### Reuse

Flag new code that re-implements something the codebase already has — Grep
shared/utility modules and files adjacent to the change, and name the existing
helper to call instead.

### Simplification

Flag unnecessary complexity the diff adds: redundant or derivable state,
copy-paste with slight variation, deep nesting, dead code left behind. Name the
simpler form that does the same job.

### Efficiency

Flag wasted work the diff introduces: redundant computation or repeated I/O,
independent operations run sequentially, blocking work added to startup or hot
paths. Also flag long-lived objects built from closures or captured
environments — they keep the entire enclosing scope alive for the object's
lifetime, a memory leak when that scope holds large values; prefer a
class/struct that copies only the fields it needs. Name the cheaper alternative.

### Altitude

Check that each change fixes the root cause at the right depth rather than
patching a symptom with a fragile bandaid. Special cases layered on shared
infrastructure are a sign the fix isn't deep enough — prefer the simpler, more
general change to the underlying mechanism over adding special cases, and name
that change.

### Conventions (AGENTS.md)

Find the AGENTS.md files that govern the changed code: the user-level
~/.wave/AGENTS.md, the repo-root AGENTS.md, plus any AGENTS.md in a directory
that is an ancestor of a changed file (a directory's AGENTS.md only applies to
files at or below it). Note that AGENTS.md guides an agent writing code, so not
every instruction is a review rule. Read each one that exists, then check the
diff for clear violations of the rules they state.

Only flag a violation when you can quote the exact rule and the exact line that
breaks it — no style preferences, no vague "spirit of the doc" inferences. In
the finding, name the AGENTS.md path and quote the rule so the report can cite
it. If no AGENTS.md applies, return nothing for this angle.

## Phase 2 — Verify

Dedup candidates that point at the same line or mechanism, keeping the one with
the most concrete failure scenario. For each remaining candidate, launch one
${AGENT_TOOL_NAME} as a verifier: give it the diff, the relevant file(s), and the
candidate, and have it return exactly one of:

- **CONFIRMED** — can name the inputs/state that trigger it and the wrong
  output or crash. Quote the line.
- **PLAUSIBLE** — mechanism is real, trigger is uncertain (timing, env,
  config). State what would confirm it.
- **REFUTED** — factually wrong (code doesn't say that) or guarded elsewhere.
  Quote the line that proves it.

Keep candidates where the vote is CONFIRMED or PLAUSIBLE.

## Phase 3 — Sweep for gaps

Run one more finder as a fresh reviewer who has the verified list. Re-read the
diff and the enclosing functions looking ONLY for defects not already listed.
Do not re-derive or re-confirm anything already there — the job is gaps. Focus
on what the first pass tends to miss: silent behavior changes, error paths that
lost their handling, call sites the diff left stale, invariants that were just
moved.

Surface up to 8 additional candidates, each naming a defect not already on the
list. Put each one through Phase 2's verification before reporting it — an
unverified sweep candidate does not count. If nothing new survives, return an
empty sweep. Do not pad: this step exists to catch real gaps, not to reach a
count.

## Phase 4 — Deliver

1. Drop the candidates the verifiers refuted. Keep CONFIRMED and PLAUSIBLE.
2. If no issues remain, say so and stop — do not post anything.
3. Otherwise, detect the platform and CLI availability:

\`\`\`text
REMOTE URL:
!\`git remote get-url origin 2>/dev/null || echo "no-remote"\`

GH CLI:
!\`command -v gh 2>/dev/null || echo "not-installed"\`

GLAB CLI:
!\`command -v glab 2>/dev/null || echo "not-installed"\`
\`\`\`

4. **Output directly** (fallback): if no CLI is installed, no PR/MR exists, or
   the platform is unrecognized, output the findings directly instead.

Whether posting or outputting, rank the most severe first and label every
finding:

- 🔴 **Important** — a bug this change adds or makes worse; fix it before
  merging. If someone can hit it, a rare trigger does not lower the severity.
- 🟣 **Pre-existing** — a bug already in the codebase that this change did not
  introduce. On unchanged lines it is pre-existing if the change merely fails
  to fix it, and important if the change re-exposes it.
- 🟡 **Nit** — minor: worth fixing, not blocking. A broken AGENTS.md rule, or a
  bug that harms nobody, such as a misleading log line.

Severity only labels and orders a finding: never drop one for its severity.
When a limit forces a cut, cut the lowest-ranked first.

Write each summary in two or three short sentences: the problem as a user of
the code would see it, then where it happens and what sets it off, then \`Fix:\`
and the change to make.

---

## Code Review

3 findings (🔴 Important 2, 🟡 Nit 1), most severe first:

1. 🔴 Important \`<file>:<line>\`: what is wrong, in one or two sentences

   Fix: the change to make

2. 🟡 Nit \`<file>:<line>\`: what is wrong

   Fix: the change to make

---

Keep the report brief; the severity labels are the only emoji.

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

/**
 * CC 的 `ui()`：同一件事发到 GitLab，顺带说清 glab 没有行内评论的单条命令。
 * 逐字取自 CC 2.1.332 的 `ui()`（`1064-239356B-Hsr.js`，2.1.325 同形）。
 */
function renderGitlabCommentSection(target: ReviewTarget | undefined): string {
  const ref =
    target?.platform === "gitlab"
      ? ` ${target.command.replace(/^glab mr diff /, "")}`
      : "";
  // CC 的 `ui()`：命令里有 `-R` 时项目已经写明；只给 `!12` / 裸数字时 `glab`
  // 拿的是当前目录所属的项目，`cd` 到别处就发错仓库了，所以补一句要它待在
  // 那个项目的 checkout 里。
  const anchor = ref.includes(" -R ")
    ? ""
    : " from inside that project's checkout";
  return `## Posting to GitLab (--comment)

The \`--comment\` flag was passed. After producing the findings list, if the
review target is a GitLab merge request, post the findings as one general MR
note via \`glab mr note${ref} -m "<body>"\`${anchor} (every finding with its file:line,
the issue, and the suggested fix). glab has no single verb for line-anchored
comments; those require \`glab api projects/:id/merge_requests/:iid/discussions\`,
so post the general note unless the user asks for inline threads. If glab is not
available in this session, print the findings instead. If the target is not a
merge request, print the findings to the terminal and note that \`--comment\` was
ignored.
`;
}

/**
 * `--fix` 段落，逐字取自 CC 2.1.332 的 `wi()`（`1091-228433B-Vdr.js:2064`）。
 *
 * `wi(e, o)` 的 `e` 是「本次会话有清单工具」：有工具时结尾要求把同一批发现带
 * `outcome` 重报一遍（界面靠它更新每条的状态），没有工具时只要一段文字小结。
 */
function renderFixSection(hasFindingsTool: boolean): string {
  const closing = hasFindingsTool
    ? `Then call the ${REPORT_FINDINGS_TOOL_NAME} tool again with the same findings,
each carrying an \`outcome\`: \`fixed\`, \`no_change_needed\` (the finding was wrong
or already handled), or \`skipped\` (real but not applied). Do not repeat the
findings as text; after the call, give one line per skipped finding saying why.`
    : `Finish with a brief summary of what was fixed and what was skipped.`;
  return `
## Applying fixes (--fix)

The \`--fix\` flag was passed. After producing the findings list, apply the
findings to the working tree instead of stopping at the report: fix each one
directly — correctness bugs and reuse/simplification/efficiency cleanups alike.
Skip any finding whose fix would change intended behavior, require changes well
outside the reviewed diff, or that you judge to be a false positive — note the
skip rather than arguing with it. ${closing}
`;
}

/**
 * 有清单工具时的输出契约，取自 CC 2.1.332 的 `wo()` 与 `pi` / `mi`（`1091-228433B-Vdr.js:1305` / `:1976`）。
 *
 * 它覆盖 Phase 4 那段人类可读格式：CC 在这里明说不许再把发现复述成文字，
 * 并把清单本身当作报告。它依赖 `verdict` 与 `outcome` 两个字段，所以只在会话
 * 真有清单工具时才加；CC 的 `severity` 变体我方不带，那段没抄。
 */
const OUTPUT_CONTRACT_TOOL = `
## Output

Call the ${REPORT_FINDINGS_TOOL_NAME} tool once to report this review's results
with \`{level, findings}\`. \`findings\` is every finding that survives, ranked
most-severe first; each entry has \`file\`, \`line\`, \`summary\`,
\`short_summary\` — the claim compressed to ≤60 characters, no rationale or
consequence clause — \`failure_scenario\`, \`category\` — a short kebab-case slug
for the angle that produced it (\`correctness\`, \`simplification\`,
\`efficiency\`, \`reuse\`, \`altitude\`, \`conventions\`, or a more specific slug
like \`test-coverage\` when one fits better) — and \`verdict\`, the vote the
Phase 2 verifier returned. If nothing survives verification, call it with an
empty array. Do not also print the findings as text: the tool call is the
report.

## If findings are fixed later

Whenever reported findings get fixed later in this session — the user asks you
to fix them, or later work fixes them incidentally — call the
${REPORT_FINDINGS_TOOL_NAME} tool again with the same findings, each carrying an
\`outcome\`: \`fixed\`, \`no_change_needed\` (the finding was wrong or already
handled), or \`skipped\` (real but not applied). Do not repeat the findings as
text. Make that call immediately after the fixes land, before any prose
summary: the interface's per-finding status updates only from it, and without
it the findings stay marked unresolved.

After the call, give one line per finding with its outcome: this session can
also be read from a client that does not show the tool call.
`;

/**
 * Agent 工具不可用时的覆盖段。
 *
 * CC 在同一个位置换掉**整段**正文（`di(cell, agentToolAvailable, …)` → `dt({…})`，
 * 单遍内联版）。我方正文要给用户看，所以只追加一段覆盖说明，并点明它盖住了哪两节，
 * 否则基线里那句「Launch one agent per angle with the Agent tool」会跟它打架。
 */
const SINGLE_PASS_SECTION = `
## Instead of Phase 1 and Phase 2 — single pass, inline

The \`${AGENT_TOOL_NAME}\` tool is not available in this session, so you cannot launch
review agents. Do that work yourself, in this same context:

- Walk the angles listed under Phase 1 one after another instead of in parallel.
  Do not skip any angle that applies at your effort level.
- Do the Phase 2 verification yourself: re-read the diff for each candidate and
  state the verdict it would have received (CONFIRMED, PLAUSIBLE or REFUTED),
  with the line that sets it.
`;

/**
 * 评审目标是哪个 PR / MR——CC 的 `gi()` 同款，只认目标串本身写得出来的东西。
 *
 * 裸数字本身看不出平台，按远端托管方判（CC 的 `Uka()`，`0215-6730B-aX.js:206`）：
 * GitLab 仓库里它是 MR 号，Bitbucket 仓库里不注入（CC 的 `gi()`，
 * `1091-228433B-Vdr.js:1998`），认不出来或 GitHub 仓库时仍按 PR 处理。
 * 要指别的仓库的 GitLab MR 就写 `!12`，或者给整条 GitLab URL。
 */
export type ReviewTarget =
  | {
      platform: "github";
      /** 报错句里点名的对象，例如 `GitHub pull request 12`。 */
      name: string;
      command: string;
      /**
       * 老版本 gh 没有 `pr diff` 时的替代命令（CC 的 `withoutPrDiff`）。
       *
       * 只有认得出是 github.com 的目标才有：`gh api repos/…` 是那家的端点拼法。
       */
      fallback?: string;
      /** 目标是另一个仓库的 PR——此时本检出可能压根没有这段改动。 */
      crossRepo: boolean;
    }
  | { platform: "gitlab"; name: string; command: string };

// CC 的两段字符类（`0215-6730B-aX.js:17-18`）：`NRn` 是域名形态（label.label…，可带
// 端口），`aX` 是路径段形态（首字符字母数字/下划线/点，且不能是 `.` 或 `..`）。拼成常量
// 是为了两条正则共用同一份定义，而不是各写一份宽松的 `[^/]+`。
const HOST_LABEL = String.raw`[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?`;
const HOST_PATTERN = String.raw`${HOST_LABEL}(?:\.${HOST_LABEL})*(?::\d{1,5})?`;
const PATH_SEGMENT = String.raw`(?!\.{1,2}(?:/|$))[A-Za-z0-9_.][\w.-]*`;
// GitLab 的项目路径是 `namespace/project`（可以有更深的组），CC 的 `_` 也要求至少两段
// （`0215-6730B-aX.js:217`）。
const GITLAB_MR_URL = new RegExp(
  `^https?://(${HOST_PATTERN})/((?:${PATH_SEGMENT}/)+${PATH_SEGMENT})/-/merge_requests/(\\d{1,9})(?:[/?#]|$)`,
);
const GITHUB_PR_URL = new RegExp(
  `^https?://(${HOST_PATTERN})/(${PATH_SEGMENT})/(${PATH_SEGMENT})/pull/(\\d{1,9})(?:[/?#]|$)`,
);

export function resolveReviewTarget(
  raw: string,
  platform?: CliPlatform,
): ReviewTarget | undefined {
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
  // CC 的 `gi()`（`1091-228433B-Vdr.js:1989`）：裸形态的 `!N` 只认 1-6 位，URL 里的
  // iid 才放宽到 9 位（`L6s` 那边的正则）。
  const mr = /^!(\d{1,6})$/.exec(target);
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
    const url = `https://${host}/${owner}/${repo}/pull/${pr}`;
    // CC 的 `gi()`（`1091-228433B-Vdr.js:2015-2021`）：只有认得出是 github.com 时才
    // 敢拼 `-R`——`gh api repos/{owner}/{repo}` 这种端点是 github.com 的拼法，自建
    // 实例上要带 host，所以整条 URL 交给 gh，连 `pr diff` 的退路也不给。
    if (repoHostOfHost(host) !== "github") {
      return {
        platform: "github",
        name: `GitHub pull request ${url}`,
        command: `gh pr diff ${url}`,
        crossRepo: true,
      };
    }
    return {
      platform: "github",
      name: `GitHub pull request ${url}`,
      command: `gh pr diff ${pr} -R ${owner}/${repo}`,
      fallback: `gh api repos/${owner}/${repo}/pulls/${pr} -H 'Accept: application/vnd.github.diff'`,
      crossRepo: true,
    };
  }
  const pr = /^(\d{1,6})$/.exec(target);
  if (pr) {
    // CC 的 `gi()`（`1091-228433B-Vdr.js:1998`）：Bitbucket 仓库里裸数字不注入目标，
    // 让模型照常评审当前分支 —— 那家没有 gh 也没有 glab 能用。
    if (platform === "bitbucket") return undefined;
    // CC 的 `Uka()`（`0215-6730B-aX.js:206`）：目标串看不出平台时按远端托管方判，
    // GitLab 仓库里的裸数字是合并请求号，补一个 `!` 就是同一条命令。自建实例在
    // `repoPlatformOf()` 里已经折成 GitLab，所以这里不用再单列一支。
    if (platform === "gitlab") {
      return {
        platform: "gitlab",
        name: `GitLab merge request !${pr[1]}`,
        command: `glab mr diff ${pr[1]}`,
      };
    }
    // 认不出托管方就什么都不注入：没有远端就没有 PR/MR 可评，猜一个只会评错东西。
    if (platform !== "github") return undefined;
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

  // CC 的 `yi()`（`1091-228433B-Vdr.js:2060`）：有 `withoutPrDiff` 才给退路。自建实例
  // 没有这条，因为它的端点只对 github.com 成立；GitLab 目标也没有，那里压根不走 gh。
  const fallbackCommand =
    target.platform === "github" ? target.fallback : undefined;
  const fallback = fallbackCommand
    ? `Some sessions have a gh with no \`pr diff\` command. Only if gh itself says so, run this in its
place, alone too:

\`\`\`
${fallbackCommand}
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
  // 平台决定裸数字是 PR 还是 MR、`--comment` 走哪一段，所以在选段落之前先算。
  // 用 `repoPlatformOf()` 而不是 `repoHostOf()`：自建实例在那里折成私有化 GitLab。
  const platform = repoPlatformOf(ctx.gitRemoteUrl);
  const target = args.target
    ? resolveReviewTarget(args.target, platform)
    : undefined;
  // 有清单工具就整份清单走工具、正文不再复述；没有就落回正文里那段可读格式。
  const hasFindingsTool = ctx.toolNames.includes(REPORT_FINDINGS_TOOL_NAME);
  const sections: string[] = [];
  // 顺序按工作流的先后：先锁定评哪个 diff，再讲这一轮怎么做，最后讲做完之后怎么办
  if (target) sections.push(renderTargetSection(target, args.fix));
  if (!ctx.toolNames.includes(AGENT_TOOL_NAME)) {
    sections.push(SINGLE_PASS_SECTION);
  }
  if (args.comment) {
    // CC 的 `Uka()`（`0215-6730B-aX.js:206`）：给了目标串就看它，没给就看远端 ——
    // GitLab 仓库默认会评的是 MR，评论自然该走 glab；自建实例同 GitLab。
    const gitlab = target
      ? target.platform === "gitlab"
      : platform === "gitlab";
    sections.push(
      gitlab ? renderGitlabCommentSection(target) : GITHUB_COMMENT_SECTION,
    );
  }
  if (args.fix) sections.push(renderFixSection(hasFindingsTool));
  if (hasFindingsTool) sections.push(OUTPUT_CONTRACT_TOOL);
  return sections.map((section) => section.trim()).join("\n\n");
}

/** 第一个接上代码钩子的内置技能：`/code-review` 的参数由这个表负责解释。 */
export const code_reviewSkillHooks: Record<string, BuiltinSkillHook> = {
  "code-review": {
    describeArgs: (raw) => parseCodeReviewArgs(raw).summary,
    buildPrompt: buildCodeReviewPrompt,
  },
};

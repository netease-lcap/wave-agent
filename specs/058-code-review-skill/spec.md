# Feature Specification: Code Review Skill

**Feature Branch**: `058-code-review-skill`
**Created**: 2026-06-29

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Review Current Diff for Correctness Bugs (Priority: P1)

As a developer, I want to review my current branch's changes for correctness bugs so I can catch issues before merging, without relying on external CI or a hosted git platform.

**Why this priority**: Bug detection is the primary value of code review. Using `git diff` (rather than `gh`) makes the skill work with any git host — GitLab, self-hosted, or local-only repos.

**Independent Test**: Make a change with an obvious bug on a feature branch, run `/code-review`, and verify the bug is reported with file and line range.

**Acceptance Scenarios**:

1. **Given** there are uncommitted or committed-but-unmerged changes on the current branch, **When** the user runs `/code-review`, **Then** the skill gathers the diff against `main` (or `HEAD~1` as fallback) and reports correctness bugs found in the changes.
2. **Given** there are no changes on the current branch, **When** the user runs `/code-review`, **Then** the skill stops and tells the user there is nothing to review.
3. **Given** a correctness bug is found, **When** the report is rendered, **Then** each finding includes a brief description and the `<file>:<line range>` citation.

---

### User Story 2 - Configurable Effort Level (Priority: P2)

As a developer, I want to control how thorough the review is — from a quick low-confidence pass to an exhaustive max-effort sweep — so I can trade review cost against coverage depending on the change size and risk.

**Why this priority**: Different changes warrant different review depth. A one-line typo fix needs a quick scan; a large refactor benefits from broader coverage even at the cost of more noise.

**Independent Test**: Run `/code-review low` and `/code-review max` on the same diff and verify that `max` launches more agents and surfaces lower-confidence findings that `low` filtered out.

**Acceptance Scenarios**:

1. **Given** the user runs `/code-review low`, **When** the skill executes, **Then** it launches 2 review agents and filters out findings with confidence below 90.
2. **Given** the user runs `/code-review` with no argument, **When** the skill executes, **Then** it defaults to `medium` effort: 3 agents, confidence threshold 80.
3. **Given** the user runs `/code-review high`, **When** the skill executes, **Then** it launches 4 agents with confidence threshold 70.
4. **Given** the user runs `/code-review max`, **When** the skill executes, **Then** it launches 5 agents with confidence threshold 60, including the efficiency reviewer.

---

### User Story 3 - Parallel Multi-Dimensional Review with Confidence Scoring (Priority: P2)

As a developer, I want the review to cover multiple independent dimensions (bugs, AGENTS.md compliance, git history, code reuse, efficiency) in parallel, with each finding independently scored for confidence so I can focus on high-signal issues.

**Why this priority**: Parallel review reduces latency and broadens coverage. Independent confidence scoring filters false positives that a single-pass review would surface.

**Independent Test**: Run `/code-review max` on a diff with a reuse issue and an efficiency issue, and verify both dimensions produce findings, each with an independent confidence score that passes the threshold.

**Acceptance Scenarios**:

1. **Given** the effort level launches N agents, **When** Phase 3 executes, **Then** all review agents are launched concurrently in a single message, each receiving the full diff.
2. **Given** a finding is produced by any review agent, **When** Phase 4 executes, **Then** a separate parallel scoring agent independently assigns a 0–100 confidence score using the fixed rubric.
3. **Given** findings have been scored, **When** Phase 5 executes, **Then** only findings at or above the effort level's threshold are reported; the rest are filtered out.
4. **Given** no findings pass the threshold, **When** the report renders, **Then** the skill says so and stops.

---

### User Story 4 - AGENTS.md Compliance Audit (Priority: P2)

As a project maintainer, I want the review to check whether changes comply with the repository's `AGENTS.md` files (root and directory-level) so that AI-authored code follows project conventions.

**Why this priority**: AGENTS.md encodes project-specific guidance; auditing compliance keeps AI-generated changes aligned with team standards.

**Independent Test**: Add an `AGENTS.md` rule forbidding a pattern, introduce that pattern in a change, run `/code-review`, and verify the finding cites the AGENTS.md rule.

**Acceptance Scenarios**:

1. **Given** a root `AGENTS.md` exists, **When** the AGENTS.md compliance agent runs, **Then** it checks the diff against the root AGENTS.md guidance.
2. **Given** AGENTS.md files exist in directories whose files were modified, **When** the compliance agent runs, **Then** it also checks those directory-level AGENTS.md files.
3. **Given** a finding violates an AGENTS.md rule, **When** the finding is reported, **Then** it includes the quote `(AGENTS.md says "<...>")`.

---

### User Story 5 - Post Review Comment to PR/MR (Priority: P2)

As a developer, I want the review findings posted as a comment on my pull/merge request when the platform CLI (`gh` or `glab`) is available, so my team can see the review alongside the code without copy-pasting from the terminal.

**Why this priority**: Posting to the PR/MR makes findings visible to the whole team and persists alongside the code change. When no CLI or PR/MR exists, findings fall back to direct terminal output.

**Independent Test**: On a GitHub repo with `gh` installed and a PR open, run `/code-review` and verify a comment appears on the PR with no terminal output. On a repo without `gh`, verify findings are output directly to the terminal.

**Acceptance Scenarios**:

1. **Given** the remote URL contains `github` and `gh` is installed and a PR exists for the current branch, **When** Phase 5 executes, **Then** the review is posted as a PR comment via `gh pr comment` and NOT output to the terminal.
2. **Given** the remote URL contains `gitlab` and `glab` is installed and an MR exists for the current branch, **When** Phase 5 executes, **Then** the review is posted as an MR note via `glab mr note` and NOT output to the terminal.
3. **Given** no platform CLI is installed, **When** Phase 5 executes, **Then** the findings are output directly to the terminal.
4. **Given** a CLI is installed but no PR/MR exists for the current branch, **When** Phase 5 executes, **Then** the findings are output directly to the terminal.
5. **Given** no findings pass the threshold, **When** Phase 5 executes, **Then** the skill says "no issues" and stops — no comment is posted and no findings are output.

---

### Edge Cases

- **What happens if the diff is very large?** The skill passes the full diff to each agent; no truncation is performed by the skill itself. Large diffs may hit model context limits — this is acceptable and surfaces as an agent error.
- **What happens if `main` branch doesn't exist locally?** The merge-base command falls back to `HEAD~1`, reviewing only the last commit.
- **What if a finding is a false positive?** The confidence-scoring phase is designed to filter false positives; the skill also lists explicit false-positive categories to exclude (pre-existing issues, linter-level nitpicks, intentional changes, etc.).
- **What if the AI tries to auto-trigger the skill?** `disable-model-invocation: true` in the frontmatter prevents the AI from invoking the skill autonomously; it is user-invoked only via `/code-review`.
- **What if a scoring agent disagrees with the reviewing agent?** The scoring agent's independent score is authoritative for filtering; the reviewing agent's own assessment is not used for thresholding.
- **What if the remote is self-hosted GitLab (not gitlab.com)?** Platform detection checks if the remote URL contains `gitlab`; self-hosted instances with custom domains are not recognized and the skill falls back to direct output.
- **What if `gh` or `glab` is installed but not authenticated?** The CLI command to post a comment will fail; the skill treats this the same as "no PR/MR exists" and skips silently.
- **What if posting the comment fails?** The skill falls back to direct terminal output so no information is lost.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a builtin `code-review` skill invoked via `/code-review [effort]`.
- **FR-002**: Skill MUST gather the diff using `git diff` against the merge-base of `HEAD` and `main`, falling back to `HEAD~1` when `main` is unavailable. No `gh` dependency.
- **FR-003**: Skill MUST stop and inform the user when there are no changes to review.
- **FR-004**: Skill MUST parse `$ARGUMENTS` for an effort level: `low`, `medium` (default), `high`, `max`.
- **FR-005**: Each effort level MUST map to a fixed agent count and confidence threshold: low→2 agents/90, medium→3 agents/80, high→4 agents/70, max→5 agents/60.
- **FR-006**: Skill MUST launch all review agents concurrently in a single message, passing each the full diff.
- **FR-007**: Skill MUST include a Bug Scanner agent at all effort levels, performing a shallow scan focused on large bugs.
- **FR-008**: Skill MUST include an AGENTS.md Compliance agent at all effort levels, auditing against root and modified-directory AGENTS.md files.
- **FR-009**: Skill MUST include a Git History Context agent at `medium` and above, using `git blame` and history.
- **FR-010**: Skill MUST include a Code Reuse & Quality agent at `high` and above.
- **FR-011**: Skill MUST include an Efficiency Review agent at `max` only.
- **FR-012**: Skill MUST launch a separate parallel scoring agent for each finding, returning a 0–100 confidence score per the fixed rubric.
- **FR-013**: Skill MUST filter out findings whose confidence score is below the effort level's threshold.
- **FR-014**: Skill MUST report findings in the fixed format: numbered list with description, optional AGENTS.md quote, and `<file>:<line range>` citation.
- **FR-015**: Skill MUST report "no issues" and stop when no findings pass the threshold — no comment posted, no findings output.
- **FR-016**: Skill MUST cite the file and line range for every finding.
- **FR-017**: Skill MUST set `disable-model-invocation: true` so the AI cannot auto-trigger it.
- **FR-018**: Skill MUST restrict its own tools via `allowed-tools` to: git diff/status/log/show/blame/remote, command -v, gh pr comment/view, glab mr note/view, Read, Glob, Grep, and Agent.
- **FR-019**: Skill MUST NOT check build signal or attempt to build or typecheck the app — these run separately.
- **FR-020**: Skill MUST make a todo list first before executing the review phases.
- **FR-021**: Skill MUST exclude false-positive categories: pre-existing issues, non-bug-looking issues, pedantic nitpicks, linter/typechecker-level issues, general quality gaps (unless AGENTS.md requires), silenced issues, intentional changes, and issues on unmodified lines.
- **FR-022**: Skill MUST detect the repository platform by checking the remote URL (`git remote get-url origin`) — `github` in URL → GitHub, `gitlab` in URL → GitLab.
- **FR-023**: Skill MUST detect whether the corresponding CLI is installed (`command -v gh` / `command -v glab`) before attempting to post a comment.
- **FR-024**: Skill MUST check that a PR/MR exists for the current branch before posting (`gh pr view` / `glab mr view`).
- **FR-025**: Skill MUST post the review as a PR comment via `gh pr comment --body` (preferred) when the platform is GitHub and `gh` is installed and a PR exists — and MUST NOT output findings to the terminal in this case.
- **FR-026**: Skill MUST post the review as an MR note via `glab mr note --message` (preferred) when the platform is GitLab and `glab` is installed and an MR exists — and MUST NOT output findings to the terminal in this case.
- **FR-027**: Skill MUST output findings directly to the terminal (fallback) when no CLI is installed, no PR/MR exists, the platform is unrecognized, or comment posting fails.

### Key Entities

- **EffortLevel**: One of `low`, `medium`, `high`, `max` — controls agent count and confidence threshold.
- **ReviewAgent**: A parallel subagent assigned a review dimension (bug scan, compliance, history, reuse, efficiency). Receives the full diff.
- **ScoringAgent**: An independent subagent that assigns a 0–100 confidence score to a single finding using a fixed rubric.
- **Finding**: A reported issue with description, optional AGENTS.md citation, file, and line range.
- **ConfidenceScore**: Integer 0–100 with fixed rubric anchors at 0, 25, 50, 75, 100.
- **Platform**: Detected repository platform — `github` or `gitlab` or `unknown` (inferred from remote URL).
- **CommentTarget**: The PR or MR that receives the review comment, if a CLI is available and a PR/MR exists.

### Assumptions

- The skill is implemented as a builtin skill under `packages/agent-sdk/builtin/skills/code-review/SKILL.md`.
- The Agent tool is available to the skill (listed in `allowed-tools`) for launching parallel review/scoring subagents.
- `$ARGUMENTS` substitution is handled by the existing skill parameter system (spec 006).
- Bash command execution (`!`git diff``) is handled by the existing skill bash substitution system (spec 006).

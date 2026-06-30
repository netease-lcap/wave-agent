# Feature Specification: Simplify Skill

**Feature Branch**: `059-simplify-skill`
**Created**: 2026-06-29

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Review and Apply Quality Cleanups (Priority: P1)

As a developer, I want to review my changed code for reuse opportunities, quality issues, and efficiency problems, and have the fixes applied automatically, so I can keep my code clean without manually hunting for improvements.

**Why this priority**: This is the core value — review + auto-fix in one step. It complements `/code-review` (which reports bugs only) by focusing on quality and applying fixes.

**Independent Test**: Make a change with an obvious duplication or inefficiency, run `/simplify`, and verify the issue is fixed in the working tree.

**Acceptance Scenarios**:

1. **Given** there are git changes (staged or unstaged), **When** the user runs `/simplify`, **Then** the skill gathers the diff via `git diff` (or `git diff HEAD` for staged changes) and reviews all changed files.
2. **Given** there are no git changes, **When** the user runs `/simplify`, **Then** the skill reviews the most recently modified files that the user mentioned or that the agent edited earlier in the conversation.
3. **Given** quality issues are found, **When** Phase 3 executes, **Then** the skill fixes each issue directly in the code.
4. **Given** a finding is a false positive or not worth addressing, **When** the skill evaluates it, **Then** it notes it and moves on without arguing.

---

### User Story 2 - Parallel Three-Dimension Quality Review (Priority: P2)

As a developer, I want the review to cover three independent quality dimensions — code reuse, code quality, and efficiency — in parallel, so I get comprehensive coverage with low latency.

**Why this priority**: Parallel review reduces latency and gives each dimension a focused context. The three dimensions cover the most common quality degradation patterns.

**Independent Test**: Make a change with a reuse issue (duplicating an existing utility), a quality issue (copy-paste code), and an efficiency issue (sequential calls that could be parallel), run `/simplify`, and verify all three are fixed.

**Acceptance Scenarios**:

1. **Given** the skill enters Phase 2, **When** it executes, **Then** it launches three agents concurrently in a single message, each receiving the full diff.
2. **Given** the Code Reuse agent runs, **When** it reviews the changes, **Then** it searches for existing utilities/helpers that could replace newly written code and flags duplicates and inline logic that could use existing utilities.
3. **Given** the Code Quality agent runs, **When** it reviews the changes, **Then** it flags redundant state, parameter sprawl, copy-paste with variation, leaky abstractions, stringly-typed code, unnecessary JSX nesting, and unnecessary comments.
4. **Given** the Efficiency agent runs, **When** it reviews the changes, **Then** it flags unnecessary work, missed concurrency, hot-path bloat, recurring no-op updates, unnecessary existence checks, memory issues, and overly broad operations.

---

### User Story 3 - Bug-Free Quality Focus (Priority: P2)

As a developer, I want `/simplify` to focus on quality only and not hunt for bugs, so I can use it as a fast cleanup pass separate from a full bug review.

**Why this priority**: Separating concerns (quality vs. correctness) lets developers run the right tool for the job. Bug hunting requires a different, more careful review (provided by `/code-review`).

**Independent Test**: Run `/simplify` on a change containing a subtle bug; verify the skill does not report the bug (it focuses on quality). Then run `/code-review` and verify the bug is caught.

**Acceptance Scenarios**:

1. **Given** the skill description states "Quality only — it does not hunt for bugs; use /code-review for that", **When** the skill executes, **Then** the review agents focus on reuse/quality/efficiency, not correctness bugs.
2. **Given** a developer wants a bug review, **When** they run `/code-review` instead, **Then** bugs are reported.

---

### Edge Cases

- **What happens if no git changes exist and no files were recently edited?** The skill reviews the most recently modified files the user mentioned or that the agent edited earlier. If none can be identified, the skill has nothing to review.
- **What happens if the three agents produce conflicting fixes?** Phase 3 aggregates findings and fixes each issue directly; conflicts are resolved by the main agent applying fixes sequentially.
- **What if a fix introduces a new issue?** The skill does not re-review after fixing; it applies fixes and summarizes. A subsequent `/simplify` or `/code-review` can catch regressions.
- **What if the AI tries to auto-trigger the skill?** `disable-model-invocation: true` in the frontmatter prevents autonomous invocation; it is user-invoked only via `/simplify`.
- **What if a finding is a false positive?** The skill notes it and moves on — it does not argue with the finding, just skips it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a builtin `simplify` skill invoked via `/simplify`.
- **FR-002**: Skill MUST gather changes via `git diff`, or `git diff HEAD` if there are staged changes.
- **FR-003**: Skill MUST fall back to reviewing the most recently modified files (mentioned by user or edited by the agent earlier) when there are no git changes.
- **FR-004**: Skill MUST launch three review agents concurrently in a single message, each receiving the full diff.
- **FR-005**: Skill MUST include a Code Reuse Review agent that searches for existing utilities/helpers and flags duplicates and inline logic replaceable by existing utilities.
- **FR-006**: Skill MUST include a Code Quality Review agent that flags: redundant state, parameter sprawl, copy-paste with variation, leaky abstractions, stringly-typed code, unnecessary JSX nesting, and unnecessary comments (keeping only non-obvious WHY comments).
- **FR-007**: Skill MUST include an Efficiency Review agent that flags: unnecessary work, missed concurrency, hot-path bloat, recurring no-op updates (including same-reference-return violations), unnecessary existence checks (TOCTOU), memory issues (unbounded structures, missing cleanup, listener leaks), and overly broad operations.
- **FR-008**: Skill MUST wait for all three agents to complete before fixing.
- **FR-009**: Skill MUST aggregate findings and fix each issue directly in Phase 3.
- **FR-010**: Skill MUST skip false positives or not-worth-addressing findings without arguing.
- **FR-011**: Skill MUST summarize what was fixed (or confirm the code was already clean) when done.
- **FR-012**: Skill MUST set `disable-model-invocation: true` so the AI cannot auto-trigger it.
- **FR-013**: Skill MUST be quality-focused only — it MUST NOT hunt for correctness bugs (use `/code-review` for that).
- **FR-014**: Skill description MUST state "Quality only — it does not hunt for bugs; use /code-review for that."

### Key Entities

- **ReviewAgent**: A parallel subagent assigned a quality dimension (reuse, quality, efficiency). Receives the full diff.
- **Finding**: A quality issue identified by a review agent, to be fixed in Phase 3.
- **Fix**: A direct code change applied by the main agent to resolve a finding.

### Assumptions

- The skill is implemented as a builtin skill under `packages/agent-sdk/builtin/skills/simplify/SKILL.md`.
- The Agent tool is available to the skill for launching parallel review subagents.
- The skill can edit files directly (Write/Edit tools) to apply fixes.
- `disable-model-invocation: true` is handled by the existing skill system (spec 006).

# Implementation Plan: Code Review Skill

**Branch**: `058-code-review-skill` | **Status**: Complete | **Date**: 2026-06-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/058-code-review-skill/spec.md`

## Summary

Add a builtin `/code-review` skill that reviews the current branch's diff for correctness bugs and quality issues. Uses `git diff` (no `gh` dependency for diff gathering) so it works with any git host. Configurable effort level (low/medium/high/max) controls agent count and confidence threshold. Launches parallel review agents across independent dimensions (bugs, AGENTS.md compliance, git history, code reuse, efficiency), then scores each finding with an independent agent before filtering. Delivery is comment-first: posts the review as a PR/MR comment via `gh`/`glab` when available, falling back to direct terminal output when no CLI or PR/MR exists. Does not auto-fix. Sets `disable-model-invocation: true` to prevent AI auto-triggering.

## Technical Context

**Language/Version**: Markdown skill definition (SKILL.md) + YAML frontmatter
**Primary Dependencies**: Existing skill system (spec 006), Agent tool (spec 009/041), Bash skill substitution (spec 006)
**Testing**: Manual invocation + verification of report format and finding filtering
**Target Platform**: Linux/macOS/Windows (any environment with git)
**Project Type**: Monorepo (agent-sdk builtin skills)
**Constraints**: Must work without `gh` CLI or GitHub auth; must not auto-trigger; must not attempt build/typecheck
**Scale/Scope**: Single SKILL.md file; no source code changes outside builtin skills directory

## Constitution Check

1. **Package-First Architecture**: Skill lives in `agent-sdk/builtin/skills/`. Pass.
2. **TypeScript Excellence**: N/A — pure markdown skill, no TypeScript. Pass.
3. **Test Alignment**: Manual verification scenarios defined in quickstart.md. Pass.
4. **Build Dependencies**: No build step required for skill markdown. Pass.
5. **Documentation Minimalism**: No extra .md files beyond spec/plan/research/data-model/quickstart/contracts/checklists. Pass.
6. **Quality Gates**: N/A — no TypeScript to lint. Pass.
7. **Source Code Structure**: `builtin/skills/code-review/SKILL.md`. Pass.
8. **Data Model Minimalism**: Effort mapping, agent definitions, rubric — simple data structures. Pass.

## Project Structure

### Documentation (this feature)

```
specs/058-code-review-skill/
├── plan.md              # This file
├── research.md          # Decision rationale
├── data-model.md        # Effort mapping, agent/rubric/finding models
├── quickstart.md        # Usage examples
├── contracts/           # API contracts
│   └── code-review.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Implementation tasks
```

### Source Code (repository root)

```
packages/
└── agent-sdk/
    └── builtin/
        └── skills/
            └── code-review/
                └── SKILL.md     # Skill definition with frontmatter + 5 phases
```

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 5 effort levels with fixed agent counts | Predictable cost/coverage tradeoff | Continuous threshold arg rejected — users think in discrete tiers |
| Independent scoring agent per finding | Filters false positives from biased reviewers | Self-reported score rejected — same-context bias |

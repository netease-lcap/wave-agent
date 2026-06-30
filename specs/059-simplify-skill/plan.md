# Implementation Plan: Simplify Skill

**Branch**: `059-simplify-skill` | **Status**: Complete | **Date**: 2026-06-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/059-simplify-skill/spec.md`

## Summary

Add a builtin `/simplify` skill that reviews changed code for reuse, quality, and efficiency issues, then applies fixes directly. Three parallel review agents (reuse/quality/efficiency) each receive the full diff. Uses `git diff` (or `git diff HEAD` for staged changes) with fallback to recently-modified files when no git changes exist. Quality-only — does not hunt for bugs (use `/code-review` for that). Sets `disable-model-invocation: true` to prevent AI auto-triggering.

## Technical Context

**Language/Version**: Markdown skill definition (SKILL.md) + YAML frontmatter
**Primary Dependencies**: Existing skill system (spec 006), Agent tool (spec 009/041), Write/Edit tools
**Testing**: Manual invocation + verification of applied fixes
**Target Platform**: Linux/macOS/Windows (any environment with git)
**Project Type**: Monorepo (agent-sdk builtin skills)
**Constraints**: Must work without `gh` CLI; must not auto-trigger; must not hunt for bugs; quality fixes only
**Scale/Scope**: Single SKILL.md file; no source code changes outside builtin skills directory

## Constitution Check

1. **Package-First Architecture**: Skill lives in `agent-sdk/builtin/skills/`. Pass.
2. **TypeScript Excellence**: N/A — pure markdown skill, no TypeScript. Pass.
3. **Test Alignment**: Manual verification scenarios defined in quickstart.md. Pass.
4. **Build Dependencies**: No build step required for skill markdown. Pass.
5. **Documentation Minimalism**: No extra .md files beyond spec/plan/research/data-model/quickstart/contracts/checklists. Pass.
6. **Quality Gates**: N/A — no TypeScript to lint. Pass.
7. **Source Code Structure**: `builtin/skills/simplify/SKILL.md`. Pass.
8. **Data Model Minimalism**: Three agent dimensions + checklists — simple data structures. Pass.

## Project Structure

### Documentation (this feature)

```
specs/059-simplify-skill/
├── plan.md              # This file
├── research.md          # Decision rationale
├── data-model.md        # Agent dimensions, quality/efficiency checklists
├── quickstart.md        # Usage examples
├── contracts/           # API contracts
│   └── simplify.md
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
            └── simplify/
                └── SKILL.md     # Skill definition with frontmatter + 3 phases
```

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Three parallel agents (not one) | Independent dimensions need focused context | Single agent rejected — context dilution, shallower coverage |
| Auto-fix (not report-only) | Quality fixes are low-risk; one-step workflow | Report-only rejected — duplicates `/code-review` workflow |

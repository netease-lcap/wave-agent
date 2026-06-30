# Tasks: Simplify Skill

**Input**: Design documents from `/specs/059-simplify-skill/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Manual invocation verification — no unit/integration tests required for a pure-markdown skill.

**Organization**: Tasks grouped by phase. Feature is already implemented (commit 8d13e248); tasks document the completed work.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Skill Definition

- [x] T001 [US1] Create `packages/agent-sdk/builtin/skills/simplify/SKILL.md` with frontmatter (`name`, `description`, `disable-model-invocation: true`)
- [x] T002 [US1] Implement Phase 1 (Identify Changes): `git diff` / `git diff HEAD` with fallback to recently-modified files

## Phase 2: Parallel Review Agents

- [x] T003 [US2] [P] Implement Code Reuse Review agent prompt (search existing utilities, flag duplicates, flag inline logic)
- [x] T004 [US2] [P] Implement Code Quality Review agent prompt (redundant state, parameter sprawl, copy-paste, leaky abstractions, stringly-typed, JSX nesting, comments)
- [x] T005 [US2] [P] Implement Efficiency Review agent prompt (unnecessary work, missed concurrency, hot-path bloat, no-op updates, TOCTOU, memory, broad operations)
- [x] T006 [US2] Instruct launching all three agents concurrently in a single message with full diff

## Phase 3: Fix Issues

- [x] T007 [US1] Implement Phase 3: wait for all agents, aggregate findings, fix each issue directly
- [x] T008 [US1] Implement false-positive skipping (note and move on, do not argue)
- [x] T009 [US1] Implement summary output (what was fixed or code was already clean)

## Phase 4: Polish

- [x] T010 [US3] Ensure description states "Quality only — it does not hunt for bugs; use /code-review for that"
- [x] T011 [US3] Verify no bug-hunting instructions in any agent prompt

## Dependencies & Execution Order

- T001 → T002 (sequential: frontmatter then Phase 1)
- T003, T004, T005 (review agents: parallel, independent prompts)
- T006 depends on T003–T005 (launch instruction after agents defined)
- T007, T008, T009 (fix phase: sequential)
- T010, T011 (polish: parallel)

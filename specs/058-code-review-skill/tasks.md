# Tasks: Code Review Skill

**Input**: Design documents from `/specs/058-code-review-skill/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Manual invocation verification — no unit/integration tests required for a pure-markdown skill.

**Organization**: Tasks grouped by phase. Feature is already implemented (commit 8d13e248); tasks document the completed work.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Phase 1: Skill Definition

- [x] T001 [US1] Create `packages/agent-sdk/builtin/skills/code-review/SKILL.md` with frontmatter (`name`, `description`, `allowed-tools`, `disable-model-invocation: true`)
- [x] T002 [US1] Implement Phase 1 (Gather Context): bash commands for `git status`, `git diff --name-only`, `git log`, `git diff` with merge-base fallback to `HEAD~1`
- [x] T003 [US1] Implement early-stop when no changes exist

## Phase 2: Effort Level

- [x] T004 [US2] Implement Phase 2 (Determine Effort Level): parse `$ARGUMENTS` for low/medium/high/max with default `medium`
- [x] T005 [US2] Map each effort level to agent count + confidence threshold (low→2/90, medium→3/80, high→4/70, max→5/60)

## Phase 3: Parallel Review Agents

- [x] T006 [US3] [P] Implement Bug Scanner agent prompt (all effort levels)
- [x] T007 [US4] [P] Implement AGENTS.md Compliance agent prompt (all effort levels)
- [x] T008 [US3] [P] Implement Git History Context agent prompt (medium+)
- [x] T009 [US3] [P] Implement Code Reuse & Quality agent prompt (high+)
- [x] T010 [US3] [P] Implement Efficiency Review agent prompt (max only)
- [x] T011 [US3] Instruct launching all agents concurrently in a single message with full diff

## Phase 4: Confidence Scoring

- [x] T012 [US3] Implement Phase 4: launch parallel scoring agent per finding
- [x] T013 [US3] Embed the fixed 0/25/50/75/100 rubric verbatim in the scoring agent prompt

## Phase 5: Filter and Deliver

- [x] T014 [US3] Implement filtering by confidence threshold
- [x] T015 [US1] Implement "no issues" early-stop (no comment, no terminal output)
- [x] T016 [US1] Implement the numbered report format with `<file>:<line range>` citations
- [x] T017 [US5] Add `Bash(git remote:*)`, `Bash(command -v:*)`, `Bash(gh pr comment:*)`, `Bash(gh pr view:*)`, `Bash(glab mr note:*)`, `Bash(glab mr view:*)` to `allowed-tools` in frontmatter
- [x] T018 [US5] Implement platform detection via `git remote get-url origin`
- [x] T019 [US5] Implement CLI detection via `command -v gh` / `command -v glab`
- [x] T020 [US5] Implement comment-first delivery: post via `gh pr comment --body` / `glab mr note --message` when CLI + PR/MR exists, do NOT output to terminal
- [x] T021 [US5] Implement terminal fallback: output directly when no CLI, no PR/MR, unrecognized platform, or posting fails

## Phase 6: Polish

- [x] T022 [US1] Add False Positive Filtering guidance section
- [x] T023 [US1] Add Notes section (no build/typecheck, cite file+lines, make todo list first)
- [x] T024 [P] Add `$ARGUMENTS` input section at end of SKILL.md

## Dependencies & Execution Order

- T001 → T002 → T003 (sequential: frontmatter then phases)
- T004, T005 (effort level: sequential parse then map)
- T006–T011 (review agents: parallel, independent prompts)
- T012, T013 (scoring: sequential)
- T014 → T015 (filter then early-stop)
- T017 → T018, T019 (frontmatter update before detection logic)
- T020, T021 (delivery: comment-first then fallback — mutually exclusive paths)
- T016 (report format: shared by both delivery paths)
- T022, T023, T024 (polish: parallel)

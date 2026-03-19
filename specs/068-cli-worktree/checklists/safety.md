# Requirements Quality Checklist: CLI Worktree Safety & Robustness

**Purpose**: Validate the quality, clarity, and completeness of requirements for the CLI Worktree Support feature, focusing on safety and data integrity.
**Created**: 2026-02-27
**Feature**: [../spec.md]
**Audience**: Formal Review Gate (PR)

## Requirement Completeness

- [x] CHK001 - Are the exact git commands for worktree creation and removal explicitly specified? [Completeness, Spec §FR-003, §FR-011]
- [x] CHK002 - Is the "default remote branch" identification logic defined (e.g., `origin/HEAD`)? [Completeness, Spec §FR-003]
- [x] CHK003 - Are the criteria for "uncommitted changes" (staged vs. unstaged) explicitly defined? [Completeness, Spec §FR-006]
- [x] CHK004 - Is the behavior for "Remove worktree" defined when the branch has been merged elsewhere? [Gap]
- [x] CHK005 - Are requirements defined for handling existing worktrees with the same name? [Completeness, Spec §Edge Cases]

## Requirement Clarity

- [x] CHK006 - Is "delete the associated branch" quantified (e.g., `git branch -D` vs `-d`)? [Clarity, Spec §FR-011]
- [x] CHK007 - Is the "worktree path" defined as absolute or relative to the repo root? [Clarity, Spec §FR-003]
- [x] CHK008 - Is the "auto-generated name" pattern `adjective-adjective-noun` explicitly documented as the source of truth? [Clarity, Spec §FR-002]
- [x] CHK009 - Is "pass the worktree path" clarified as an explicit parameter to the agent and utilities? [Clarity, Spec §FR-005]

## Requirement Consistency

- [x] CHK010 - Do the exit prompt options "Keep worktree" and "Remove worktree" align with the functional requirements for state cleanup? [Consistency, Spec §FR-009, §FR-011]
- [x] CHK011 - Is the branch naming convention `worktree-<name>` consistent across all creation and deletion requirements? [Consistency, Spec §FR-004, §FR-011]
- [x] CHK012 - Does the "Clean Exit" requirement conflict with any potential background task cleanup? [Consistency, Spec §FR-012]

## Acceptance Criteria Quality

- [x] CHK013 - Are the success criteria for "Remove worktree" measurable (e.g., directory is gone, branch is gone)? [Acceptance Criteria, Spec §User Story 3]
- [x] CHK014 - Can the detection of "new commits" be objectively verified with a specific git command? [Measurability, Spec §FR-007]
- [x] CHK015 - Is the "immediate exit" behavior for clean sessions testable without manual intervention? [Acceptance Criteria, Spec §User Story 5]

## Scenario Coverage

- [x] CHK016 - Are requirements defined for the scenario where the user cancels the exit prompt (Esc)? [Coverage, Spec §Input]
- [x] CHK017 - Is the "Resume session" scenario (re-running with same name) fully specified in the functional requirements? [Coverage, Gap]
- [x] CHK018 - Are requirements defined for handling `SIGINT` (Ctrl+C) vs `SIGTERM` or other exit signals? [Coverage, Gap]

## Edge Case Coverage

- [x] CHK019 - Does the spec define what happens if `git worktree add` fails (e.g., branch already exists)? [Edge Case, Spec §Edge Cases]
- [x] CHK020 - Is the behavior specified for when the `.wave/worktrees/` parent directory is missing or unwritable? [Edge Case, Gap]
- [x] CHK021 - Are requirements defined for handling worktree removal when files are locked by another process? [Edge Case, Gap]

## Non-Functional Requirements

- [x] CHK022 - Are performance requirements defined for the "Exit Detection" phase to avoid noticeable lag? [Gap]
- [x] CHK023 - Is the "Safety" requirement for data loss prevention quantified with specific warning messages? [Clarity, Spec §User Story 3]

## Dependencies & Assumptions

- [x] CHK024 - Is the assumption that `git` is installed and in the PATH validated as a prerequisite? [Assumption, Spec §Assumptions]
- [x] CHK025 - Is the dependency on the `generateRandomName` utility explicitly documented? [Dependency, Research]
- [x] CHK026 - Is the auto-deny mechanism for main repository modifications during worktree sessions specified? [Safety, Spec §FR-021]
- [x] CHK027 - Does the auto-deny mechanism allow modifications to the plan file? [Safety, Spec §FR-023]

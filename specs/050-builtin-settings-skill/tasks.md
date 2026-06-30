# Tasks: Builtin Settings Skill

**Feature**: Builtin Settings Skill
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

## Implementation Strategy

The implementation will follow an incremental approach, starting with the infrastructure to support builtin skills, followed by the implementation of the `settings` skill itself. Each user story will be implemented as a complete, independently testable increment.

1.  **Infrastructure**: Update `SkillManager` and `configPaths` to support a new `builtin` skill scope.
2.  **Skill Content**: Create the `settings` skill markdown and associated documentation.
3.  **Validation**: Ensure the skill correctly guides the user and validates configuration changes.

## Phase 1: Setup

Goal: Initialize the builtin skills directory and update configuration paths.

- [x] T001 Create the builtin skills directory at `packages/agent-sdk/src/builtin-skills`
- [x] T002 [P] Add `getBuiltinSkillsDir` to `packages/agent-sdk/src/utils/configPaths.ts` to resolve the builtin skills path
- [x] T003 [P] Update `ConfigurationPaths` interface in `packages/agent-sdk/src/types/configuration.ts` to include `builtinPaths`

## Phase 2: Foundational

Goal: Update `SkillManager` and related types to support `builtin` skills.

- [x] T004 Update `SkillMetadata` and `SkillCollection` types in `packages/agent-sdk/src/types/skills.ts` to include `"builtin"` type
- [x] T005 Update `SkillManager.initialize` in `packages/agent-sdk/src/managers/skillManager.ts` to discover skills from the builtin directory
- [x] T006 [P] Implement `discoverBuiltinSkills` in `packages/agent-sdk/src/managers/skillManager.ts`
- [x] T007 Update `InitializationService` in `packages/agent-sdk/src/services/initializationService.ts` to ensure builtin skills are loaded during startup
- [x] T008 Add unit tests for builtin skill discovery in `packages/agent-sdk/tests/managers/skillManager.test.ts`

## Phase 3: User Story 1 - Manage Wave Settings via Skill (Priority: P1)

Goal: Implement the `settings` skill content and ensure it can read/write settings.

- [x] T009 [US1] Create the `settings` skill directory at `packages/agent-sdk/src/builtin-skills/settings`
- [x] T010 [US1] Create the initial `SKILL.md` for the `settings` skill in `packages/agent-sdk/src/builtin-skills/settings/SKILL.md`
- [x] T011 [US1] Implement the core logic in `SKILL.md` to view current settings using `Read` and `Bash` tools
- [x] T012 [US1] Implement the logic in `SKILL.md` to update settings using `Write` and `Bash` tools
- [x] T013 [US1] Add integration tests to verify the `settings` skill can read and update settings in `packages/agent-sdk/tests/services/configurationService.test.ts`

**Independent Test**: Run `/settings` and verify it displays current settings and can update a simple setting like `language`.

## Phase 4: User Story 2 - Guidance on Writing settings.json (Priority: P2)

Goal: Add detailed guidance and examples to the `settings` skill.

- [x] T014 [US2] Update `SKILL.md` in `packages/agent-sdk/src/builtin-skills/settings/SKILL.md` to include a comprehensive guide on all `settings.json` fields, including MCP and memory rules.
- [x] T015 [US2] Add examples for each configuration field (hooks, env, permissions, MCP, memory rules) in `SKILL.md` and associated documentation.
- [x] T016 [US2] Implement validation logic within the skill instructions to ensure users provide valid JSON and values

**Independent Test**: Invoke the `settings` skill and ask for help on a specific field (e.g., "How do I configure permissions?"). Verify the output is clear and accurate.

## Phase 5: User Story 3 - Documentation for Complex Hooks (Priority: P3)

Goal: Create `HOOKS.md` and link it from `SKILL.md`.

- [x] T017 [US3] Create `HOOKS.md` with detailed documentation for complex hook configurations in `packages/agent-sdk/src/builtin-skills/settings/HOOKS.md`
- [x] T018 [US3] Add a link to `HOOKS.md` in `SKILL.md` using the `${WAVE_SKILL_DIR}` placeholder
- [x] T019 [US3] Verify the link works correctly when the skill is invoked
- [x] T024 [US3] Create `MCP.md` and `MEMORY_RULES.md` and link them from `SKILL.md`
- [x] T025 [US3] Update `SKILL.md` description to help agent know when to use it

**Independent Test**: Read the `SKILL.md` for the settings skill and verify the link to `HOOKS.md` is present and accessible.

## Phase 6: Polish & Cross-cutting Concerns

Goal: Final validation, linting, and type-checking.

- [x] T020 Run `pnpm run type-check` in `packages/agent-sdk` to ensure no type errors
- [x] T021 Run `pnpm run lint` in `packages/agent-sdk` to ensure code quality
- [x] T022 Run `pnpm test:coverage` in `packages/agent-sdk` to ensure test coverage is maintained or improved
- [x] T023 Perform a final manual end-to-end test of the `settings` skill in a real project environment

## Dependencies

- Phase 2 depends on Phase 1.
- Phase 3 depends on Phase 2.
- Phase 4 depends on Phase 3.
- Phase 5 depends on Phase 3.
- Phase 6 depends on all previous phases.

## Parallel Execution Examples

### User Story 1 (US1)
- T010 and T011 can be worked on in parallel if the structure is defined.
- T013 can be started as soon as the core logic in T011/T012 is drafted.

### User Story 2 (US2)
- T014 and T015 can be worked on in parallel.

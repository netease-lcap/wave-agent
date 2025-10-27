# Implementation Plan: Wave Skills Support

**Branch**: `003-wave-skills-support` | **Date**: 2024-12-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-wave-skills-support/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implement Wave Skills support - a system that allows users to package expertise into discoverable capabilities. Skills consist of SKILL.md files with YAML frontmatter containing name and description, plus optional supporting files. The system must autonomously decide when to invoke skills based on user requests and skill descriptions. This includes creating a new Skill tool that reuses the existing markdown meta parser from custom commands, supports both personal (~/.wave/skills/) and project (.wave/skills/) skills, and enables progressive loading of supporting resources.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript with strict type checking (existing project standard)  
**Primary Dependencies**: Existing agent-sdk markdownParser, filesystem operations, existing tool plugin system  
**Storage**: File-based storage (~/.wave/skills/ and .wave/skills/ directories)  
**Testing**: Vitest (existing project standard), separate unit tests in tests/ and integration tests in examples/  
**Target Platform**: Node.js (existing agent-sdk platform)
**Project Type**: Monorepo package extension - adding new tool to existing agent-sdk package  
**Performance Goals**: <500ms skill evaluation time, instant skill discovery on startup  
**Constraints**: Reuse existing markdown parser, maintain package-first architecture, zero breaking changes to existing API  
**Scale/Scope**: Support hundreds of skills per user, graceful handling of malformed skills, efficient file watching for skill updates

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

✅ **Package-First Architecture**: Adding Skill tool to existing agent-sdk package, no new packages needed  
✅ **TypeScript Excellence**: All new code will use strict TypeScript with comprehensive types  
✅ **Test Alignment**: Unit tests in packages/agent-sdk/tests/, integration tests in packages/agent-sdk/examples/  
✅ **Build Dependencies**: Changes only to agent-sdk, will run pnpm build after modifications  
✅ **Documentation Minimalism**: No new documentation files, only inline code documentation  
✅ **Quality Gates**: Will run pnpm run type-check and pnpm run lint after all changes

**Gate Status**: ✅ PASSED - All constitutional requirements met

**Post-Design Re-check**: ✅ PASSED
- Package structure maintains agent-sdk boundaries
- All new types follow TypeScript strict requirements  
- Test organization aligns with existing patterns
- No new dependencies beyond existing Node.js modules
- Integration preserves existing tool system architecture

## Project Structure

### Documentation (this feature)

```
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```
packages/agent-sdk/
├── src/
│   ├── tools/
│   │   ├── skillTool.ts          # New: Main Skill tool implementation
│   │   └── types.ts              # Extended: Add Skill-related types
│   ├── managers/
│   │   ├── toolManager.ts        # Modified: Register Skill tool
│   │   └── skillManager.ts       # New: Skill discovery and management
│   ├── utils/
│   │   └── markdownParser.ts     # Extended: Add skill-specific parsing
│   └── types.ts                  # Extended: Add Skill types
├── tests/
│   ├── tools/
│   │   └── skillTool.test.ts     # New: Unit tests for Skill tool
│   ├── managers/
│   │   └── skillManager.test.ts  # New: Unit tests for skill management
│   └── utils/
│       └── markdownParser.test.ts # Extended: Tests for skill parsing
└── examples/
    └── skills/
        ├── test-personal-skill/
        │   └── SKILL.md          # New: Test personal skill
        ├── test-project-skill/
        │   ├── SKILL.md          # New: Test project skill
        │   ├── reference.md      # New: Supporting documentation
        │   └── scripts/helper.py # New: Supporting script
        └── skillIntegration.ts   # New: Integration test runner
```

**Structure Decision**: Extending existing agent-sdk package structure. Adding new Skill tool alongside existing tools, new SkillManager for discovery and management, extending existing markdownParser for skill-specific parsing. Integration tests in examples/ directory with real skill structures for end-to-end testing.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |


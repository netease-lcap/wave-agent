# Implementation Plan: Set Language Setting

**Branch**: `055-set-language-setting` | **Date**: 2026-01-30 | **Spec**: [/specs/055-set-language-setting/spec.md](./spec.md)
**Input**: Feature specification from `/specs/055-set-language-setting/spec.md`

## Summary

Support setting a preferred language in `settings.json` and injecting a language instruction into the system prompt. This ensures the agent communicates in the user's preferred language while maintaining technical terms in their original form.

## Technical Context

- **Language/Version**: TypeScript 5.x
- **Primary Dependencies**: `openai`, `agent-sdk`
- **Storage**: `settings.json`, `settings.local.json` (file-based configuration)
- **Testing**: Vitest
- **Target Platform**: CLI / Node.js
- **Project Type**: Monorepo (agent-sdk, code)
- **Performance Goals**: Minimal overhead on prompt construction.
- **Constraints**: No language prompt is added if not specified.
- **Language Resolution**: Priority: `AgentOptions` > `settings.json` > `undefined`.
- **Prompt Injection**: Only occurs if a language is explicitly configured.
- **Scale/Scope**: Affects all agent communications.

## Constitution Check

| Principle | Status | Justification |
|-----------|--------|---------------|
| I. Package-First Architecture | ✅ | Changes are within `agent-sdk` and follow existing patterns. |
| II. TypeScript Excellence | ✅ | All new fields and methods will be strictly typed. |
| III. Test Alignment | ✅ | Unit tests for `ConfigurationService` and integration tests for `AIManager` prompt injection will be added. |
| IV. Build Dependencies | ✅ | `pnpm build` will be run after modifying `agent-sdk`. |
| V. Documentation Minimalism | ✅ | No unnecessary markdown docs created. |
| VI. Quality Gates | ✅ | `pnpm run type-check` and `pnpm lint` will be run. |
| VII. Source Code Structure | ✅ | Logic added to appropriate managers and services. |
| VIII. Test-Driven Development | ✅ | Tests will be written to verify language resolution and prompt injection. |
| IX. Type System Evolution | ✅ | Existing `WaveConfiguration` and `AgentOptions` will be evolved. |
| X. Data Model Minimalism | ✅ | Only a single `language` field is added. |

## Project Structure

### Documentation (this feature)

```
specs/055-set-language-setting/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── configuration-api.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── agent.ts         # Update AgentOptions and initialization
│   ├── managers/
│   │   └── aiManager.ts # Inject language instruction into system prompt
│   ├── services/
│   │   └── configurationService.ts # Resolve language from settings/env
│   ├── types/
│   │   └── configuration.ts # Add language field to WaveConfiguration
│   └── constants/
│       └── prompts.ts   # (Optional) Add language prompt template
└── tests/
    ├── services/
    │   └── configurationService.test.ts
    └── managers/
        └── aiManager.test.ts
```

**Structure Decision**: Single project (agent-sdk) with updates to existing managers and services.

## Complexity Tracking

*No violations detected.*

## Gates

- [x] **Type Safety**: All changes must pass `pnpm run type-check`.
- [x] **Testing**: New functionality must be covered by unit and integration tests.
- [x] **Backward Compatibility**: No language prompt is added if not specified.

# Implementation Plan: Configurable Max Output Tokens for Agent

**Branch**: `040-agent-max-tokens` | **Date**: 2026-01-08 | **Spec**: [/specs/040-agent-max-tokens/spec.md](spec.md)
**Input**: Feature specification from `/specs/040-agent-max-tokens/spec.md`

## Summary

The primary requirement is to allow users to configure the maximum number of output tokens for the agent. This will be supported through `Agent.create` options, a direct argument in `callAgent`, and the `WAVE_MAX_OUTPUT_TOKENS` environment variable, with a default of 4096. The technical approach involves extending the `AgentOptions` and `CallAgentOptions` interfaces, updating the `ConfigurationService` to handle the new environment variable, and passing the resolved value to the OpenAI client in `aiService.ts`.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: `openai` SDK, `agent-sdk` internal services (`ConfigurationService`, `AIManager`)
**Storage**: N/A
**Testing**: Vitest
**Target Platform**: Node.js
**Project Type**: Monorepo (agent-sdk package)
**Performance Goals**: N/A
**Constraints**: Must maintain backward compatibility and follow existing configuration patterns.
**Scale/Scope**: Small; modifying existing interfaces and service logic.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Package-First Architecture**: Yes, changes are confined to `agent-sdk`.
- **TypeScript Excellence**: Yes, using strict types for new options.
- **Test Alignment**: Yes, adding unit tests in `packages/agent-sdk/tests`.
- **Build Dependencies**: Yes, will run `pnpm build` after modifying `agent-sdk`.
- **Documentation Minimalism**: Yes, only creating required spec/plan files.
- **Quality Gates**: Yes, will run `pnpm run type-check` and `pnpm lint`.
- **Source Code Structure**: Yes, modifying `aiService.ts`, `agent.ts`, and `configurationService.ts`.
- **Test-Driven Development**: Yes, will write tests for the new functionality.
- **Type System Evolution**: Yes, extending existing interfaces (`AgentOptions`, `CallAgentOptions`).
- **Data Model Minimalism**: Yes, only adding `maxTokens` field.

## Project Structure

### Documentation (this feature)

```
specs/040-agent-max-tokens/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── checklists/
│   └── requirements.md
└── spec.md
```

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── services/
│   │   ├── aiService.ts            # Update callAgent to use maxTokens
│   │   └── configurationService.ts # Handle WAVE_MAX_OUTPUT_TOKENS
│   ├── agent.ts                    # Update AgentOptions and Agent class
│   ├── types.ts                    # Update CallAgentOptions
│   └── aiManager.ts                # Pass maxTokens to aiService
└── tests/
    └── services/
        └── aiService.test.ts       # Add tests for maxTokens
```

**Structure Decision**: Modifying existing files in `packages/agent-sdk` to integrate the new configuration option.

# Implementation Plan: Agent Configuration

**Branch**: `007-agent-config` | **Date**: 2025-01-27 | **Spec**: [spec.md](spec.md)

## Summary

Consolidate all agent-level configuration into a unified system that supports explicit constructor parameters, environment variable fallbacks, and built-in defaults. This includes AI gateway settings, model selection, token limits (input and output), custom HTTP headers, and language preferences. The goal is to remove direct `process.env` access from services and managers, moving configuration resolution to the `Agent` level.

## Technical Context

- **Language/Version**: TypeScript
- **Primary Dependencies**: Node.js `process.env`, `agent-sdk` internal services
- **Testing**: Vitest
- **Target Platform**: Node.js runtime environment
- **Project Type**: Monorepo package enhancement (`agent-sdk`)

## Constitution Check

✅ **I. Package-First Architecture**: Enhanced existing `agent-sdk` package, maintained clear boundaries.
✅ **II. TypeScript Excellence**: Used strict TypeScript with existing interfaces, no `any` types.
✅ **III. Test Alignment**: Planned tests in `packages/agent-sdk/tests/` following TDD principles.
✅ **IV. Build Dependencies**: Will run `pnpm build` after `agent-sdk` modifications.
✅ **V. Documentation Minimalism**: Created only required planning docs.
✅ **VI. Quality Gates**: Plan includes type-check and lint validation steps.
✅ **VII. Source Code Structure**: Following established `agent-sdk` patterns.
✅ **VIII. Test-Driven Development**: Designed with TDD workflow.
✅ **IX. Type System Evolution**: Extended existing interfaces, avoided new type creation where possible.

## Project Structure

### Documentation (this feature)

```
specs/007-agent-config/
├── plan.md              # This file
├── research.md          # Technical decisions
├── data-model.md        # Configuration entities and resolution logic
├── quickstart.md        # Usage examples
├── contracts/           # Interface definitions
└── tasks.md             # Implementation tasks
```

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── agent.ts             # Agent class and AgentOptions
│   ├── types.ts             # Configuration interfaces and errors
│   ├── managers/
│   │   └── aiManager.ts     # AI management with injected config
│   ├── services/
│   │   ├── aiService.ts     # AI service with injected config
│   │   └── configurationService.ts # Configuration resolution
│   └── utils/
│       ├── configResolver.ts # Resolution utilities
│       ├── configValidator.ts # Validation utilities
│       └── stringUtils.ts    # Header parsing
└── tests/
    ├── agent/
    │   └── agent.config.test.ts # Configuration tests
    ├── services/
    │   └── aiService.test.ts # Service tests with config
    └── managers/
        └── aiManager.test.ts # Manager tests with config
```

## Implementation Phases

1. **Phase 1: Setup & Foundational**: Define interfaces, resolution utilities, and validation logic.
2. **Phase 2: Core Configuration**: Implement gateway, model, and token limit configuration in `Agent`, `AIManager`, and `AIService`.
3. **Phase 3: Advanced Configuration**: Add support for custom headers and language settings.
4. **Phase 4: Polish & Validation**: Comprehensive testing, type-checking, and linting.

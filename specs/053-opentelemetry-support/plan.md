# Implementation Plan: OpenTelemetry Support

**Branch**: `053-opentelemetry-support` | **Date**: 2026-01-23 | **Spec**: [/specs/053-opentelemetry-support/spec.md](./spec.md)
**Input**: Feature specification from `/specs/053-opentelemetry-support/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

The primary requirement is to integrate OpenTelemetry into the Wave Agent to provide observability through traces and metrics. The technical approach involves using the OpenTelemetry JS SDK to instrument core agent operations (task execution, tool calls, LLM requests) and export this data via OTLP.

## Technical Context

**Language/Version**: TypeScript (Strict mode)
**Primary Dependencies**: `@opentelemetry/api`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/sdk-metrics`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/exporter-metrics-otlp-http`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions`
**Storage**: N/A (Telemetry is exported to external collectors)
**Testing**: Vitest (Unit and Integration tests)
**Target Platform**: Node.js (Linux/macOS/Windows)
**Project Type**: Monorepo (agent-sdk and code packages)
**Performance Goals**: Minimal overhead on agent operations (<5ms per span creation/export)
**Constraints**: Must be disabled by default; no sensitive data in traces; graceful handling of collector unavailability.
**Scale/Scope**: Instrumentation of all major agent lifecycle events and tool executions.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Package-First Architecture**: Implementation will be primarily in `agent-sdk` with configuration in `code`.
- [x] **TypeScript Excellence**: Strict typing will be used for all telemetry-related code.
- [x] **Test Alignment**: Both unit and integration tests will be provided in `packages/*/tests`.
- [x] **Build Dependencies**: `pnpm build` will be run after `agent-sdk` changes.
- [x] **Documentation Minimalism**: No extra markdown docs beyond what's required by the plan.
- [x] **Quality Gates**: `pnpm run type-check` and `pnpm run lint` will be run.
- [x] **Source Code Structure**: Telemetry logic will be placed in `services` or `managers` within `agent-sdk`.
- [x] **Test-Driven Development**: Critical telemetry paths will follow TDD.
- [x] **Type System Evolution**: Existing agent types will be extended to support trace context.
- [x] **Data Model Minimalism**: Telemetry configuration and span attributes will be kept to the essential minimum.

## Project Structure

### Documentation (this feature)

```
specs/053-opentelemetry-support/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.quickstart command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   ├── src/
│   │   ├── services/
│   │   │   └── telemetryService.ts # Telemetry service implementation
│   │   ├── managers/
│   │   │   ├── aiManager.ts        # Instrumented AI calls
│   │   │   └── toolManager.ts      # Instrumented tool execution
│   │   ├── agent.ts                # Instrumented sendMessage
│   │   └── index.ts                # Export telemetry service
│   └── tests/
│       ├── unit/
│       └── integration/
└── code/
    ├── src/
    │   ├── index.ts                # Telemetry initialization
    │   └── cli.tsx                 # Graceful shutdown
    └── tests/
```

**Structure Decision**: Monorepo structure following existing package boundaries. Telemetry core in `agent-sdk`, initialization in `code`. Instrumentation will be added to `Agent`, `AIManager`, and `ToolManager`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |



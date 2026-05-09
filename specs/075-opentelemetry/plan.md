# Implementation Plan: OpenTelemetry Integration

**Branch**: `075-opentelemetry` | **Status**: Planned | **Date**: 2026-05-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/075-opentelemetry/spec.md`

## Summary

Add OpenTelemetry instrumentation to Wave following Claude Code's patterns. Three new modules: `instrumentation.ts` (SDK init + exporters), `sessionTracing.ts` (span APIs), `events.ts` (event logging). Integration into AIManager (API calls), ToolManager (tool execution), Agent (lifecycle events), and CompactionService. Configuration via standard `OTEL_*` env vars + `settings.json`. Lazy-loaded to avoid startup penalty. Graceful degradation on failures.

## Technical Context

**Language/Version**: TypeScript (Node.js)
**Primary Dependencies**: @opentelemetry/api, @opentelemetry/sdk-node, @opentelemetry/sdk-metrics, @opentelemetry/sdk-trace-node, @opentelemetry/sdk-logs, @opentelemetry/exporter-metrics-otlp-http, @opentelemetry/exporter-trace-otlp-http, @opentelemetry/exporter-logs-otlp-http
**Testing**: Vitest (Unit and Integration tests)
**Target Platform**: Linux/macOS/Windows (Node.js environment)
**Project Type**: Monorepo (agent-sdk + code)
**Constraints**: Must not block agent operation on telemetry failures; lazy-loaded to avoid startup penalty
**Scale/Scope**: Core observability infrastructure affecting agent lifecycle, API calls, and tool execution

## Constitution Check

1. **Package-First Architecture**: Logic in `agent-sdk` (telemetry module), integration points in existing managers. Pass.
2. **TypeScript Excellence**: Strict typing for all span metadata and event payloads. Pass.
3. **Test Alignment**: Mandatory unit and integration tests for each telemetry module. Pass.
4. **Build Dependencies**: `agent-sdk` must be built before `code` can use telemetry. Pass.
5. **Documentation Minimalism**: No extra .md files beyond spec/plan/research/data-model/quickstart. Pass.
6. **Quality Gates**: `type-check` and `lint` required. Pass.
7. **Source Code Structure**: `telemetry/` directory in `agent-sdk/src/`. Pass.
8. **Data Model Minimalism**: Config, span metadata, event types — simple data structures. Pass.

## Project Structure

### Documentation (this feature)

```
specs/075-opentelemetry/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── telemetry.md
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   ├── package.json                          # Add @opentelemetry/* deps
│   └── src/
│       ├── telemetry/
│       │   ├── instrumentation.ts            # SDK init, providers, exporters
│       │   ├── sessionTracing.ts             # Span APIs (interaction, LLM, tool)
│       │   └── events.ts                     # Event logging API
│       ├── types/
│       │   ├── configuration.ts              # Add monitoring.telemetry config
│       │   └── telemetry.ts                  # Type definitions
│       ├── managers/
│       │   ├── aiManager.ts                  # Wrap queryModel with spans
│       │   └── toolManager.ts                # Wrap executeTool with spans
│       ├── services/
│       │   ├── compactionService.ts          # Log compaction events
│       │   └── ...
│       └── agent.ts                          # Init/shutdown, session events
│   └── tests/
│       ├── telemetry/
│       │   ├── instrumentation.test.ts
│       │   ├── sessionTracing.test.ts
│       │   └── events.test.ts
│       └── integration/
│           └── otel-session.test.ts
└── code/
    └── src/
        └── cli.ts                            # Bootstrap telemetry on startup
```

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |

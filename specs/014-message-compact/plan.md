# Implementation Plan: Message Compact

**Branch**: `014-message-compact` | **Date**: 2026-01-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/014-message-compact/spec.md`

## Summary

Implement a history compact system in `agent-sdk` to manage token limits by automatically summarizing older messages. Includes a `/compact` slash command for manual compaction with optional custom instructions, and PreCompact/PostCompact hook events.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: agent-sdk, code (Ink, React)
**Storage**: Session history
**Testing**: Vitest
**Target Platform**: CLI (Node.js)
**Project Type**: Monorepo (agent-sdk + code)
**Performance Goals**: Efficient summarization
**Constraints**: Full history replacement for history compaction
**Scale/Scope**: Core resource management for all agent sessions

## Constitution Check

- [x] **Package-First Architecture**: History compaction in `agent-sdk`.
- [x] **TypeScript Excellence**: Strict typing for `compress` blocks, `compactConversation()` public API, custom instructions support.
- [x] **Test Alignment**: Unit tests for compaction logic, compactConversation, PreCompact/PostCompact hooks.
- [x] **Build Dependencies**: `pnpm build` required for `agent-sdk` changes.
- [x] **Quality Gates**: `type-check` and `lint` must pass.
- [x] **Test-Driven Development**: Write failing tests for token threshold detection first.
- [x] **Type System Evolution**: Use existing message block patterns.
- [x] **Data Model Minimalism**: Simple summary string.

## Project Structure

### Documentation (this feature)

```
specs/014-message-compact/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── spec.md              # Feature specification
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── agent.ts                      # Agent.compact() — /compact CLI-internal command entry point
│   ├── managers/
│   │   ├── aiManager.ts              # compactConversation(), buildPostCompactContext(), circuit breaker
│   │   └── messageManager.ts         # Compress messages, track file reads, API-round grouping
│   ├── services/
│   │   └── aiService.ts        # Compact API call, custom instructions, image stripping
│   ├── types/
│   │   └── messaging.ts        # ToolBlock timestamp field
│   ├── prompts/
│   │   └── index.ts            # COMPRESS_MESSAGES_SYSTEM_PROMPT
│   └── utils/
│       ├── groupMessagesByApiRound.ts  # API-round grouping
│       └── messageOperations.ts        # Compression logic
└── tests/
    ├── agent/
    │   ├── agent.compression.test.ts   # Compression + circuit breaker tests
    │   └── agent.coverage.test.ts
    ├── integration/
    │   └── compactionFlow.test.ts      # Full pipeline integration tests
    ├── managers/
    │   ├── messageManager.coverage.test.ts
    │   └── aiManager.compactConversation.test.ts  # compactConversation tests
    └── utils/
        └── groupMessagesByApiRound.test.ts
```

## Complexity Tracking

*No violations*

# Implementation Plan: Message Rendering System

**Branch**: `027-message-rendering-system` | **Status**: Completed | **Date**: 2026-03-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/027-message-rendering-system/spec.md`

## Summary

Implement a robust message rendering system for the Wave Agent CLI using Ink. The system will efficiently render a list of messages by splitting them into static (historical) and dynamic (active) blocks. Static blocks are rendered using Ink's `<Static>` component to optimize performance, while dynamic blocks (like running tools or streaming text) are rendered in a standard `<Box>` to allow real-time updates. The system also includes a welcome message and limits the number of rendered messages to maintain responsiveness.

## Technical Context

**Language/Version**: TypeScript (React/Ink)
**Primary Dependencies**: Ink (for CLI UI), wave-agent-sdk (for message types)
**Testing**: Vitest (Component tests)
**Target Platform**: Terminal (via Node.js)
**Project Type**: Monorepo (packages/code)
**Performance Goals**: Smooth rendering of 100+ message blocks with real-time updates for active ones.

## Constitution Check

1. **Package-First Architecture**: UI logic in `packages/code`, types in `packages/agent-sdk`. Pass.
2. **TypeScript Excellence**: Strict typing for message blocks and component props. Pass.
3. **Test Alignment**: Component tests for `MessageList` and `MessageBlockItem`. Pass.
4. **Build Dependencies**: `agent-sdk` must be built for types. Pass.
5. **Documentation Minimalism**: Follows the standard spec/plan/research structure. Pass.
6. **Quality Gates**: `type-check` and `lint` required. Pass.

## Project Structure

### Documentation (this feature)

```
specs/027-message-rendering-system/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── message-list.md
│   └── message-block-item.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   └── src/
│       └── types/
│           └── messaging.ts
└── code/
    ├── src/
    │   └── components/
    │       ├── MessageList.tsx
    │       ├── MessageBlockItem.tsx
    │       ├── Markdown.tsx
    │       ├── ToolDisplay.tsx
    │       └── ...
```

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |

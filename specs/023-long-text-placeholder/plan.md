# Implementation Plan: Long Text Placeholder

**Branch**: `023-long-text-placeholder` | **Date**: 2026-03-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/023-long-text-placeholder/spec.md`

## Summary

Implement an input compression system in `code` to keep the UI clean when pasting large amounts of text by replacing it with placeholders.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: code (Ink, React)
**Storage**: Input state
**Testing**: Vitest
**Target Platform**: CLI (Node.js)
**Project Type**: Monorepo (code)
**Performance Goals**: Responsive UI during paste
**Constraints**: 200-character threshold for input compression
**Scale/Scope**: Input management for all agent sessions

## Constitution Check

- [x] **Package-First Architecture**: Input compression in `code`.
- [x] **TypeScript Excellence**: Strict typing for `longTextMap`.
- [x] **Test Alignment**: Unit tests for placeholder handling.
- [x] **Quality Gates**: `type-check` and `lint` must pass.
- [x] **Type System Evolution**: Use existing input state patterns.
- [x] **Data Model Minimalism**: Simple placeholder map.

## Project Structure

### Documentation (this feature)

```
specs/023-long-text-placeholder/
├── plan.md              # This file
├── data-model.md        # Phase 1 output
├── spec.md              # Feature specification
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/code/
├── src/
│   └── managers/
│       └── InputManager.ts     # Handle input compression
└── tests/
    └── managers/
        └── InputManager.test.ts
```

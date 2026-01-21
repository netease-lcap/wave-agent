# Implementation Plan: Markdown Rendering System

**Branch**: `020-markdown-rendering-system` | **Date**: 2024-12-01 | **Spec**: [spec.md](./spec.md)

## Summary

Implement a robust Markdown rendering system for the Wave Agent CLI using Ink components. The system will use `marked` for parsing and provide custom renderers for block and inline elements, with a focus on terminal-friendly display and responsive tables.

## Technical Context

- **Framework**: React with Ink for terminal UI.
- **Parsing**: `marked` library for markdown lexing.
- **Styling**: Ink's `Box` and `Text` components.
- **Constraints**: Terminal width limits, limited color palette, no support for images or complex CSS.

## Constitution Check

✅ **I. Package-First Architecture**: Component resides in `packages/code` which handles the CLI UI.  
✅ **II. TypeScript Excellence**: Full type safety for props and internal rendering logic.  
✅ **III. Test Alignment**: Component is testable using `ink-testing-library`.  
✅ **IV. Build Dependencies**: Uses `marked` which is a standard dependency.  
✅ **V. Documentation Minimalism**: Focused spec files without excessive fluff.  
✅ **VI. Quality Gates**: Will pass linting and type-checking.  
✅ **VII. Source Code Structure**: Follows existing component patterns in `packages/code/src/components`.  
✅ **VIII. Test-Driven Development**: Tests will be written to verify rendering of various markdown elements.  
✅ **IX. Type System Evolution**: Uses existing `Message` and `Block` types from the SDK.

## Project Structure

### Documentation
```
specs/020-markdown-rendering-system/
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
├── plan.md
└── tasks.md
```

### Source Code
```
packages/code/src/components/
└── Markdown.tsx
```

## Implementation Strategy

1. **Setup**: Ensure `marked` is available in `packages/code`.
2. **Core Rendering**: Implement `Markdown`, `BlockRenderer`, and `InlineRenderer`.
3. **Specialized Rendering**: Implement `TableRenderer` with width calculation logic.
4. **Integration**: Use `Markdown` in `MessageItem`, `ReasoningDisplay`, and `Confirmation`.
5. **Validation**: Add unit tests for various markdown scenarios.

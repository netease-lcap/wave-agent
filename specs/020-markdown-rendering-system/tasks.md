# Tasks: Markdown Rendering System

**Input**: Design documents from `/specs/020-markdown-rendering-system/`

## Phase 1: Setup

- [x] T001 Verify `marked` dependency in `packages/code/package.json`
- [x] T002 Create `packages/code/src/components/Markdown.tsx` skeleton

## Phase 2: Inline Rendering

- [x] T003 Implement `unescapeHtml` utility for handling HTML entities
- [x] T004 Implement `InlineRenderer` for basic text styles (bold, italic, strikethrough)
- [x] T005 Implement `InlineRenderer` for codespan (inline code)
- [x] T006 Implement `InlineRenderer` for links and line breaks

## Phase 3: Block Rendering

- [x] T007 Implement `BlockRenderer` for headings (H1-H6) with color and bold styles
- [x] T008 Implement `BlockRenderer` for paragraphs with wrapping support
- [x] T009 Implement `BlockRenderer` for fenced code blocks with delimiters and padding
- [x] T010 Implement `BlockRenderer` for lists (ordered and unordered) with indentation
- [x] T011 Implement `BlockRenderer` for blockquotes with left border
- [x] T012 Implement `BlockRenderer` for horizontal rules

## Phase 4: Table Rendering

- [x] T013 Implement `TableRenderer` basic structure with borders
- [x] T014 Implement column width calculation logic based on content
- [x] T015 Implement responsive scaling logic using `useStdout` terminal width
- [x] T016 Integrate `TableRenderer` into `BlockRenderer`

## Phase 5: Integration & Validation

- [x] T017 Export `Markdown` component as a memoized component
- [x] T018 Integrate `Markdown` into `MessageItem.tsx` for message content
- [x] T019 Integrate `Markdown` into `ReasoningDisplay.tsx`
- [x] T020 Integrate `Markdown` into `Confirmation.tsx` for plan content
- [x] T021 Add unit tests in `packages/code/tests/components/Markdown.test.tsx`

# Tasks: Message Rendering System

**Input**: Design documents from `/specs/027-message-rendering-system/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Component tests using Ink's testing library are recommended.

## Phase 1: Setup & Types

- [X] T001 Create project structure and empty files per implementation plan
- [X] T002 [P] Ensure `Message` and `MessageBlock` types are correctly defined in `packages/agent-sdk/src/types/messaging.ts`

## Phase 2: Core Rendering Logic

- [X] T003 Implement `MessageBlockItem` to handle all block types in `packages/code/src/components/MessageBlockItem.tsx`
- [X] T004 Implement `MessageList` with static/dynamic split in `packages/code/src/components/MessageList.tsx`
- [X] T005 [P] Implement welcome message rendering in `MessageList`
- [X] T006 [P] Implement message limiting logic (max 10 messages) in `MessageList`

## Phase 3: Dynamic Updates & Measurement

- [X] T007 Implement `isDynamic` logic to identify active blocks
- [X] T008 Implement height measurement for dynamic blocks using `measureElement`
- [X] T009 Wire up `onDynamicBlocksHeightMeasured` callback

## Phase 4: Refinement & Optimization

- [X] T010 [P] Use `React.memo` for `MessageList` and `MessageBlockItem`
- [X] T011 [P] Ensure proper padding and spacing between blocks
- [X] T012 [P] Simplify `isDynamic` logic to treat all blocks in the last message as dynamic (unless `forceStatic` is true)
- [X] T015 [P] Update `isDynamic` logic to only include running tool and bang blocks, and remove `isFinished` dependency.

## Phase 5: Verification

- [X] T013 Run `pnpm run type-check` and `pnpm lint`
- [X] T014 Manually verify rendering with various block types and long histories

# Tasks: /model Command

**Input**: Design documents from `/specs/033-model-command/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Unit tests are REQUIRED for all new SDK functionality.

**Organization**: Tasks are grouped by phase to enable sequential implementation.

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- Include exact file paths in descriptions

## Phase 1: SDK Support

**Purpose**: Add model configuration methods to the agent SDK.

### Tests

- [X] T001 [P] Unit tests for `setModel` in `packages/agent-sdk/tests/services/configurationService.test.ts`
- [X] T002 [P] Unit tests for `getConfiguredModels` in `packages/agent-sdk/tests/services/configurationService.test.ts`

### Implementation

- [X] T003 Add `onModelChange` callback to `AgentCallbacks` in `packages/agent-sdk/src/types/agent.ts`
- [X] T004 Implement `setModel(model: string)` in `packages/agent-sdk/src/services/configurationService.ts`
- [X] T005 Implement `getConfiguredModels(): string[]` in `packages/agent-sdk/src/services/configurationService.ts`
- [X] T006 Expose `setModel` and `getConfiguredModels` in `packages/agent-sdk/src/agent.ts`

---

## Phase 2: CLI State Management

**Purpose**: Add state management for the model selector UI.

### Tests

- [X] T007 [P] Unit tests for `inputReducer` in `packages/code/tests/managers/inputReducer.test.ts`

### Implementation

- [X] T008 Add `showModelSelector` to `InputState` in `packages/code/src/managers/inputReducer.ts`
- [X] T009 Add `SET_SHOW_MODEL_SELECTOR` action to `InputAction` in `packages/code/src/managers/inputReducer.ts`
- [X] T010 Handle `SET_SHOW_MODEL_SELECTOR` in `inputReducer` in `packages/code/src/managers/inputReducer.ts`
- [X] T011 Update `useInputManager` to expose `showModelSelector` and `setShowModelSelector` in `packages/code/src/hooks/useInputManager.ts`

---

## Phase 3: Command Handler

**Purpose**: Wire up the `/model` command to open the selector.

### Implementation

- [X] T012 Update `handleCommandSelect` in `packages/code/src/managers/inputHandlers.ts` to open selector on `/model`
- [X] T013 Register `/model` in `AVAILABLE_COMMANDS` in `packages/code/src/index.tsx`

---

## Phase 4: UI Implementation

**Purpose**: Create the interactive model selector component.

### Tests

- [X] T014 [P] Unit tests for `ModelSelector` component (if applicable)

### Implementation

- [X] T015 Create `ModelSelector.tsx` component in `packages/code/src/components/ModelSelector.tsx`
    - Display list of models
    - Keyboard navigation (Up/Down Arrow)
    - Selection (Enter) and cancellation (Escape)
    - Highlight current model
- [X] T016 Integrate `ModelSelector` into `InputBox.tsx` in `packages/code/src/components/InputBox.tsx`

---

## Phase 5: Context Integration

**Purpose**: Sync model state between agent and UI.

### Implementation

- [X] T017 Update `useChat` context to track `currentModel` and `configuredModels` state in `packages/code/src/contexts/useChat.tsx`
- [X] T018 Implement `onModelChange` callback during agent initialization in `packages/code/src/contexts/useChat.tsx`
- [X] T019 Provide `setModel` and `getConfiguredModels` methods to components via `useChat`

---

## Phase 6: Verification

- [X] T020 Run `pnpm run type-check` and `pnpm lint` across the monorepo
- [X] T021 Run `quickstart.md` validation scenarios manually
- [X] T022 Verify `/status` command displays the active model

---

## Dependencies & Execution Order

### Phase Dependencies

- **SDK Support (Phase 1)**: No dependencies.
- **CLI State (Phase 2)**: Depends on SDK Support (Phase 1).
- **Command Handler (Phase 3)**: Depends on CLI State (Phase 2).
- **UI Implementation (Phase 4)**: Depends on CLI State (Phase 2).
- **Context Integration (Phase 5)**: Depends on SDK Support (Phase 1) and UI Implementation (Phase 4).
- **Verification (Phase 6)**: Depends on all previous phases.

### Parallel Opportunities

- T001, T002 (Phase 1 Tests)
- T008, T009, T010 (Phase 2 - same file)
- T007, T014 (Tests can run in parallel with implementation)

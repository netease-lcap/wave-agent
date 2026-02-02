# Implementation Plan: History Search Prompt

**Feature Branch**: `057-history-search-prompt`
**Created**: 2026-02-02
**Status**: Draft
**Feature Spec**: `/home/liuyiqi/personal-projects/wave-agent/specs/057-history-search-prompt/spec.md`

## Technical Context

### Current State
- The agent currently uses `~/.wave/bash-history.json` to store bash commands.
- `packages/agent-sdk/src/utils/bashHistory.ts` manages this history.
- `packages/code/src/components/BashHistorySelector.tsx` provides a UI for browsing this history.
- `packages/code/src/components/InputBox.tsx` integrates the selector and handles key events.
- There is no dedicated prompt history; it seems bash commands and prompts might be mixed or only bash commands are tracked in that specific file.

### Target State
- A new history file `~/.wave/history.jsonl` will store user prompts.
- `Ctrl+R` in `InputBox.tsx` will trigger a new search UI.
- The search UI will filter prompts from `history.jsonl` case-insensitively.
- Selecting a prompt will populate the `InputBox`.
- New prompts will be appended to `history.jsonl`.
- Bash history saving and the old bash history selector will be removed.

### Constraints & Assumptions
- **Constraint**: Must use `pnpm` and follow the Wave Agent Constitution.
- **Assumption**: `history.jsonl` should store one JSON object per line for easy appending and parsing.
- **Assumption**: The user wants to remove *bash* history functionality from the *agent's* UI, not necessarily delete the user's actual system bash history (though the agent's internal `bash-history.json` should probably go).

### Unknowns & Research Tasks
- [x] Where is the current bash history selection functionality? (Found: `BashHistorySelector.tsx`, `bashHistory.ts`)
- [x] How to implement `Ctrl+R` listener in Ink? (Found: `useInput` in `InputBox.tsx`)
- [x] What is the exact format of `~/.wave/history.jsonl`? (Decision: JSONL with `{ prompt: string, timestamp: number }`)

## Constitution Check

| Principle | Status | Justification |
|-----------|--------|---------------|
| I. Package-First | ✅ | Logic split between `agent-sdk` and `code`. |
| II. TypeScript | ✅ | Strict typing for history and UI. |
| III. Test Alignment | ✅ | Unit and integration tests planned. |
| VI. Quality Gates | ✅ | `type-check` and `lint` will be run. |
| VII. Source Code Structure | ✅ | Following established patterns. |
| IX. Type System Evolution | ✅ | Evolving history types. |
| X. Data Model Minimalism | ✅ | Simple `{ prompt, timestamp }` structure. |

## Gates

| Gate | Requirement | Status |
|------|-------------|--------|
| Specification | Approved spec.md exists | ✅ |
| Research | All NEEDS CLARIFICATION resolved | ✅ |
| Design | data-model.md and contracts/ exist | ⏳ |
| Constitution | No unjustified violations | ✅ |

## Phase 0: Outline & Research

### Research Findings (Consolidated)
- **Decision**: Create a new `PromptHistoryManager` in `agent-sdk` to handle `~/.wave/history.jsonl`.
- **Rationale**: Keeps data persistence logic separate from UI and allows reuse.
- **Decision**: Use `jsonl` format for the new history file.
- **Rationale**: Efficient for appending new entries without rewriting the whole file.
- **Decision**: Remove `BashHistorySelector.tsx` and references to `bashHistory.ts` in `InputBox.tsx`.
- **Rationale**: Directly requested by the user to "remove bash history".

## Phase 1: Design & Contracts

### Data Model (`data-model.md`)
- **PromptEntry**:
  - `prompt`: string
  - `timestamp`: number (ISO string or epoch)

### API / Internal Contracts
- `PromptHistoryManager`:
  - `addEntry(prompt: string): Promise<void>`
  - `getHistory(): Promise<PromptEntry[]>`
  - `searchHistory(query: string): Promise<PromptEntry[]>`

## Phase 2: Implementation Plan

### Step 1: SDK - Prompt History Management
- Create `packages/agent-sdk/src/utils/promptHistory.ts`.
- Implement `PromptHistoryManager` with `jsonl` support.
- Update `packages/agent-sdk/src/index.ts` to export new utilities if needed.

### Step 2: SDK - Remove Bash History Logic
- Deprecate or remove `packages/agent-sdk/src/utils/bashHistory.ts` if no longer used anywhere.
- Update constants in `packages/agent-sdk/src/utils/constants.ts`.

### Step 3: UI - New Search Component
- Create `packages/code/src/components/HistorySearch.tsx` (based on `BashHistorySelector.tsx` but adapted for prompts and `Ctrl+R`).
- Implement filtering and keyboard navigation.

### Step 4: UI - Integration in InputBox
- Modify `packages/code/src/components/InputBox.tsx`:
  - Remove `BashHistorySelector`.
  - Add `HistorySearch` component.
  - Add `Ctrl+R` listener to toggle `HistorySearch`.
  - Ensure new prompts are saved via `PromptHistoryManager`.

### Step 5: Verification
- Unit tests for `PromptHistoryManager`.
- Integration tests for `HistorySearch` in `InputBox`.
- Manual verification of `Ctrl+R` and `history.jsonl` content.

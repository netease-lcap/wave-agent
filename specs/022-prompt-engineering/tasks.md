# Tasks: Prompt Engineering Framework

## Phase 1: Research & Design
- [ ] Research existing prompt management patterns in the codebase (e.g., `packages/agent-sdk/src/prompts/`)
- [ ] Design the Prompt Registry and Template system
- [ ] Define the interface for dynamic tool prompts

## Phase 2: Implementation
- [X] Implement the `PromptRegistry` class (Note: Prompts refactored into modular constants in `packages/agent-sdk/src/prompts/index.ts`)
- [X] Refactor `packages/agent-sdk/src/prompts/index.ts` to use modular constants and improved content from Claude Code
- [ ] Update `ToolManager` to use the registry for tool descriptions
- [ ] Implement prompt template substitution logic
- [X] Add max tool calls limit to parallel tool calls prompt
- [X] Improve prompt content based on Claude Code (refining "Doing Tasks", adding "Executing actions with care", etc.)

## Phase 3: Testing & Validation
- [ ] Write unit tests for `PromptRegistry`
- [ ] Verify that the agent still behaves correctly with the new framework
- [ ] Test dynamic tool descriptions with different contexts

## Phase 4: Documentation
- [ ] Document the new Prompt Engineering Framework in `AGENTS.md`
- [ ] Provide examples of how to add and update prompts

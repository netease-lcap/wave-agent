# Implementation Plan: SDK Env Headers Support

**Feature Branch**: `041-sdk-env-headers`  
**Created**: 2026-01-09  
**Status**: Implemented  
**Feature Spec**: [spec.md](spec.md)

## Technical Context

### Current Architecture
- The SDK likely has a central `Agent` class or a network service that handles HTTP requests.
- Environment variables are typically accessed via `process.env` in Node.js.

### Technology Stack
- TypeScript
- Node.js
- `agent-sdk` package

### Dependencies
- None new.

### Unknowns & Risks
- None. All research completed in `research.md`.

## Constitution Check

### Principles
- **I. Package-First Architecture**: Changes will be primarily in `packages/agent-sdk`.
- **II. TypeScript Excellence**: Strict typing for header parsing.
- **IV. Build Dependencies**: Must run `pnpm build` in `agent-sdk` after changes.
- **VI. Quality Gates**: Run `type-check` and `lint`.
- **IX. Type System Evolution**: Extend existing configuration types if possible.
- **X. Data Model Minimalism**: Keep the header parsing logic simple.

### Quality Standards
- All code must pass type-check and lint.
- Essential tests for header parsing and injection.

## Gates

- [x] All [NEEDS CLARIFICATION] resolved in `research.md`
- [x] `data-model.md` and `contracts/` generated
- [x] `quickstart.md` updated
- [x] Agent context updated
- [ ] Constitution check passed

## Phase 0: Outline & Research

### Research Tasks
1. **Research SDK request architecture**: Identify where HTTP requests are made and where headers are currently managed.
2. **Research existing header configuration**: Check if there's already a way to set global headers in the SDK.

## Phase 1: Design & Contracts

### Data Model (`data-model.md`)
- No complex entities, just the structure of `WAVE_CUSTOM_HEADERS`.

### API Contracts (`contracts/`)
- Not applicable for this internal SDK feature, but will document the environment variable format.

	### Agent Context Update
	- Update agent context manually or via appropriate tools.

## Phase 2: Implementation Strategy

### Step 1: Header Parsing Utility
- Implement a utility function to parse `WAVE_CUSTOM_HEADERS`.

### Step 2: Integration
- Integrate the parsing utility into the SDK's request flow.

### Step 3: Testing
- Add unit tests for the parsing utility.
- Add integration tests for the SDK with environment variables set.

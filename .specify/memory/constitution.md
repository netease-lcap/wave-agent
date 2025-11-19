<!--
Sync Impact Report:
- Version change: 1.3.0 → 1.4.0
- Added principles: VIII. Test-Driven Development (new principle defining TDD workflow and practices)
- Modified principles: III. Test Alignment (enhanced with TDD requirements)
- Modified sections: Quality Standards (enhanced testing requirements with TDD workflow)
- Templates requiring updates: ✅ plan-template.md, spec-template.md, tasks-template.md all maintain compatibility with TDD workflow
- Follow-up TODOs: None - all placeholders filled
-->

# Wave Agent Constitution

## Core Principles

### I. Package-First Architecture
Every feature MUST be organized into packages with clear boundaries. Packages MUST be independently buildable and testable. The `agent-sdk` provides core functionality; `code` provides CLI interface. No circular dependencies between packages allowed.

**Rationale**: Monorepo structure requires clear separation of concerns to maintain scalability and enable independent development.

### II. TypeScript Excellence
All code MUST be written in TypeScript with strict type checking enabled. No `any` types allowed without explicit justification. Type definitions MUST be comprehensive and accurate.

**Rationale**: Type safety prevents runtime errors and improves developer experience in an AI-assisted development environment.

### III. Test Alignment
Test file organization MUST follow logical patterns for discoverability. Simple modules use direct mapping (e.g., `src/utils/foo.ts` → `tests/utils/foo.test.ts`). Complex modules may use feature-based organization (e.g., `src/agent.ts` → `tests/agent/agent.feature.test.ts`). Use Vitest as the testing framework. Use HookTester for testing React hooks. All tests (unit and integration) MUST be in `packages/*/tests` directories. Integration tests use temporary directories and real file operations; unit tests use mocking for external dependencies. Tests MUST be written following TDD principles where tests are written before implementation.

**Rationale**: Flexible test organization enables both predictable discovery and manageable test suites for complex modules. TDD ensures comprehensive test coverage and better design decisions.

### IV. Build Dependencies
After modifying `agent-sdk`, MUST run `pnpm build` before testing changes in dependent packages. Use `pnpm` exclusively for package management, never `npm`.

**Rationale**: Build-time dependencies require explicit build steps to propagate changes correctly across the monorepo.

### V. Documentation Minimalism
Do NOT create Markdown documentation files unless explicitly requested by users. Focus on code clarity and inline documentation rather than separate documentation files.

**Rationale**: Over-documentation creates maintenance burden; well-written code with good naming is often self-documenting.

### VI. Quality Gates
After any modifications, MUST run `pnpm run type-check` and `pnpm run lint` to validate code quality. All type checking MUST pass without errors or warnings. All linting rules MUST be satisfied before committing changes.

**Rationale**: Automated quality checks prevent defects from entering the codebase and ensure consistent code standards across all contributors.

### VII. Source Code Structure
Package source code MUST follow established patterns for maintainability and discoverability. For `agent-sdk`: managers for state-related logic, services for network or IO-related logic, utils for pure functions, types.ts for cross-file type definitions. For `code` package: components for UI, contexts for global state and logic, hooks for reusable state and logic, utils for utility functions. Directory structure MUST reflect functional organization, not technical organization.

**Rationale**: Consistent source code organization enables developers to quickly locate and understand code purpose, reducing cognitive load and improving maintainability.

### VIII. Test-Driven Development
All new functionality MUST follow TDD workflow: Red (write failing test), Green (minimal implementation), Refactor (improve code while maintaining tests). Tests MUST be written before implementation begins. Test names MUST clearly describe behavior using "should" statements. Each test MUST focus on a single responsibility. Test isolation MUST be maintained - no test should depend on another test's state. Mock external dependencies in unit tests to ensure fast execution and reliable outcomes.

**Rationale**: TDD ensures comprehensive test coverage, promotes better API design, catches regressions early, and provides living documentation of system behavior through executable specifications.

## Quality Standards

All code MUST pass TypeScript compilation without errors or warnings. All tests MUST pass before merging. Code MUST follow the established linting and formatting rules enforced by ESLint and Prettier. Quality gates (type-check and lint) MUST be run and pass after every modification.

**Testing Requirements**: 
- Tests directory: All tests (unit and integration) with proper isolation
- Unit tests: Use mocking for external dependencies, fast execution
- All new features require corresponding tests following TDD workflow
- TDD cycle: Write failing test → Make test pass → Refactor if needed
- Test coverage: Aim for comprehensive behavior coverage, not just line coverage

## Development Workflow

**Package Management**: Use `pnpm` for all dependency management operations. Never use `npm` directly.

**TDD Development Process**:
1. Write a failing test that describes the desired behavior
2. Run the test to confirm it fails (Red phase)
3. Write minimal code to make the test pass (Green phase)
4. Run all tests to ensure no regressions
5. Refactor code while keeping tests passing
6. Repeat for each new behavior or feature

**Build Process**: 
1. Follow TDD cycle for new functionality
2. Modify code in any package
3. Run `pnpm build` if changes affect `agent-sdk`
4. Test in dependent packages
5. Run `pnpm run type-check` and `pnpm run lint`
6. Commit with clear, descriptive messages

**Testing Strategy**:
- Unit tests for individual functions and components (with mocking)
- Integration tests for user workflows and system interactions
- All tests must be in tests directories with proper cleanup
- Use appropriate isolation based on test type
- Follow TDD Red-Green-Refactor cycle consistently

## Governance

This constitution supersedes all other development practices. All pull requests MUST verify compliance with these principles. Any complexity introduced MUST be justified against simpler alternatives.

**Amendment Process**: Constitution changes require documentation of rationale, impact analysis on existing code, and migration plan for non-compliant code. All template files must be updated to maintain consistency.

**Version Control**: Use semantic versioning for constitution updates. Breaking changes to principles require major version bump.

**Version**: 1.4.0 | **Ratified**: 2025-01-27 | **Last Amended**: 2025-11-19
<!--
Sync Impact Report:
- Version change: 1.5.0 → 1.5.1
- Modified principles: IX. Type System Evolution (removed backward compatibility requirement)
- Modified sections: Quality Standards (removed backward compatibility requirement), Development Workflow (simplified type evolution process)
- Templates requiring updates: ✅ plan-template.md, spec-template.md, tasks-template.md all maintain compatibility
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
Test file organization MUST follow logical patterns for discoverability. Simple modules use direct mapping (e.g., `src/utils/foo.ts` → `tests/utils/foo.test.ts`). Complex modules may use feature-based organization (e.g., `src/agent.ts` → `tests/agent/agent.feature.test.ts`). Use Vitest as the testing framework. Use HookTester for testing React hooks. All tests MUST be in `packages/*/tests` directories. Tests MUST be written following TDD principles where tests are written before implementation.

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
All new functionality MUST follow TDD workflow: Red (write failing test), Green (minimal implementation), Refactor (improve code while maintaining tests). Tests MUST be written before implementation begins. Test names MUST clearly describe behavior using "should" statements. Each test MUST focus on a single responsibility. Test isolation MUST be maintained - no test should depend on another test's state. Mock external dependencies in tests to ensure fast execution and reliable outcomes.

**Rationale**: TDD ensures comprehensive test coverage, promotes better API design, catches regressions early, and provides living documentation of system behavior through executable specifications.

### IX. Type System Evolution
When adding functionality, MUST modify existing types or interfaces rather than creating new ones whenever possible. New types or interfaces may only be created when extending existing ones would violate single responsibility principle or create semantic inconsistencies. Type extensions MUST use composition, union types, or generic constraints to build upon existing type definitions.

**Rationale**: Type proliferation creates maintenance burden and cognitive overhead. Evolving existing types keeps the codebase lean, maintains semantic consistency, and reduces the number of concepts developers must understand.

## Quality Standards

All code MUST pass TypeScript compilation without errors or warnings. All tests MUST pass before merging. Code MUST follow the established linting and formatting rules enforced by ESLint and Prettier. Quality gates (type-check and lint) MUST be run and pass after every modification.

**Testing Requirements**: 
- All new features require corresponding tests following TDD workflow
- TDD cycle: Write failing test → Make test pass → Refactor if needed
- Test coverage: Aim for comprehensive behavior coverage, not just line coverage

**Type Evolution Requirements**:
- Evaluate existing types before creating new ones
- Justify new type creation with clear semantic reasoning
- Document type evolution decisions in code comments

## Development Workflow

**Package Management**: Use `pnpm` for all dependency management operations. Never use `npm` directly.

**TDD Development Process**:
1. Write a failing test that describes the desired behavior
2. Run the test to confirm it fails (Red phase)
3. Write minimal code to make the test pass (Green phase)
4. Run all tests to ensure no regressions
5. Refactor code while keeping tests passing
6. Repeat for each new behavior or feature

**Type Evolution Process**:
1. Identify existing types that could be extended or modified
2. Evaluate semantic compatibility of proposed changes
3. Choose modification over creation when semantically appropriate
4. Document rationale for new type creation when necessary

**Build Process**: 
1. Follow TDD cycle for new functionality
2. Apply type evolution principles before creating new types
3. Modify code in any package
4. Run `pnpm build` if changes affect `agent-sdk`
5. Test in dependent packages
6. Run `pnpm run type-check` and `pnpm run lint`
7. Commit with clear, descriptive messages

**Testing Strategy**:
- All tests must be in tests directories with proper cleanup
- Use appropriate isolation based on test type
- Follow TDD Red-Green-Refactor cycle consistently

## Governance

This constitution supersedes all other development practices. All pull requests MUST verify compliance with these principles. Any complexity introduced MUST be justified against simpler alternatives.

**Amendment Process**: Constitution changes require documentation of rationale, impact analysis on existing code, and migration plan for non-compliant code. All template files must be updated to maintain consistency.

**Version Control**: Use semantic versioning for constitution updates. Breaking changes to principles require major version bump.

**Version**: 1.5.1 | **Ratified**: 2025-01-27 | **Last Amended**: 2025-12-01
<!--
Sync Impact Report:
- Version change: 1.6.0 → 1.7.0
- Added principles: X. Data Model Minimalism (new principle for concise entity modeling)
- Modified sections: Core Principles (added new principle), Quality Standards (added data modeling requirements)
- Templates requiring updates: ✅ plan-template.md (maintains compatibility), ✅ spec-template.md (maintains compatibility), ✅ tasks-template.md (maintains compatibility)
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
Test file organization MUST follow logical patterns for discoverability. Simple modules use direct mapping (e.g., `src/utils/foo.ts` → `tests/utils/foo.test.ts`). Complex modules may use feature-based organization (e.g., `src/agent.ts` → `tests/agent/agent.feature.test.ts`). Use Vitest as the testing framework. Use HookTester for testing React hooks. All tests MUST be in `packages/*/tests` directories. Focus on essential functionality testing rather than comprehensive coverage to enable faster development iterations.

**Rationale**: Flexible test organization enables both predictable discovery and manageable test suites. Essential testing provides confidence while maintaining development velocity.

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
For critical functionality, MAY follow TDD workflow: Red (write failing test), Green (minimal implementation), Refactor (improve code while maintaining tests). Tests SHOULD focus on essential behavior and edge cases rather than comprehensive coverage. Test names MUST clearly describe behavior using "should" statements. Each test MUST focus on a single responsibility. Test isolation MUST be maintained - no test should depend on another test's state. Mock external dependencies in tests to ensure fast execution and reliable outcomes. Testing is encouraged but not required for all functionality to maintain development velocity.

**Rationale**: Essential testing provides confidence in critical functionality while allowing faster iteration. Full TDD can slow development; selective testing of key behaviors offers the best balance of quality and speed.

### IX. Type System Evolution
When adding functionality, MUST modify existing types or interfaces rather than creating new ones whenever possible. New types or interfaces may only be created when extending existing ones would violate single responsibility principle or create semantic inconsistencies. Type extensions MUST use composition, union types, or generic constraints to build upon existing type definitions.

**Rationale**: Type proliferation creates maintenance burden and cognitive overhead. Evolving existing types keeps the codebase lean, maintains semantic consistency, and reduces the number of concepts developers must understand.

### X. Data Model Minimalism
Data models MUST be kept concise and focused on essential attributes only. Avoid excessive entity decomposition or over-specification of attributes. Include only fields that are actively used in implementation. Entity relationships MUST be simple and direct. Prefer flat structures over deep hierarchies when possible.

**Rationale**: Concise data models reduce cognitive overhead, simplify implementation, and prevent over-engineering. Simple models are easier to understand, test, and maintain.

## Quality Standards

All code MUST pass TypeScript compilation without errors or warnings. All existing tests MUST pass before merging. Code MUST follow the established linting and formatting rules enforced by ESLint and Prettier. Quality gates (type-check and lint) MUST be run and pass after every modification.

**Testing Requirements**: 
- Test essential functionality and critical edge cases
- Focus on behavior verification rather than coverage metrics
- TDD encouraged for complex or critical components but not mandated for all features
- Test coverage: Prioritize high-risk areas over comprehensive coverage

**Type Evolution Requirements**:
- Evaluate existing types before creating new ones
- Justify new type creation with clear semantic reasoning
- Document type evolution decisions in code comments

**Data Modeling Requirements**:
- Keep entity definitions concise and focused
- Include only actively used attributes
- Prefer simple, flat structures over complex hierarchies
- Document entity relationships clearly but minimally

## Development Workflow

**Package Management**: Use `pnpm` for all dependency management operations. Never use `npm` directly.

**TDD Development Process**:
1. Identify critical functionality that requires testing
2. Write focused tests for essential behavior and edge cases
3. Run tests to ensure they pass with implementation
4. Refactor code while keeping tests passing
5. Optional: Add additional tests for complex components

**Type Evolution Process**:
1. Identify existing types that could be extended or modified
2. Evaluate semantic compatibility of proposed changes
3. Choose modification over creation when semantically appropriate
4. Document rationale for new type creation when necessary

**Data Modeling Process**:
1. Identify essential entities and their core attributes
2. Eliminate unnecessary fields and complex relationships
3. Validate model supports all required use cases with minimal structure
4. Review for simplification opportunities before finalizing

**Build Process**: 
1. Apply essential testing for critical functionality
2. Apply type evolution principles before creating new types
3. Apply data model minimalism to entity design
4. Modify code in any package
5. Run `pnpm build` if changes affect `agent-sdk`
6. Test in dependent packages
7. Run `pnpm run type-check` and `pnpm lint`
8. Commit with clear, descriptive messages

**Testing Strategy**:
- Focus tests on high-risk and critical functionality
- Use appropriate isolation based on test importance
- Maintain existing tests but avoid over-testing for speed

## Governance

This constitution supersedes all other development practices. All pull requests MUST verify compliance with these principles. Any complexity introduced MUST be justified against simpler alternatives.

**Amendment Process**: Constitution changes require documentation of rationale, impact analysis on existing code, and migration plan for non-compliant code. All template files must be updated to maintain consistency.

**Version Control**: Use semantic versioning for constitution updates. Breaking changes to principles require major version bump.

**Version**: 1.7.0 | **Ratified**: 2025-01-27 | **Last Amended**: 2025-12-08
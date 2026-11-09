/**
 * `@testing-library/jest-dom`'s own vitest entry declares the merge as
 * `interface Assertion<T = any>`, but vitest 5's `Assertion` takes two type
 * parameters — `R` (what the chain returns) and `T` (the actual value). The
 * parameter lists no longer match, so the merge is dropped and every jest-dom
 * matcher reads as "Property 'toBeInTheDocument' does not exist". TS reports
 * that as an error inside `node_modules`, which `skipLibCheck` hides; this
 * file re-states the merge against vitest 5's signature.
 *
 * Drop it once `@testing-library/jest-dom` ships a matching declaration.
 */
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "vitest" {
  interface Assertion<R extends void | Promise<void> = void, T = unknown>
    extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining
    extends TestingLibraryMatchers<any, any> {}
}

---
name: check-and-fix
description: Runs type checks and linting, and fixes any errors found using the typescript-expert subagent.
context: fork
agent: typescript-expert
---

1. Run `pnpm run type-check` and `pnpm lint`.
2. If errors are found, analyze the error output and fix the identified issues following your specialized guidelines.
3. After applying fixes, re-run the checks to verify that the errors are resolved.
4. Repeat the fix-and-verify cycle if necessary, but avoid infinite loops.
5. Report the final status (success or remaining issues) to the user.

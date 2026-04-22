---
name: check-and-fix
description: Runs type checks and linting, and fixes any errors found.
context: fork
---

1. Check the current state: !`git status`
2. Run `pnpm run ci` to ensure type checks, linting, and tests pass.
3. If errors are found, analyze the error output and fix the identified issues.
4. After applying fixes, re-run the checks to verify that the errors are resolved.
5. Repeat the fix-and-verify cycle if necessary, but avoid infinite loops.
6. Report the final status (success or remaining issues) to the user.

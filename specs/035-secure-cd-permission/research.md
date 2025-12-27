# Research: Secure Pipeline Command Permission Matching

## Decision: Custom Bash Parser
**Rationale**: To avoid adding a heavy dependency like `bash-parser`, we will implement a focused parser that splits commands by shell operators (`&&`, `||`, `;`, `|`, `&`) while correctly handling quotes and escapes. This is sufficient for our permission matching needs.
**Alternatives considered**: `bash-parser` (too heavy, adds dependency), `shell-quote` (doesn't handle all operators we need).

## Decision: Path Containment Check
**Rationale**: Use `path.resolve` and `fs.realpathSync` to canonicalize paths and ensure the target directory is within the current working directory. This handles relative paths, absolute paths, and symlinks securely.
**Alternatives considered**: Simple string prefix matching (insecure, doesn't handle `..` or symlinks).

## Decision: Inline Environment Variables
**Rationale**: Strip inline environment variable assignments (e.g., `VAR=val cmd`) before matching the command. This allows matching the core command regardless of environment overrides.
**Alternatives considered**: Including them in the match (too restrictive), treating them as separate commands (incorrect semantics).

## Decision: Redirection Handling
**Rationale**: Ignore redirection targets (e.g., `> file`) during permission matching. Only the command and its arguments are validated.
**Alternatives considered**: Validating redirection targets (adds significant complexity, better handled by OS permissions).

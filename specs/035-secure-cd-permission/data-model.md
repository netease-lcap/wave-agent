# Data Model - Secure Pipeline Command Permission Matching

## Entities

### SimpleCommand
Represents a single, non-chained bash command.
- `command`: The executable name (e.g., `ls`, `cd`).
- `args`: Array of arguments.
- `raw`: The original string representation of this simple command (after stripping env vars and redirections).

### ComplexCommand
Represents a full bash command string that may contain multiple simple commands.
- `parts`: Array of `SimpleCommand` objects.
- `operators`: Array of shell operators connecting the parts.

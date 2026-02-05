# Quickstart: Permission Prefix Matching

## Overview
This feature allows you to use prefix matching in your `permissions.allow` configuration. Instead of listing every exact command, you can use the `:*` suffix to allow any command that starts with a specific prefix.

## Configuration

Add rules to your `permissions.allow` array in your configuration file.

### Exact Matching
To allow only an exact command:
```json
"permissions": {
  "allow": [
    "Bash(ls -la)"
  ]
}
```

### Prefix Matching
To allow any command starting with a prefix, use `:*` at the end:
```json
"permissions": {
  "allow": [
    "Bash(git commit *)"
  ]
}
```
This will allow:
- `git commit -m "message"`
- `git commit --amend`
- `git commit -a`

But it will NOT allow:
- `git push`
- `git status`

## Important Notes
- The `:*` marker **must** be at the very end of the rule string.
- Regex and other wildcards (like `*` or `?`) are not supported and will be treated as literal characters.
- If `:*` appears in the middle of a rule, it is treated as a literal string.

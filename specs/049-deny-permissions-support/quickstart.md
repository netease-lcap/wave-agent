# Quickstart: Using permissions.deny

You can now explicitly deny permissions in your `settings.json` or `settings.local.json`. Deny rules always take precedence over allow rules.

## Examples

### Deny a specific tool
To completely prevent the agent from using `Bash`:
```json
{
  "permissions": {
    "deny": ["Bash"]
  }
}
```

### Deny specific bash commands
To prevent the agent from using `rm`:
```json
{
  "permissions": {
    "deny": ["Bash(rm *)"]
  }
}
```

### Deny access to sensitive files
To prevent the agent from reading any `.env` files:
```json
{
  "permissions": {
    "deny": ["Read(**/.env)"]
  }
}
```

To prevent the agent from writing to the `/etc` directory:
```json
{
  "permissions": {
    "deny": ["Write(/etc/**)"]
  }
}
```

### Precedence Example
If you have both allow and deny rules, the deny rule wins:
```json
{
  "permissions": {
    "allow": ["Bash"],
    "deny": ["Bash(rm *)"]
  }
}
```
In this case, the agent can use `Bash` for most commands, but `rm` will be blocked.

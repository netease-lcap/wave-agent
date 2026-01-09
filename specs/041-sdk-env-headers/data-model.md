# Data Model: SDK Env Headers Support

## Environment Variable: `WAVE_CUSTOM_HEADERS`

### Format
A string containing one or more HTTP headers, each on a new line.

### Example
```text
X-Custom-Header: value1
Authorization: Bearer token123
```

### Parsing Rules
- **Separator**: `\n` or `\r\n`
- **Key-Value Separator**: First occurrence of `:`
- **Trimming**: Both key and value are trimmed of whitespace.
- **Validation**: Lines without a `:` are ignored. Empty lines are ignored.

## Configuration Priority
When resolving headers, the SDK follows this priority (highest to lowest):
1. Headers passed explicitly to the `Agent` constructor.
2. Headers defined in `WAVE_CUSTOM_HEADERS` within `settings.json` or `settings.local.json`.
3. Headers defined in `WAVE_CUSTOM_HEADERS` as a system environment variable.

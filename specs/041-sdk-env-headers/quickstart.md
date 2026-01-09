# Quickstart: Setting SDK Headers via Environment Variables

You can now configure custom HTTP headers for the Wave SDK using the `WAVE_CUSTOM_HEADERS` environment variable. This is useful for providing API keys, session tokens, or other metadata required by your AI gateway.

## Using System Environment Variables

Set the `WAVE_CUSTOM_HEADERS` variable in your shell:

```bash
export WAVE_CUSTOM_HEADERS="X-My-Header: some-value
X-Another-Header: another-value"
```

## Using `settings.json`

You can also add it to your `.wave/settings.json` or `~/.wave/settings.json`:

```json
{
  "env": {
    "WAVE_CUSTOM_HEADERS": "X-Custom-ID: 12345\nUser-Agent: MyCustomAgent"
  }
}
```

## Precedence

If you provide headers in the `Agent` constructor, they will take precedence over environment variables:

```typescript
const agent = await Agent.create({
  defaultHeaders: {
    "X-My-Header": "constructor-value"
  }
});
```

In this case, `X-My-Header` will be `constructor-value`, even if it's also set in `WAVE_CUSTOM_HEADERS`.

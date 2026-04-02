# Model Configuration

Wave allows you to configure model-specific parameters directly in your `settings.json`. This gives you fine-grained control over reasoning quality, token cost, and latency for different models.

## Model Overrides

You can define overrides for specific models in the `models` field. The key should be the exact model name used by Wave.

```json
{
  "models": {
    "claude-3-7-sonnet-20250219": {
      "thinking": {
        "type": "enabled",
        "budget_tokens": 1024
      },
      "temperature": 1.0
    },
    "o3-mini": {
      "reasoning_effort": "high"
    },
    "gpt-4o": {
      "temperature": 0.5
    }
  }
}
```

## Supported Parameters

Wave supports passing arbitrary parameters to the underlying AI provider. Common parameters include:

- `temperature`: Controls randomness (0.0 to 2.0).
- `maxTokens`: Maximum number of tokens to generate in the response.
- `reasoning_effort`: (OpenAI specific) Controls the reasoning effort for models like `o1` and `o3-mini`. Values: `low`, `medium`, `high`.
- `thinking`: (Claude specific) Configures the thinking/reasoning capabilities for Claude 3.7+ models.
  - `type`: `"enabled"` or `"disabled"`.
  - `budget_tokens`: Maximum tokens to use for thinking.

## Unsetting Default Parameters

If a model does not support a default parameter (like `temperature` for some reasoning models), you can explicitly set it to `null` to ensure it is not sent to the provider.

```json
{
  "models": {
    "o1-preview": {
      "temperature": null
    }
  }
}
```

## Global Model Selection

You can also set the default models Wave uses via environment variables in `settings.json`:

```json
{
  "env": {
    "WAVE_MODEL": "gemini-3-flash",
    "WAVE_FAST_MODEL": "gemini-2.5-flash",
    "WAVE_MAX_INPUT_TOKENS": "100000",
    "WAVE_MAX_OUTPUT_TOKENS": "4096"
  }
}
```

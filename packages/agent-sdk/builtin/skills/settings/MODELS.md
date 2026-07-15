# Model Configuration

Wave allows you to configure model-specific parameters directly in your `settings.json`. This gives you fine-grained control over reasoning quality, token cost, and latency for different models.

## Model Overrides

You can define overrides for specific models in the `models` field. The key should be the exact model name used by Wave.

```json
{
  "models": {
    "claude-3-7-sonnet-20250219": {
      "options": {
        "thinking": {
          "type": "enabled",
          "budget_tokens": 1024
        },
        "temperature": 1.0
      }
    },
    "o3-mini": {
      "options": {
        "reasoning_effort": "high"
      }
    },
    "gpt-4o": {
      "options": {
        "temperature": 0.5
      }
    }
  }
}
```

## Supported Parameters

Generation parameters are nested under the `options` field within each model's configuration. Wave supports passing arbitrary parameters to the underlying AI provider. Common parameters include:

- `temperature`: Controls randomness (0.0 to 2.0).
- `maxTokens`: Maximum number of tokens to generate in the response.
- `reasoning_effort`: (OpenAI specific) Controls the reasoning effort for models like `o1` and `o3-mini`. Values: `low`, `medium`, `high`.
- `thinking`: (Claude specific) Configures the thinking/reasoning capabilities for Claude 3.7+ models.
  - `type`: `"enabled"` or `"disabled"`.
  - `budget_tokens`: Maximum tokens to use for thinking.

## Model Capabilities

Wave needs to know whether a model supports certain features. Instead of guessing from the model name, you declare these explicitly via the `capabilities` field. Note that `capabilities` is set at the top level of the model configuration, **not** inside the `options` field — `options` is reserved for generation parameters only.

- `vision` (default: `true`): Whether the model can accept image inputs. When `false`, images are stripped and replaced with text placeholders.
- `promptCaching` (default: `false`): Whether the model supports ephemeral prompt caching (e.g., Anthropic's `cache_control` markers). When `true`, Wave injects cache markers on the system prompt and last user message.

```json
{
  "models": {
    "claude-3-7-sonnet-20250219": {
      "capabilities": {
        "vision": true,
        "promptCaching": true
      }
    },
    "deepseek-r1": {
      "capabilities": {
        "vision": false,
        "promptCaching": false
      }
    }
  }
}
```

You can also set `capabilities` at the top level of `settings.json` to apply to the default model:

```json
{
  "capabilities": {
    "vision": true,
    "promptCaching": false
  }
}
```

## Unsetting Default Parameters

If a model does not support a default parameter (like `temperature` for some reasoning models), you can explicitly set it to `null` inside the `options` field to ensure it is not sent to the provider.

```json
{
  "models": {
    "o1-preview": {
      "options": {
        "temperature": null
      }
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

## Live Reload

Model configurations support **live reload**. When you modify the `models` field or model-related environment variables in `settings.json`, the changes take effect immediately without restarting Wave.

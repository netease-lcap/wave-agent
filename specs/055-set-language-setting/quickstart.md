# Quickstart: Set Language Setting

## Configuration

### Via settings.json
To set your preferred language globally or per project, add the `language` field to your `~/.wave/settings.json` or your project's `.wave/settings.json`:

```json
{
  "language": "Chinese"
}
```

### Via AgentOptions
If you are using the SDK, you can specify the language when creating the agent:

```typescript
const agent = await Agent.create({
  language: "French",
  // ... other options
});
```

## Usage

Once configured, the agent will:
1. Respond to your queries in the specified language.
2. Provide explanations and comments in that language.
3. Keep technical terms (like function names, variable names, and code identifiers) in their original form.

### Example

**Settings:**
```json
{
  "language": "Spanish"
}
```

**Interaction:**
User: "Explain this function."
Agent: "Esta función `calculateTotal()` calcula la suma de todos los elementos..."

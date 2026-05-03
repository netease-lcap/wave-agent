# Research: Deferred Tool Loading

## Claude Code Approach

Claude Code uses deferred tool loading to save context tokens. Key findings:

1. **Deferred tools are excluded from the initial API call** — only tool names appear in a special section of the system prompt
2. **Model discovers tools via ToolSearch** — returns full JSONSchema in `<functions>` block format
3. **MCP tools are always deferred** — since MCP servers can provide many tools
4. **Keyword search scoring**:
   - Required terms (`+prefix`) must all match for a tool to be considered
   - Exact part match: MCP tools 12 pts, built-in 10 pts
   - Partial part match: MCP tools 6 pts, built-in 5 pts
   - Full name fallback: 3 pts
   - Description match: 2 pts

## OpenAI API Limitations

Unlike Anthropic's API which supports `tool_reference` blocks, OpenAI's API has no native deferral mechanism. Wave implements simulated deferral:

1. **Filter tools before API call** — exclude deferred tools not in discovered set
2. **List names in system prompt** — so model knows deferred tools exist
3. **ToolSearch returns schemas** — model calls this first, then invokes discovered tools

## Existing Tool Architecture

Wave's tool system uses `ToolPlugin` interface with:
- `name`: Tool identifier
- `config`: OpenAI function definition (name, description, parameters)
- `execute`: Async function implementing the tool

Adding `shouldDefer`, `alwaysLoad`, and `isMcp` as optional fields maintains backward compatibility.

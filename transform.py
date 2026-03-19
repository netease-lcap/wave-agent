import sys

content = sys.stdin.read()

# Change 1
old1 = """  isRestrictedTool(toolName: string): boolean {
    return (RESTRICTED_TOOLS as readonly string[]).includes(toolName);
  }"""
new1 = """  isRestrictedTool(toolName: string): boolean {
    return (
      (RESTRICTED_TOOLS as readonly string[]).includes(toolName) ||
      toolName.startsWith("mcp__")
    );
  }"""
content = content.replace(old1, new1)

# Change 2
old2 = """    let suggestedPrefix: string | undefined;
    if (toolName === BASH_TOOL_NAME && toolInput?.command) {
      const command = String(toolInput.command);
      const parts = splitBashCommand(command);
      // Only suggest prefix for single commands to avoid confusion with complex chains
      if (parts.length === 1) {
        const processedPart = stripRedirections(stripEnvVars(parts[0]));
        suggestedPrefix = getSmartPrefix(processedPart) ?? undefined;
      }
    }"""
new2 = """    let suggestedPrefix: string | undefined;
    if (toolName === BASH_TOOL_NAME && toolInput?.command) {
      const command = String(toolInput.command);
      const parts = splitBashCommand(command);
      // Only suggest prefix for single commands to avoid confusion with complex chains
      if (parts.length === 1) {
        const processedPart = stripRedirections(stripEnvVars(parts[0]));
        suggestedPrefix = getSmartPrefix(processedPart) ?? undefined;
      }
    } else if (toolName.startsWith("mcp__")) {
      suggestedPrefix = toolName;
    }"""
content = content.replace(old2, new2)

# Change 3
matches_rule_start = content.find("private matchesRule(context: ToolPermissionContext, rule: string): boolean {")
if matches_rule_start != -1:
    next_method_start = content.find("  /**", matches_rule_start + 100)
    if next_method_start == -1:
        next_method_start = content.find("  private isAllowedByRule", matches_rule_start + 100)
    
    if next_method_start != -1:
        last_return_false = content.rfind("    return false;", matches_rule_start, next_method_start)
        if last_return_false != -1:
            # Use raw string to preserve backslashes
            insertion = r"""    // Handle other tools (e.g., MCP tools) with JSON-stringified pattern matching
    if (context.toolInput) {
      const inputString = JSON.stringify(context.toolInput);
      // For JSON strings, we want '*' to match everything including slashes and spaces
      const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\?]/g, "\\$&") // Escape regex special chars including ?
        .replace(/\*/g, ".*"); // Replace * with .*
      const regex = new RegExp(`^${regexPattern}$`, "s");
      return regex.test(inputString);
    }

"""
            content = content[:last_return_false] + insertion + content[last_return_false:]

sys.stdout.write(content)

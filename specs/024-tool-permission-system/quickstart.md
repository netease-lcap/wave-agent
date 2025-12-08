# Quick Start: Tool Permission System

This guide shows how to use the new tool permission system in Wave Agent SDK.

## Basic Usage

### Default Safe Mode (Recommended)

By default, Wave will prompt for confirmation before executing potentially dangerous operations:

```bash
# Normal mode - prompts for confirmation
wave

# Agent attempts to edit a file
# → Shows confirmation: "Do you want to proceed?"
# → User can approve or provide alternative instructions
```

### Bypass Mode (Advanced Users)

Skip all permission checks for uninterrupted operation:

```bash
# Dangerous mode - no prompts
wave --dangerously-skip-permissions
```

## Agent SDK Integration

### Basic Agent Creation

```typescript
import { Agent } from 'wave-agent-sdk';

// Default safe mode
const agent = await Agent.create({
  // ... other options
});

// Bypass mode
const agentUnsafe = await Agent.create({
  permissionMode: 'bypassPermissions',
  // ... other options  
});
```

### Custom Permission Logic

```typescript
import { Agent, type PermissionDecision } from 'wave-agent-sdk';

const agent = await Agent.create({
  permissionMode: 'default',
  canUseTool: async (toolName: string): Promise<PermissionDecision> => {
    // Custom authorization logic
    if (toolName === 'Bash') {
      return { behavior: 'deny', message: 'Bash execution not allowed' };
    }
    
    if (toolName === 'Edit' && isProductionEnvironment()) {
      return { behavior: 'deny', message: 'File editing disabled in production' };
    }
    
    return { behavior: 'allow' };
  }
});
```

### Error Handling

```typescript
const agent = await Agent.create({
  canUseTool: async (toolName: string) => {
    try {
      // Check with external authorization service
      const allowed = await authService.checkPermission(toolName);
      return allowed 
        ? { behavior: 'allow' } 
        : { behavior: 'deny', message: 'Access denied by policy' };
    } catch (error) {
      // On error, deny the operation
      return { behavior: 'deny', message: 'Authorization service unavailable' };
    }
  }
});
```

## CLI User Experience

### InputBox Behavior

When permission confirmation is needed:
1. **Main InputBox is hidden** - User cannot type new messages
2. **Confirmation component appears** - User must make a decision
3. **ESC key restores InputBox** - Confirmation disappears, normal input resumes

### Confirmation Dialog

When using default mode, you'll see:

```
Tool: Edit
Action: Modify /path/to/file.ts

Do you want to proceed?
> 1. Yes
  2. Type here to tell Wave what to do differently

Use ↑↓ to navigate • ESC to cancel
```

**Note**: The main input area is completely hidden during this interaction.

When user starts typing in option 2, the placeholder text disappears:

```
Tool: Edit
Action: Modify /path/to/file.ts

Do you want to proceed?
  1. Yes
> 2. Please create a backup first, then edit the file

Use ↑↓ to navigate • ESC to cancel
```

### Navigation

- **Arrow Keys**: Navigate between "Yes" and alternative text input
- **Enter**: Confirm selection
- **ESC**: Cancel operation  
- **Type**: Enter alternative instructions

### Alternative Instructions

Instead of proceeding, you can provide new instructions:

```
> 2. Type here to tell Wave what to do differently
    "Please create a backup first, then edit the file"
```

Wave will receive your alternative instructions instead of executing the original tool.

## Integration Examples

### CI/CD Pipeline

```bash
#!/bin/bash
# Always use bypass mode in automated environments
wave --dangerously-skip-permissions --print "Deploy to production"
```

### Enterprise Integration

```typescript
// Custom enterprise permission system
const enterpriseAgent = await Agent.create({
  canUseTool: async (toolName) => {
    const user = getCurrentUser();
    const hasPermission = await checkRBAC(user.roles, toolName);
    
    if (!hasPermission) {
      await logSecurityEvent(user, toolName, 'DENIED');
      return { 
        behavior: 'deny', 
        message: `Insufficient privileges for ${toolName}` 
      };
    }
    
    await logSecurityEvent(user, toolName, 'ALLOWED');
    return { behavior: 'allow' };
  }
});
```

### Development Workflow

```typescript
// Different permissions for different environments
const devAgent = await Agent.create({
  permissionMode: process.env.NODE_ENV === 'production' ? 'default' : 'bypassPermissions',
  canUseTool: async (toolName) => {
    // Allow everything in development
    if (process.env.NODE_ENV !== 'production') {
      return { behavior: 'allow' };
    }
    
    // Strict controls in production
    const allowedTools = ['Read', 'Grep', 'LS', 'Glob'];
    if (allowedTools.includes(toolName)) {
      return { behavior: 'allow' };
    }
    
    return { 
      behavior: 'deny', 
      message: 'Write operations not allowed in production' 
    };
  }
});
```

## Troubleshooting

### Permission Callback Errors

If your `canUseTool` callback throws an error, the operation is automatically denied:

```typescript
// This will deny all tools if authService fails
canUseTool: async (toolName) => {
  const result = await authService.check(toolName); // May throw
  return result ? { behavior: 'allow' } : { behavior: 'deny' };
}

// Better: Handle errors gracefully  
canUseTool: async (toolName) => {
  try {
    const result = await authService.check(toolName);
    return result ? { behavior: 'allow' } : { behavior: 'deny' };
  } catch (error) {
    console.warn('Auth service error:', error);
    return { behavior: 'deny', message: 'Authorization temporarily unavailable' };
  }
}
```

### CLI Not Showing Confirmations

- Ensure you're not using `--dangerously-skip-permissions` flag
- Check that the tool being executed is in the restricted list (Edit, MultiEdit, Delete, Bash, Write)
- Read-only tools (Read, Grep, LS, Glob) never show confirmations

### Agent SDK Integration Issues

- Make sure `permissionMode` is set to `"default"` (or omitted for default)
- Verify `canUseTool` callback returns a Promise
- Check that PermissionDecision has correct structure

## Security Considerations

1. **Never use bypass mode in production** unless you fully understand the risks
2. **Always validate user input** in custom permission callbacks
3. **Log permission decisions** for security auditing
4. **Implement timeouts** for external authorization services
5. **Use principle of least privilege** - deny by default when uncertain

## Migration from Existing Code

Existing code continues to work without changes. The permission system is opt-in:

```typescript
// Old code - still works, uses default safe mode
const agent = await Agent.create({ apiKey: 'xxx' });

// New code - explicit permission configuration  
const agent = await Agent.create({ 
  apiKey: 'xxx',
  permissionMode: 'default', // or 'bypassPermissions'
  canUseTool: customPermissionLogic
});
```
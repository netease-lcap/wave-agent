# Quickstart: SDK Usage Tracking and Callback System

**Target Audience**: Developers using wave-agent-sdk who need to monitor AI service usage and costs  
**Prerequisites**: Basic familiarity with wave-agent-sdk Agent class and callback patterns  
**Estimated Time**: 10-15 minutes to implement basic usage tracking

## Overview

The SDK usage tracking system provides:
- **Real-time callbacks** when AI operations complete (`onUsagesChange`)
- **On-demand usage retrieval** via `agent.usages` getter
- **Automatic persistence** of usage data in session files
- **CLI exit summaries** showing per-model token consumption

## Quick Setup

### 1. Basic Usage Tracking with Callbacks

```typescript
import { Agent } from 'wave-agent-sdk';

const agent = await Agent.create({
  callbacks: {
    onUsagesChange: (usages) => {
      // Called after each AI operation (agent call or compression)
      console.log('Current session usage:', usages);
      
      // Calculate total tokens across all operations
      const totalTokens = usages.reduce((sum, usage) => sum + usage.total_tokens, 0);
      console.log(`Total tokens consumed: ${totalTokens}`);
    }
  }
});

// Normal usage - callbacks will be triggered automatically
await agent.sendMessage("Hello, how can I help with my project?");
```

### 2. On-Demand Usage Retrieval

```typescript
// Get usage statistics at any time
const currentUsage = agent.usages;

console.log('Session usage breakdown:');
currentUsage.forEach(usage => {
  console.log(`Model: ${usage.model || 'unknown'}`);
  console.log(`  Operation: ${usage.operation_type}`);
  console.log(`  Tokens: ${usage.prompt_tokens} prompt + ${usage.completion_tokens} completion = ${usage.total_tokens} total`);
});
```

### 3. CLI Exit Summary (Automatic)

When using the CLI packages, token summaries are automatically displayed on exit:

```bash
$ wave-code --plain "Analyze this codebase"
# ... AI response ...

Token Usage Summary:
==================
Model: gpt-4
  Prompt tokens: 1,250
  Completion tokens: 2,100
  Total tokens: 3,350
  Operations: 5 agent calls, 2 compressions

Model: gpt-3.5-turbo-16k  
  Prompt tokens: 450
  Completion tokens: 200
  Total tokens: 650
  Operations: 0 agent calls, 3 compressions
```

## Common Usage Patterns

### Cost Monitoring with Thresholds

```typescript
const COST_PER_1K_TOKENS = {
  'gpt-4': 0.03,           // Example rates
  'gpt-3.5-turbo': 0.002,
};

const agent = await Agent.create({
  callbacks: {
    onUsagesChange: (usages) => {
      let totalCost = 0;
      
      usages.forEach(usage => {
        const model = usage.model || 'unknown';
        const rate = COST_PER_1K_TOKENS[model] || 0.01;
        const cost = (usage.total_tokens / 1000) * rate;
        totalCost += cost;
      });
      
      console.log(`Estimated cost: $${totalCost.toFixed(4)}`);
      
      if (totalCost > 1.00) {
        console.warn('⚠️  Cost threshold exceeded!');
      }
    }
  }
});
```

### Usage Analytics Dashboard

```typescript
class UsageTracker {
  private usageHistory: Usage[][] = [];
  
  constructor(agent: Agent) {
    agent.callbacks.onUsagesChange = (usages) => {
      this.usageHistory.push([...usages]);
      this.updateDashboard();
    };
  }
  
  private updateDashboard() {
    const latest = this.usageHistory[this.usageHistory.length - 1] || [];
    
    // Group by model
    const byModel = latest.reduce((acc, usage) => {
      const model = usage.model || 'unknown';
      acc[model] = (acc[model] || 0) + usage.total_tokens;
      return acc;
    }, {} as Record<string, number>);
    
    console.clear();
    console.log('🤖 AI Usage Dashboard');
    console.log('==================');
    Object.entries(byModel).forEach(([model, tokens]) => {
      console.log(`${model}: ${tokens.toLocaleString()} tokens`);
    });
  }
}

const agent = await Agent.create({});
const tracker = new UsageTracker(agent);
```

### Session Usage Export

```typescript
function exportUsageReport(agent: Agent) {
  const usages = agent.usages;
  
  const report = {
    timestamp: new Date().toISOString(),
    sessionId: agent.sessionId,
    totalOperations: usages.length,
    totalTokens: usages.reduce((sum, u) => sum + u.total_tokens, 0),
    breakdown: usages.map(usage => ({
      model: usage.model,
      operation: usage.operation_type,
      tokens: {
        prompt: usage.prompt_tokens,
        completion: usage.completion_tokens,
        total: usage.total_tokens
      }
    }))
  };
  
  // Export to file, send to analytics service, etc.
  console.log(JSON.stringify(report, null, 2));
}

// Call whenever you need a usage report
exportUsageReport(agent);
```

## Integration Examples

### Express.js API with Usage Tracking

```typescript
import express from 'express';
import { Agent } from 'wave-agent-sdk';

const app = express();

app.post('/api/chat', async (req, res) => {
  const agent = await Agent.create({
    callbacks: {
      onUsagesChange: (usages) => {
        // Log usage for billing/analytics
        console.log(`Request ${req.id} used ${usages.reduce((s, u) => s + u.total_tokens, 0)} tokens`);
      }
    }
  });
  
  await agent.sendMessage(req.body.message);
  
  // Include usage in response for client-side tracking
  res.json({
    messages: agent.messages,
    usage: agent.usages
  });
});
```

### Batch Processing with Usage Limits

```typescript
async function processBatch(items: string[], maxTokens: number = 10000) {
  const agent = await Agent.create({});
  let processedCount = 0;
  
  for (const item of items) {
    // Check current usage before processing
    const currentUsage = agent.usages.reduce((sum, u) => sum + u.total_tokens, 0);
    
    if (currentUsage >= maxTokens) {
      console.log(`Token limit reached after processing ${processedCount} items`);
      break;
    }
    
    await agent.sendMessage(`Process this item: ${item}`);
    processedCount++;
  }
  
  console.log(`Batch complete: ${processedCount}/${items.length} items processed`);
  console.log('Final usage:', agent.usages);
}
```

## Error Handling

### Robust Callback Implementation

```typescript
const agent = await Agent.create({
  callbacks: {
    onUsagesChange: async (usages) => {
      try {
        // Your usage tracking logic
        await sendUsageToAnalytics(usages);
      } catch (error) {
        // Callback errors are logged but don't break AI operations
        console.error('Usage callback failed:', error);
        // SDK continues normal operation
      }
    }
  }
});
```

### Handling Missing Usage Data

```typescript
function getUsageSafely(agent: Agent) {
  try {
    const usages = agent.usages;
    
    if (usages.length === 0) {
      console.log('No usage data available (no AI operations performed)');
      return [];
    }
    
    return usages;
  } catch (error) {
    console.warn('Failed to retrieve usage data:', error);
    return [];
  }
}
```

## Performance Tips

### Efficient Usage Callbacks
- Keep callback logic lightweight (< 100ms execution time)
- Use async callbacks for I/O operations (database, API calls)
- Avoid blocking operations that could slow down AI responses

### Memory Management
- Usage data is automatically cleaned up when sessions end
- No manual cleanup required for typical usage patterns
- Large sessions (>1000 operations) may accumulate ~150KB of usage metadata

### CLI Performance
- Exit summaries are generated from Agent usage array (fast direct access)
- Summary generation has 500ms timeout to avoid hanging processes
- Graceful fallback if usage summary generation fails

## Troubleshooting

### Common Issues

**Q: Callbacks not triggering**
- Ensure `onUsagesChange` is set in `AgentCallbacks` during agent creation
- Callbacks only trigger after successful AI operations (not failed ones)

**Q: Empty usage array returned**
- Normal if no AI operations have completed yet
- Check that `sendMessage()` operations are completing successfully

**Q: CLI summary not showing**
- Summary only displays if session contains usage data
- Check that AI operations occurred during the session

**Q: Usage data seems inaccurate**
- Usage reflects actual OpenAI API consumption
- Compression operations use fast model (typically fewer tokens)
- Failed operations don't generate usage data

### Debug Mode
```typescript
const agent = await Agent.create({
  logger: console,  // Enable debug logging
  callbacks: {
    onUsagesChange: (usages) => {
      console.log('Usage callback triggered:', JSON.stringify(usages, null, 2));
    }
  }
});
```

## Next Steps

1. **Implement basic tracking** using the callback examples above
2. **Add cost monitoring** based on your AI service pricing
3. **Integrate with analytics** systems for usage insights
4. **Set up alerting** for usage thresholds or anomalies
5. **Export usage data** for billing and reporting purposes

For advanced usage patterns and custom integrations, see the full API contracts in `/contracts/` directory.
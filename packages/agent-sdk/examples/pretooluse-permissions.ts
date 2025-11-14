#!/usr/bin/env tsx

/**
 * PreToolUse Permissions Example
 * 
 * This example demonstrates User Story 3: PreToolUse Permission Flow
 * - Shows how hooks can request user permission before tool execution
 * - Demonstrates the "ask" permission decision workflow
 * - Tests the integration between hooks, Agent, and permission resolution
 */

import { Agent } from "../src/agent.js";
import { hookExecutor } from "../src/services/hookExecutor.js";
import type { PermissionDecision } from "../src/types/hooks.js";

console.log("🔒 PreToolUse Permissions Example");
console.log("===================================\n");

// Mock hook execution results for different permission scenarios
const mockHookResults = {
  askPermission: {
    exitCode: 0,
    stdout: JSON.stringify({
      continue: false,
      hookEventName: "PreToolUse", 
      permissionDecision: "ask",
      permissionDecisionReason: "This tool will read sensitive configuration files. Do you want to proceed?",
      updatedInput: {
        file_path: "/etc/sensitive-config.json",
        permissions: "read-only"
      }
    }),
    stderr: "",
    executionTime: 150
  },
  
  allowPermission: {
    exitCode: 0,
    stdout: JSON.stringify({
      continue: true,
      hookEventName: "PreToolUse",
      permissionDecision: "allow", 
      permissionDecisionReason: "Tool access approved automatically",
      updatedInput: {
        file_path: "/safe/config.json",
        mode: "readonly"
      }
    }),
    stderr: "",
    executionTime: 100
  },
  
  denyPermission: {
    exitCode: 0,
    stdout: JSON.stringify({
      continue: false,
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Tool access denied due to security policy"
    }),
    stderr: "",
    executionTime: 80
  }
};

/**
 * Example 1: Hook requests permission with "ask" decision
 */
async function example1_AskPermission() {
  console.log("📋 Example 1: Hook Asks for User Permission");
  console.log("---------------------------------------------");
  
  try {
    const result = await hookExecutor.executePreToolUseWithPermissions(
      "mock-security-hook",
      {
        event: "PreToolUse",
        projectDir: process.cwd(),
        timestamp: new Date(),
        toolName: "Read",
        sessionId: "test-session",
        transcriptPath: "/tmp/test-transcript.md",
        cwd: process.cwd(),
        toolInput: { file_path: "/etc/passwd" }
      },
      "Read",
      { file_path: "/etc/passwd" },
      (request) => {
        console.log(`📥 Permission request received:`)
        console.log(`   Tool: ${request.toolName}`)
        console.log(`   Reason: ${request.reason}`)
        console.log(`   Request ID: ${request.id}`)
        console.log(`   Tool Input: ${JSON.stringify(request.toolInput, null, 2)}`)
      }
    );
    
    console.log(`✅ Hook execution result:`)
    console.log(`   Should Proceed: ${result.shouldProceed}`)
    console.log(`   Requires Permission: ${result.requiresUserPermission}`)
    
    if (result.permissionRequest) {
      console.log(`   Permission Request ID: ${result.permissionRequest.id}`)
      console.log(`   Reason: ${result.permissionRequest.reason}`)
      
      // Simulate user allowing the request
      console.log(`\n👤 User Decision: ALLOW`)
      result.permissionRequest.onResolve({
        decision: "allow",
        shouldContinueRecursion: true,
        reason: "User approved the tool execution"
      });
      
      console.log(`✅ Permission resolved successfully`)
    }
    
  } catch (error) {
    console.error(`❌ Example 1 failed:`, error);
  }
  
  console.log();
}

/**
 * Example 2: Hook automatically allows tool execution
 */
async function example2_AutoAllow() {
  console.log("📋 Example 2: Hook Automatically Allows");
  console.log("---------------------------------------");
  
  try {
    const result = await hookExecutor.executePreToolUseWithPermissions(
      "mock-auto-allow-hook",
      {
        event: "PreToolUse",
        projectDir: process.cwd(),
        timestamp: new Date(),
        toolName: "Write",
        sessionId: "test-session",
        transcriptPath: "/tmp/test-transcript.md", 
        cwd: process.cwd(),
        toolInput: { file_path: "/tmp/safe-file.txt", content: "Hello World" }
      },
      "Write",
      { file_path: "/tmp/safe-file.txt", content: "Hello World" }
    );
    
    console.log(`✅ Hook execution result:`)
    console.log(`   Should Proceed: ${result.shouldProceed}`)
    console.log(`   Requires Permission: ${result.requiresUserPermission}`)
    console.log(`   Updated Input: ${JSON.stringify(result.updatedInput, null, 2)}`)
    
  } catch (error) {
    console.error(`❌ Example 2 failed:`, error);
  }
  
  console.log();
}

/**
 * Example 3: Hook denies tool execution
 */
async function example3_Deny() {
  console.log("📋 Example 3: Hook Denies Tool Execution");
  console.log("----------------------------------------");
  
  try {
    const result = await hookExecutor.executePreToolUseWithPermissions(
      "mock-deny-hook",
      {
        event: "PreToolUse",
        projectDir: process.cwd(),
        timestamp: new Date(),
        toolName: "Bash",
        sessionId: "test-session",
        transcriptPath: "/tmp/test-transcript.md",
        cwd: process.cwd(),
        toolInput: { command: "rm -rf /" }
      },
      "Bash",
      { command: "rm -rf /" }
    );
    
    console.log(`✅ Hook execution result:`)
    console.log(`   Should Proceed: ${result.shouldProceed}`)
    console.log(`   Requires Permission: ${result.requiresUserPermission}`)
    console.log(`   Block Reason: ${result.blockReason}`)
    
  } catch (error) {
    console.error(`❌ Example 3 failed:`, error);
  }
  
  console.log();
}

/**
 * Example 4: Full Agent integration with permission flow
 */
async function example4_AgentIntegration() {
  console.log("📋 Example 4: Agent Integration with Permissions");
  console.log("------------------------------------------------");
  
  try {
    // Create an Agent instance
    const agent = await Agent.create({
      messages: [],
      logger: {
        info: (msg) => console.log(`ℹ️  ${msg}`),
        warn: (msg) => console.log(`⚠️  ${msg}`),
        error: (msg) => console.log(`❌ ${msg}`),
        debug: (msg) => console.log(`🐛 ${msg}`)
      }
    });
    
    console.log(`✅ Agent created with session: ${agent.sessionId}`);
    
    // Check initial permission state
    console.log(`📊 Initial permission state:`);
    console.log(`   Pending Permissions: ${agent.getPendingPermissions().length}`);
    console.log(`   Is Awaiting Permission: ${agent.isAwaitingPermission()}`);
    
    // Simulate a permission being created (this would normally happen during tool execution)
    const mockPermissionId = `perm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`\n🔄 Simulating permission request creation...`);
    console.log(`   Mock Permission ID: ${mockPermissionId}`);
    
    // In a real scenario, the AIManager would create this permission during hook execution
    // For this example, we'll just demonstrate the resolution mechanism
    
    // Test permission resolution with allow
    console.log(`\n👤 Simulating user permission decision: ALLOW`);
    const allowDecision: PermissionDecision = {
      decision: "allow",
      shouldContinueRecursion: true,
      reason: "User approved tool execution"
    };
    
    agent.resolvePermissionRequest(mockPermissionId, allowDecision);
    console.log(`✅ Permission resolved with ALLOW decision`);
    
    // Test clearing permissions
    console.log(`\n🧹 Clearing all pending permissions...`);
    agent.clearPendingPermissions();
    console.log(`✅ All permissions cleared`);
    console.log(`   Pending Permissions: ${agent.getPendingPermissions().length}`);
    console.log(`   Is Awaiting Permission: ${agent.isAwaitingPermission()}`);
    
    // Cleanup
    agent.destroy();
    console.log(`🔚 Agent destroyed`);
    
  } catch (error) {
    console.error(`❌ Example 4 failed:`, error);
  }
  
  console.log();
}

/**
 * Example 5: Interactive permission simulator
 */
async function example5_InteractiveSimulator() {
  console.log("📋 Example 5: Interactive Permission Simulator");
  console.log("----------------------------------------------");
  
  const scenarios = [
    {
      name: "File System Access",
      toolName: "Read",
      toolInput: { file_path: "/etc/sensitive.conf" },
      reason: "Attempting to read sensitive system configuration file"
    },
    {
      name: "Network Request", 
      toolName: "HttpRequest",
      toolInput: { url: "https://api.external.com/data", method: "POST" },
      reason: "Making external API request with potentially sensitive data"
    },
    {
      name: "Command Execution",
      toolName: "Bash",
      toolInput: { command: "sudo systemctl restart nginx" },
      reason: "Running privileged system command"
    }
  ];
  
  console.log(`🎭 Available permission scenarios:`);
  scenarios.forEach((scenario, index) => {
    console.log(`   ${index + 1}. ${scenario.name} - ${scenario.toolName}`);
  });
  
  console.log(`\n🤖 Simulating permission requests for each scenario...\n`);
  
  for (const [index, scenario] of scenarios.entries()) {
    console.log(`📋 Scenario ${index + 1}: ${scenario.name}`);
    console.log(`   Tool: ${scenario.toolName}`);
    console.log(`   Input: ${JSON.stringify(scenario.toolInput)}`);
    console.log(`   Reason: ${scenario.reason}`);
    
    // Simulate different user decisions
    const userDecisions = ["allow", "deny"];
    const decision = userDecisions[index % userDecisions.length] as "allow" | "deny";
    
    console.log(`   👤 Simulated user decision: ${decision.toUpperCase()}`);
    
    const permissionDecision: PermissionDecision = {
      decision,
      shouldContinueRecursion: decision === "allow",
      reason: decision === "allow" ? "User approved" : "User rejected"
    };
    
    // Suppress unused variable warning - used for demonstration
    void permissionDecision;
    
    console.log(`   ✅ Permission ${decision === "allow" ? "granted" : "denied"}`);
    console.log();
    
    // Small delay for readability
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log(`🚀 Starting PreToolUse Permissions Examples...\n`);
  
  try {
    // Mock the hook execution to return our test data
    const originalExecuteHookWithOutput = hookExecutor.executeHookWithOutput;
    
    // Override for examples 1-3
    hookExecutor.executeHookWithOutput = async (command, context, hookEvent) => {
      let mockResult;
      
      if (command.includes("security-hook")) {
        mockResult = mockHookResults.askPermission;
      } else if (command.includes("auto-allow")) {
        mockResult = mockHookResults.allowPermission;
      } else if (command.includes("deny")) {
        mockResult = mockHookResults.denyPermission;
      } else {
        // Fallback to original implementation
        return originalExecuteHookWithOutput.call(hookExecutor, command, context, hookEvent);
      }
      
      return {
        executionResult: {
          success: mockResult.exitCode === 0,
          exitCode: mockResult.exitCode,
          stdout: mockResult.stdout,
          stderr: mockResult.stderr,
          duration: mockResult.executionTime,
          timedOut: false
        },
        parsedOutput: (await import("../src/utils/hookOutputParser.js")).parseHookOutput({
          exitCode: mockResult.exitCode,
          stdout: mockResult.stdout,
          stderr: mockResult.stderr,
          executionTime: mockResult.executionTime,
          hookEvent
        })
      };
    };
    
    // Run all examples
    await example1_AskPermission();
    await example2_AutoAllow();
    await example3_Deny();
    await example4_AgentIntegration();
    await example5_InteractiveSimulator();
    
    // Restore original implementation
    hookExecutor.executeHookWithOutput = originalExecuteHookWithOutput;
    
    console.log("🎉 All PreToolUse Permission examples completed successfully!");
    console.log("\n📖 Summary:");
    console.log("   ✅ Hook-based permission requests with 'ask' decision");
    console.log("   ✅ Automatic allow/deny decisions from hooks");
    console.log("   ✅ Agent integration with permission management");
    console.log("   ✅ Permission resolution workflows");
    console.log("   ✅ Interactive permission scenarios");
    
  } catch (error) {
    console.error("💥 Failed to run PreToolUse Permission examples:", error);
    process.exit(1);
  }
}

// Helper function to simulate async user input (for future interactive features)
async function simulateUserInput(prompt: string, defaultResponse: "allow" | "deny" = "allow"): Promise<"allow" | "deny"> {
  console.log(`❓ ${prompt}`);
  console.log(`   [Simulating user response: ${defaultResponse}]`);
  
  // Simulate thinking time
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return defaultResponse;
}

// Export for testing
export {
  example1_AskPermission,
  example2_AutoAllow,
  example3_Deny,
  example4_AgentIntegration,
  example5_InteractiveSimulator,
  simulateUserInput
};

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
/**
 * Advanced Permission System Example
 *
 * This example shows advanced permission scenarios including:
 * - Role-based access control (RBAC)
 * - External authorization service integration
 * - Error handling and fallbacks
 * - Environment-based permissions
 */

import {
  Agent,
  type PermissionDecision,
  type ToolPermissionContext,
} from "../src/index.js";

// Mock external authorization service
class AuthorizationService {
  private userRoles: string[] = ["developer", "read-only"];

  async checkPermission(
    toolName: string,
    userRoles: string[],
  ): Promise<boolean> {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Mock RBAC logic
    const toolPermissions = {
      Edit: ["developer", "admin"],
      MultiEdit: ["developer", "admin"],
      Delete: ["admin"],
      Bash: ["admin"],
      Write: ["developer", "admin"],
    };

    const requiredRoles =
      toolPermissions[toolName as keyof typeof toolPermissions] || [];
    return requiredRoles.some((role) => userRoles.includes(role));
  }

  getCurrentUserRoles(): string[] {
    return this.userRoles;
  }

  setUserRoles(roles: string[]) {
    this.userRoles = roles;
  }
}

const authService = new AuthorizationService();

async function main() {
  console.log("🔐 Advanced Permission System Examples\n");

  // Example 1: Role-Based Access Control (RBAC)
  console.log("1️⃣  Role-Based Access Control (RBAC):");

  const rbacAgent = await Agent.create({
    permissionMode: "default",
    canUseTool: async (
      context: ToolPermissionContext,
    ): Promise<PermissionDecision> => {
      const userRoles = authService.getCurrentUserRoles();
      console.log(`   👤 Current user roles: ${userRoles.join(", ")}`);
      console.log(`   🔍 Checking permission for: ${context.toolName}`);

      try {
        const hasPermission = await authService.checkPermission(
          context.toolName,
          userRoles,
        );

        if (hasPermission) {
          console.log(`   ✅ Access granted for ${context.toolName}`);
          return { behavior: "allow" };
        } else {
          console.log(`   ❌ Access denied for ${context.toolName}`);
          return {
            behavior: "deny",
            message: `Insufficient privileges. Required roles not found for ${context.toolName}`,
          };
        }
      } catch (error) {
        console.log(`   💥 Authorization service error: ${error}`);
        // Fail-safe: deny on error
        return {
          behavior: "deny",
          message: "Authorization service unavailable",
        };
      }
    },
    logger: {
      debug: () => {},
      info: (msg) => console.log(`   ℹ️  ${msg}`),
      warn: (msg) => console.log(`   ⚠️  ${msg}`),
      error: (msg) => console.log(`   ❌ ${msg}`),
    },
  });

  console.log("   📋 Testing with 'developer' + 'read-only' roles...\n");

  // Example 2: Environment-Based Permissions
  console.log("2️⃣  Environment-Based Permissions:");

  const environmentAgent = await Agent.create({
    permissionMode:
      process.env.NODE_ENV === "production" ? "default" : "bypassPermissions",
    canUseTool: async (
      context: ToolPermissionContext,
    ): Promise<PermissionDecision> => {
      const env = process.env.NODE_ENV || "development";
      console.log(`   🌍 Current environment: ${env}`);

      if (env === "production") {
        // Strict production rules
        const allowedInProduction = ["Read", "Grep", "LS", "Glob"];
        if (allowedInProduction.includes(context.toolName)) {
          console.log(`   ✅ ${context.toolName} allowed in production`);
          return { behavior: "allow" };
        } else {
          console.log(`   ❌ ${context.toolName} blocked in production`);
          return {
            behavior: "deny",
            message: `${context.toolName} operations not allowed in production environment`,
          };
        }
      } else if (env === "staging") {
        // Moderate staging rules
        const blockedInStaging = ["Delete"];
        if (blockedInStaging.includes(context.toolName)) {
          console.log(`   ❌ ${context.toolName} blocked in staging`);
          return {
            behavior: "deny",
            message: `${context.toolName} operations not allowed in staging environment`,
          };
        } else {
          console.log(`   ✅ ${context.toolName} allowed in staging`);
          return { behavior: "allow" };
        }
      } else {
        // Development: allow everything
        console.log(`   ✅ ${context.toolName} allowed in development`);
        return { behavior: "allow" };
      }
    },
    logger: {
      debug: () => {},
      info: (msg) => console.log(`   ℹ️  ${msg}`),
      warn: (msg) => console.log(`   ⚠️  ${msg}`),
      error: (msg) => console.log(`   ❌ ${msg}`),
    },
  });

  console.log(
    `   📋 Environment mode: ${process.env.NODE_ENV || "development"}\n`,
  );

  // Example 3: Audit Logging
  console.log("3️⃣  Permission Audit Logging:");

  const auditLogs: Array<{
    timestamp: Date;
    toolName: string;
    decision: string;
    user: string;
  }> = [];

  const auditAgent = await Agent.create({
    permissionMode: "default",
    canUseTool: async (
      context: ToolPermissionContext,
    ): Promise<PermissionDecision> => {
      const user = "john.doe@company.com"; // In real app, get from auth context
      const timestamp = new Date();

      // Business logic for permission
      const restrictedTools = ["Delete", "Bash"];
      const decision = restrictedTools.includes(context.toolName)
        ? "deny"
        : "allow";

      // Log the decision
      auditLogs.push({ timestamp, toolName: context.toolName, decision, user });
      console.log(
        `   📝 Audit: ${user} ${decision === "allow" ? "✅ granted" : "❌ denied"} ${context.toolName} at ${timestamp.toISOString()}`,
      );

      if (decision === "allow") {
        return { behavior: "allow" };
      } else {
        return {
          behavior: "deny",
          message: `${context.toolName} operations require additional approval`,
        };
      }
    },
    logger: {
      debug: () => {},
      info: (msg) => console.log(`   ℹ️  ${msg}`),
      warn: (msg) => console.log(`   ⚠️  ${msg}`),
      error: (msg) => console.log(`   ❌ ${msg}`),
    },
  });

  console.log(
    "   📊 Audit trail being recorded for all permission decisions\n",
  );

  // Demonstrate permission escalation
  console.log("4️⃣  Demonstrating Role Escalation:");
  console.log("   📈 Escalating user to 'admin' role...");
  authService.setUserRoles(["admin", "developer"]);
  console.log("   👤 New roles: admin, developer\n");

  // Cleanup
  rbacAgent.destroy();
  environmentAgent.destroy();
  auditAgent.destroy();

  console.log("📈 Summary of audit logs:");
  auditLogs.forEach((log) => {
    console.log(
      `   ${log.timestamp.toISOString()} | ${log.user} | ${log.toolName} | ${log.decision.toUpperCase()}`,
    );
  });

  console.log("\n🎉 Advanced permission examples completed!");
  console.log(
    "💡 These patterns can be combined and extended for complex authorization workflows.",
  );
}

main().catch(console.error);

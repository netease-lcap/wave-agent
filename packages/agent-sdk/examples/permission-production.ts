/**
 * Permission System Production Patterns
 *
 * This example demonstrates production-ready permission patterns:
 * - Database-backed permissions
 * - Rate limiting
 * - Context-aware decisions
 * - Graceful degradation
 */

import {
  Agent,
  type PermissionDecision,
  type ToolPermissionContext,
} from "../src/index.js";

// Mock database service
class PermissionDatabase {
  private permissions = new Map([
    ["user123", new Set(["Edit", "Write", "Read", "Grep", "LS"])],
    [
      "admin456",
      new Set(["Edit", "Write", "Read", "Grep", "LS", "Delete", "Bash"]),
    ],
    ["readonly789", new Set(["Read", "Grep", "LS"])],
  ]);

  async getUserPermissions(userId: string): Promise<Set<string>> {
    // Simulate database latency
    await new Promise((resolve) => setTimeout(resolve, 5));
    return this.permissions.get(userId) || new Set();
  }
}

// Rate limiting service
class RateLimiter {
  private attempts = new Map<string, Array<number>>();

  checkRateLimit(
    key: string,
    windowMs: number = 60000,
    maxAttempts: number = 10,
  ): boolean {
    const now = Date.now();
    const windowStart = now - windowMs;

    if (!this.attempts.has(key)) {
      this.attempts.set(key, []);
    }

    const keyAttempts = this.attempts.get(key)!;
    // Remove attempts outside the window
    const recentAttempts = keyAttempts.filter((time) => time > windowStart);
    this.attempts.set(key, recentAttempts);

    if (recentAttempts.length >= maxAttempts) {
      return false; // Rate limit exceeded
    }

    // Record this attempt
    recentAttempts.push(now);
    return true;
  }
}

const db = new PermissionDatabase();
const rateLimiter = new RateLimiter();

async function main() {
  console.log("🏭 Production Permission Patterns\n");

  // Example 1: Database-backed permissions with caching
  console.log("1️⃣  Database-backed Permissions:");

  const dbAgent = await Agent.create({
    permissionMode: "default",
    canUseTool: async (
      context: ToolPermissionContext,
    ): Promise<PermissionDecision> => {
      const userId = "user123"; // In real app, extract from JWT/session
      console.log(
        `   🔍 Checking database permissions for user: ${userId}, tool: ${context.toolName}`,
      );

      try {
        const userPermissions = await db.getUserPermissions(userId);

        if (userPermissions.has(context.toolName)) {
          console.log(
            `   ✅ Database permission granted for ${context.toolName}`,
          );
          return { behavior: "allow" };
        } else {
          console.log(
            `   ❌ Database permission denied for ${context.toolName}`,
          );
          return {
            behavior: "deny",
            message: `User ${userId} does not have permission to use ${context.toolName}`,
          };
        }
      } catch (error) {
        console.log(`   💥 Database error: ${error}`);
        // Graceful degradation: allow read-only operations, deny write operations
        const readOnlyTools = ["Read", "Grep", "LS", "Glob"];
        if (readOnlyTools.includes(context.toolName)) {
          console.log(
            `   🚑 Fallback: allowing read-only tool ${context.toolName}`,
          );
          return { behavior: "allow" };
        } else {
          console.log(`   🚑 Fallback: denying write tool ${context.toolName}`);
          return {
            behavior: "deny",
            message:
              "Permission service temporarily unavailable. Write operations disabled.",
          };
        }
      }
    },
    logger: {
      debug: () => {},
      info: (msg) => console.log(`   ℹ️  ${msg}`),
      warn: (msg) => console.log(`   ⚠️  ${msg}`),
      error: (msg) => console.log(`   ❌ ${msg}`),
    },
  });

  console.log("   📋 Database lookup completed\n");

  // Example 2: Rate limiting for expensive operations
  console.log("2️⃣  Rate Limited Permissions:");

  const rateLimitedAgent = await Agent.create({
    permissionMode: "default",
    canUseTool: async (
      context: ToolPermissionContext,
    ): Promise<PermissionDecision> => {
      const userId = "user123";
      const expensiveTools = ["Bash", "Delete"];

      if (expensiveTools.includes(context.toolName)) {
        const rateLimitKey = `${userId}:${context.toolName}`;
        const allowed = rateLimiter.checkRateLimit(rateLimitKey, 60000, 3); // 3 per minute

        if (!allowed) {
          console.log(
            `   🚫 Rate limit exceeded for ${context.toolName} (user: ${userId})`,
          );
          return {
            behavior: "deny",
            message: `Rate limit exceeded for ${context.toolName}. Maximum 3 operations per minute.`,
          };
        }

        console.log(`   ⏱️  Rate limit check passed for ${context.toolName}`);
      }

      console.log(`   ✅ ${context.toolName} operation allowed`);
      return { behavior: "allow" };
    },
    logger: {
      debug: () => {},
      info: (msg) => console.log(`   ℹ️  ${msg}`),
      warn: (msg) => console.log(`   ⚠️  ${msg}`),
      error: (msg) => console.log(`   ❌ ${msg}`),
    },
  });

  console.log("   📋 Rate limiting active for Bash and Delete operations\n");

  // Example 3: Context-aware permissions
  console.log("3️⃣  Context-Aware Permissions:");

  const contextAwareAgent = await Agent.create({
    permissionMode: "default",
    canUseTool: async (
      context: ToolPermissionContext,
    ): Promise<PermissionDecision> => {
      // Mock context (in real app, this could come from tool arguments, current directory, etc.)
      const currentPath = "/home/user/projects/safe-project";
      const timeOfDay = new Date().getHours();
      const isBusinessHours = timeOfDay >= 9 && timeOfDay <= 17;

      console.log(
        `   📍 Context: path=${currentPath}, hour=${timeOfDay}, businessHours=${isBusinessHours}`,
      );

      // Path-based restrictions
      if (currentPath.includes("production") && context.toolName === "Delete") {
        console.log(`   🚨 Delete operation blocked in production path`);
        return {
          behavior: "deny",
          message: "Delete operations not allowed in production directories",
        };
      }

      // Time-based restrictions
      if (
        !isBusinessHours &&
        (context.toolName === "Bash" || context.toolName === "Delete")
      ) {
        console.log(
          `   🌙 ${context.toolName} operation blocked outside business hours`,
        );
        return {
          behavior: "deny",
          message: `${context.toolName} operations only allowed during business hours (9 AM - 5 PM)`,
        };
      }

      console.log(`   ✅ Context check passed for ${context.toolName}`);
      return { behavior: "allow" };
    },
    logger: {
      debug: () => {},
      info: (msg) => console.log(`   ℹ️  ${msg}`),
      warn: (msg) => console.log(`   ⚠️  ${msg}`),
      error: (msg) => console.log(`   ❌ ${msg}`),
    },
  });

  console.log("   📋 Context-aware rules applied\n");

  // Example 4: Comprehensive production setup
  console.log("4️⃣  Comprehensive Production Setup:");

  const productionAgent = await Agent.create({
    permissionMode: "default",
    canUseTool: async (
      context: ToolPermissionContext,
    ): Promise<PermissionDecision> => {
      const startTime = Date.now();
      const userId = "user123";

      console.log(
        `   🔄 Starting comprehensive permission check for ${context.toolName}...`,
      );

      try {
        // 1. Rate limiting
        if (["Bash", "Delete"].includes(context.toolName)) {
          const rateLimitKey = `${userId}:${context.toolName}`;
          if (!rateLimiter.checkRateLimit(rateLimitKey, 60000, 3)) {
            return {
              behavior: "deny",
              message: `Rate limit exceeded for ${context.toolName}`,
            };
          }
        }

        // 2. Database permissions
        const userPermissions = await db.getUserPermissions(userId);
        if (!userPermissions.has(context.toolName)) {
          return {
            behavior: "deny",
            message: `Insufficient database permissions for ${context.toolName}`,
          };
        }

        // 3. Context checks
        const timeOfDay = new Date().getHours();
        const isBusinessHours = timeOfDay >= 9 && timeOfDay <= 17;
        if (!isBusinessHours && ["Bash", "Delete"].includes(context.toolName)) {
          return {
            behavior: "deny",
            message: `${context.toolName} operations only allowed during business hours`,
          };
        }

        const checkDuration = Date.now() - startTime;
        console.log(
          `   ✅ All checks passed for ${context.toolName} (${checkDuration}ms)`,
        );
        return { behavior: "allow" };
      } catch (error) {
        console.log(`   💥 Permission check failed: ${error}`);

        // Graceful degradation
        const safeFallbackTools = ["Read", "Grep", "LS"];
        if (safeFallbackTools.includes(context.toolName)) {
          console.log(`   🚑 Fallback: allowing safe tool ${context.toolName}`);
          return { behavior: "allow" };
        } else {
          return {
            behavior: "deny",
            message: "Permission service error. Only read operations allowed.",
          };
        }
      }
    },
    logger: {
      debug: () => {},
      info: (msg) => console.log(`   ℹ️  ${msg}`),
      warn: (msg) => console.log(`   ⚠️  ${msg}`),
      error: (msg) => console.log(`   ❌ ${msg}`),
    },
  });

  console.log("   📋 Production-grade permission system initialized\n");

  // Cleanup
  dbAgent.destroy();
  rateLimitedAgent.destroy();
  contextAwareAgent.destroy();
  productionAgent.destroy();

  console.log("🎉 Production patterns demonstration completed!");
  console.log(
    "💼 These patterns provide enterprise-grade security and reliability.",
  );
}

main().catch(console.error);

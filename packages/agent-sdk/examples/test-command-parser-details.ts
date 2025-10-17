#!/usr/bin/env npx tsx

/**
 * 详细测试命令参数解析功能
 * 运行方式：npx tsx packages/agent-sdk/examples/test-command-parser-details.ts
 */

import {
  parseCommandArguments,
  substituteCommandParameters,
  parseSlashCommandInput,
  hasParameterPlaceholders,
  getUsedParameterPlaceholders,
} from "../dist/utils/commandArgumentParser.js";

import path from "path";
import fs from "fs";
import os from "os";

// 创建临时工作目录
const tempWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-parser-test-"));

async function cleanupTestDir() {
  try {
    if (fs.existsSync(tempWorkDir)) {
      fs.rmSync(tempWorkDir, { recursive: true, force: true });
      console.log(`🧹 Cleaned up temporary work directory: ${tempWorkDir}`);
    }
  } catch (error) {
    console.warn(`Failed to cleanup temporary directory: ${error}`);
  }
}

async function testArgumentParsing() {
  console.log("🚀 Testing command argument parsing functions...\n");

  // 切换到临时工作目录
  const originalCwd = process.cwd();
  process.chdir(tempWorkDir);
  console.log(`📁 Working in temporary directory: ${tempWorkDir}\n`);

  try {
    // 测试参数解析
    console.log("🔍 Testing parseCommandArguments():");
    const testArguments = [
      "alice",
      "alice bob",
      '"John Doe" 25',
      "'Jane Smith' developer",
      'file.txt "Hello world" extra',
      "\"quoted with spaces\" 'single quotes' normal",
      'arg1 "nested \\"quotes\\"" arg3',
      "",
      "   ",
    ];

    testArguments.forEach((args) => {
      const parsed = parseCommandArguments(args);
      console.log(`  Input: "${args}"`);
      console.log(`  Output: [${parsed.map((arg) => `"${arg}"`).join(", ")}]`);
      console.log();
    });

    // 测试参数替换
    console.log("🔧 Testing substituteCommandParameters():");
    const testTemplates = [
      {
        template: "Hello $1! Your message is: $ARGUMENTS",
        args: "Alice Welcome to Wave",
      },
      {
        template: "Fixing issue #$1 with priority: $2. All args: $ARGUMENTS",
        args: "123 high",
      },
      {
        template: "File: $1, Content: $2, Extra: $3 $4, All: $ARGUMENTS",
        args: '"my file.txt" "Hello world" extra1 extra2',
      },
      {
        template: "Simple command without placeholders",
        args: "some args",
      },
      {
        template: "Command with $1 but no args",
        args: "",
      },
      {
        template: "Multiple $1 $2 $3 $4 $5",
        args: "one two",
      },
    ];

    testTemplates.forEach((test) => {
      const result = substituteCommandParameters(test.template, test.args);
      console.log(`  Template: "${test.template}"`);
      console.log(`  Args: "${test.args}"`);
      console.log(`  Result: "${result}"`);
      console.log();
    });

    // 测试命令输入解析
    console.log("⚡ Testing parseSlashCommandInput():");
    const testInputs = [
      "/greet Alice",
      "/fix-issue 123 high",
      '/create-file "my file.txt" "Hello world"',
      "/simple",
      "/command",
      "not-a-command",
      "/cmd arg1 arg2 arg3",
    ];

    testInputs.forEach((input) => {
      try {
        const parsed = parseSlashCommandInput(input);
        console.log(`  Input: "${input}"`);
        console.log(`  Command: "${parsed.command}", Args: "${parsed.args}"`);
      } catch (error) {
        console.log(`  Input: "${input}"`);
        console.log(`  Error: ${error}`);
      }
      console.log();
    });

    // 测试占位符检测
    console.log("🎯 Testing hasParameterPlaceholders():");
    const testContents = [
      "Hello $1!",
      "No placeholders here",
      "$ARGUMENTS is used here",
      "Multiple $1 $2 $ARGUMENTS",
      "Just text",
      "$123 not a valid placeholder",
    ];

    testContents.forEach((content) => {
      const hasPlaceholders = hasParameterPlaceholders(content);
      console.log(`  "${content}" -> ${hasPlaceholders}`);
    });
    console.log();

    // 测试占位符提取
    console.log("📝 Testing getUsedParameterPlaceholders():");
    testContents.forEach((content) => {
      const placeholders = getUsedParameterPlaceholders(content);
      console.log(`  "${content}" -> [${placeholders.join(", ")}]`);
    });
  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    // 恢复原工作目录
    process.chdir(originalCwd);

    // 清理临时目录
    await cleanupTestDir();
  }
}

// 运行测试
testArgumentParsing()
  .then(() => {
    console.log("✅ All parser tests completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
  });

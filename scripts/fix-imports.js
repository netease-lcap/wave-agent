#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.dirname(__dirname);

// 需要处理的目录
const dirs = ["tests", "scripts"];

// 匹配导入语句的正则表达式
const importRegexes = [
  // 相对路径导入 - 不包含 .js 的
  /^(\s*(?:import|export).*from\s+['"])(\.\.?\/[^'"]*?)(?<!\.js)(['"])/gm,
  // 路径别名导入 - @/ 开头的
  /^(\s*(?:import|export).*from\s+['"])(@\/[^'"]*?)(?<!\.js)(['"])/gm,
  // 动态导入
  /(\bimport\s*\(\s*['"])(\.\.?\/[^'"]*?)(?<!\.js)(['"])/g,
  /(\bimport\s*\(\s*['"])(@\/[^'"]*?)(?<!\.js)(['"])/g,
];

function processFile(filePath) {
  if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  let newContent = content;
  let changed = false;

  for (const regex of importRegexes) {
    const newContentAfterRegex = newContent.replace(
      regex,
      (match, prefix, importPath, suffix) => {
        // 跳过已经有 .js 扩展名的
        if (importPath.endsWith(".js")) {
          return match;
        }

        // 处理路径别名 @/
        if (importPath.startsWith("@/")) {
          changed = true;
          return prefix + importPath + ".js" + suffix;
        }

        // 处理相对路径
        if (importPath.startsWith("./") || importPath.startsWith("../")) {
          // 检查是否是目录导入（需要添加 /index.js）
          const absolutePath = path.resolve(path.dirname(filePath), importPath);
          const possiblePaths = [
            absolutePath + ".ts",
            absolutePath + ".tsx",
            path.join(absolutePath, "index.ts"),
            path.join(absolutePath, "index.tsx"),
          ];

          // 检查哪个文件存在
          for (const possiblePath of possiblePaths) {
            if (fs.existsSync(possiblePath)) {
              changed = true;
              if (
                possiblePath.endsWith("/index.ts") ||
                possiblePath.endsWith("/index.tsx")
              ) {
                return prefix + importPath + "/index.js" + suffix;
              } else {
                return prefix + importPath + ".js" + suffix;
              }
            }
          }

          // 如果都不存在，假设是 .js
          changed = true;
          return prefix + importPath + ".js" + suffix;
        }

        return match;
      },
    );
    newContent = newContentAfterRegex;
  }

  if (changed) {
    fs.writeFileSync(filePath, newContent);
    console.log(`Updated: ${path.relative(projectRoot, filePath)}`);
  }
}

function processDirectory(dirPath) {
  const items = fs.readdirSync(dirPath);

  for (const item of items) {
    const itemPath = path.join(dirPath, item);
    const stat = fs.statSync(itemPath);

    if (stat.isDirectory()) {
      processDirectory(itemPath);
    } else {
      processFile(itemPath);
    }
  }
}

// 处理指定目录
for (const dir of dirs) {
  const dirPath = path.join(projectRoot, dir);
  if (fs.existsSync(dirPath)) {
    console.log(`Processing ${dir}/ directory...`);
    processDirectory(dirPath);
  }
}

console.log("Done!");

#!/usr/bin/env node
/**
 * Migration Validation Script for Memory Architecture Simplification
 * 
 * Validates that the memory architecture changes are properly implemented:
 * 1. Agent class has memory properties and getters
 * 2. MemoryStoreService and related files are removed
 * 3. ConfigurationWatcher is merged into LiveConfigManager
 * 4. All imports and dependencies are updated
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const agentSdkDir = path.join(__dirname, 'packages/agent-sdk/src');

// Files that should exist after migration
const requiredFiles = [
  'agent.ts',
  'managers/liveConfigManager.ts', 
  'services/memory.ts'
];

// Files that should be removed after migration
const removedFiles = [
  'services/memoryStore.ts',
  'services/configurationWatcher.ts',
  'types/memoryStore.ts'
];

// Required Agent class properties and methods
const requiredAgentFeatures = [
  '_projectMemoryContent',
  '_userMemoryContent', 
  'projectMemory',
  'userMemory',
  'combinedMemory',
  'saveMemory'
];

function validateFiles() {
  console.log('🔍 Validating file structure...');
  
  // Check required files exist
  for (const file of requiredFiles) {
    const filePath = path.join(agentSdkDir, file);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ Required file missing: ${file}`);
      return false;
    }
  }
  
  // Check removed files are gone  
  for (const file of removedFiles) {
    const filePath = path.join(agentSdkDir, file);
    if (fs.existsSync(filePath)) {
      console.error(`❌ File should be removed: ${file}`);
      return false;
    }
  }
  
  console.log('✅ File structure validation passed');
  return true;
}

function validateAgentClass() {
  console.log('🔍 Validating Agent class memory features...');
  
  const agentPath = path.join(agentSdkDir, 'agent.ts');
  const agentContent = fs.readFileSync(agentPath, 'utf-8');
  
  for (const feature of requiredAgentFeatures) {
    if (!agentContent.includes(feature)) {
      console.error(`❌ Agent class missing: ${feature}`);
      return false;
    }
  }
  
  console.log('✅ Agent class validation passed');
  return true;
}

function validateImports() {
  console.log('🔍 Validating import cleanup...');
  
  // Check that MemoryStoreService imports are removed from agent.ts
  const agentPath = path.join(agentSdkDir, 'agent.ts');
  const agentContent = fs.readFileSync(agentPath, 'utf-8');
  
  if (agentContent.includes('MemoryStoreService')) {
    console.error('❌ Agent class still imports MemoryStoreService');
    return false;
  }
  
  // Check that ConfigurationWatcher import is removed from liveConfigManager.ts
  const liveConfigPath = path.join(agentSdkDir, 'managers/liveConfigManager.ts');
  const liveConfigContent = fs.readFileSync(liveConfigPath, 'utf-8');
  
  if (liveConfigContent.includes('ConfigurationWatcher')) {
    console.error('❌ LiveConfigManager still imports ConfigurationWatcher');
    return false;
  }
  
  console.log('✅ Import cleanup validation passed');
  return true;
}

function main() {
  console.log('🚀 Starting migration validation...\n');
  
  const validations = [
    validateFiles,
    validateAgentClass,
    validateImports
  ];
  
  let allPassed = true;
  for (const validate of validations) {
    if (!validate()) {
      allPassed = false;
    }
    console.log('');
  }
  
  if (allPassed) {
    console.log('🎉 All validations passed! Migration is complete.');
    process.exit(0);
  } else {
    console.log('💥 Some validations failed. Migration is incomplete.');
    process.exit(1);
  }
}

main();
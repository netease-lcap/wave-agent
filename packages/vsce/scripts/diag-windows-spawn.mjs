#!/usr/bin/env node
/**
 * 临时诊断脚本（用完删除）：复现 VS Code 扩展宿主 spawn `wave.cmd --stdio` 报
 * 「系统找不到指定的路径。」（ERROR_PATH_NOT_FOUND, exit code 1）的场景。
 *
 * 模拟 stdioClient.ts 的 spawn 调用：
 *   spawn(`"${binaryPath}"`, ['--stdio'], { stdio:['pipe','pipe','pipe'], env:{...process.env}, shell:true })
 *
 * 场景（对应扩展宿主进程与手动 cmd 的环境差异）：
 *   A. 正常环境（cwd 存在、PATH 完整）           —— 期望：进程存活（wave 等待 stdin）
 *   B. cwd 不存在                                —— 期望：观察 Node/cmd 报错
 *   C. PATH 缺少 node 所在目录                   —— 期望：观察 cmd 找不到 node
 *   D. cwd 不存在 + PATH 缺 node（组合）
 *   E. 继承无效 cwd（模拟父进程 cwd 被删除后相对路径解析失败）
 *
 * 运行：node packages/vsce/scripts/diag-windows-spawn.mjs （仅 Windows）
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

console.log(`[diag] platform=${process.platform} node=${process.version} arch=${process.arch}`);

// ── 构造模拟 npm 全局安装目录 ───────────────────────────────────
const root = mkdtempSync(path.join(os.tmpdir(), 'wave-diag-'));
const binDir = path.join(root, 'node_modules', 'wave-code', 'bin');
mkdirSync(binDir, { recursive: true });

// npm 生成的 wave.cmd shim（与真实 1.0.4 安装完全一致）
const waveCmd = path.join(root, 'wave.cmd');
writeFileSync(
  waveCmd,
  [
    '@ECHO off',
    'GOTO start',
    ':find_dp0',
    'SET dp0=%~dp0',
    'EXIT /b',
    ':start',
    'SETLOCAL',
    'CALL :find_dp0',
    '',
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ') ELSE (',
    '  SET "_prog=node"',
    '  SET PATHEXT=%PATHEXT:;.JS;=;%',
    ')',
    '',
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\wave-code\\bin\\wave-code.js" %*',
    '',
  ].join('\r\n'),
);

// 模拟 wave-code.js：--stdio 下保持存活等待 stdin
const waveJs = path.join(binDir, 'wave-code.js');
writeFileSync(waveJs, ['process.stdin.resume();', 'setTimeout(() => process.exit(0), 60000);'].join('\n'));

console.log(`[diag] wave.cmd = ${waveCmd}`);
console.log(`[diag] wave.js  = ${waveJs}`);
console.log(`[diag] node exe = ${process.execPath}`);
console.log(`[diag] PATHEXT  = ${process.env.PATHEXT ?? '(unset)'}`);

// ── spawn 辅助（与 stdioClient 一致）────────────────────────────
function trySpawn(label, { cwd, pathEnv, inheritCwd = false }) {
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: pathEnv ?? process.env.PATH };
    const command = `"${waveCmd}"`;
    const child = spawn(command, ['--stdio'], {
      // inheritCwd=true 时不传 cwd，让子进程继承本进程 cwd（模拟扩展宿主行为）
      ...(inheritCwd ? {} : { cwd }),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });
    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));

    const timer = setTimeout(() => {
      child.kill();
      resolve({ label, status: 'ALIVE (3s, expected success)', code: null, signal: null, stderr, stdout });
    }, 3000);

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ label, status: 'EXIT', code, signal, stderr, stdout });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ label, status: `SPAWN_ERROR: ${err.message}`, code: null, signal: null, stderr, stdout });
    });
  });
}

// ── 场景 ────────────────────────────────────────────────────────
const validCwd = root;
const missingCwd = path.join(os.tmpdir(), 'wave-diag-missing-' + Date.now());
const nodeDir = path.dirname(process.execPath);

// PATH 移除 node 目录（模拟 GUI 启动的 VS Code 继承注册表 PATH、缺少 shell 配置的 PATH 条目）
const pathNoNode = (process.env.PATH ?? '')
  .split(';')
  .filter((p) => p && path.resolve(p).toLowerCase() !== nodeDir.toLowerCase())
  .join(';');

console.log(`[diag] node dir (removed in C/D) = ${nodeDir}`);
console.log(`[diag] missing cwd (B/D)         = ${missingCwd}`);

const results = [];
results.push(await trySpawn('A. normal (valid cwd, full PATH)', { cwd: validCwd }));
results.push(await trySpawn('B. cwd does not exist', { cwd: missingCwd }));
results.push(await trySpawn('C. PATH without node dir', { cwd: validCwd, pathEnv: pathNoNode }));
results.push(await trySpawn('D. cwd missing + PATH without node', { cwd: missingCwd, pathEnv: pathNoNode }));
// E: 不传 cwd —— 子进程继承本进程 cwd（模拟扩展宿主 spawn 时未指定 cwd）
results.push(await trySpawn('E. inherit cwd (like extension host)', { inheritCwd: true }));

for (const r of results) {
  console.log(`\n===== ${r.label} =====`);
  console.log(`status: ${r.status}${r.code !== null ? ` code=${r.code}` : ''}${r.signal ? ` signal=${r.signal}` : ''}`);
  if (r.stderr.trim()) console.log(`stderr: ${JSON.stringify(r.stderr)}`);
  if (r.stdout.trim()) console.log(`stdout: ${JSON.stringify(r.stdout)}`);
}

rmSync(root, { recursive: true, force: true });

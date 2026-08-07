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
 *   E. 继承 cwd（模拟扩展宿主未显式传 cwd）
 *   F. 进程 cwd 指向已删除目录（helper 子进程模拟，Windows 无法直接删除自身 cwd）
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
      // 等 kill 生效（cmd.exe 可能仍持有 cwd 句柄），再 resolve
      child.once('exit', () =>
        resolve({ label, status: 'ALIVE (3s, expected success)', code: null, signal: null, stderr, stdout }),
      );
      setTimeout(() => {
        resolve({ label, status: 'ALIVE (3s, expected success)', code: null, signal: null, stderr, stdout });
      }, 1000);
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

function printResult(r) {
  console.log(`\n===== ${r.label} =====`);
  console.log(`status: ${r.status}${r.code !== null ? ` code=${r.code}` : ''}${r.signal ? ` signal=${r.signal}` : ''}`);
  if (r.stderr.trim()) console.log(`stderr: ${JSON.stringify(r.stderr)}`);
  if (r.stdout.trim()) console.log(`stdout: ${JSON.stringify(r.stdout)}`);
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

// 先跑并立即打印 A-E（任何后续场景崩溃都不影响前序结果）
const a = await trySpawn('A. normal (valid cwd, full PATH)', { cwd: validCwd });
printResult(a);
const b = await trySpawn('B. cwd does not exist', { cwd: missingCwd });
printResult(b);
const c = await trySpawn('C. PATH without node dir', { cwd: validCwd, pathEnv: pathNoNode });
printResult(c);
const d = await trySpawn('D. cwd missing + PATH without node', { cwd: missingCwd, pathEnv: pathNoNode });
printResult(d);
// E: 不传 cwd —— 子进程继承本进程 cwd（模拟扩展宿主 spawn 时未指定 cwd）
const e = await trySpawn('E. inherit cwd (like extension host)', { inheritCwd: true });
printResult(e);

// ── F: 进程 cwd 指向已删除目录 ───────────────────────────────────
// Windows 不允许删除/重命名当前进程的 cwd（EBUSY），所以用一个 helper
// 子进程持有 ghostDir 作为其 cwd，父进程删掉 ghostDir 后让 helper spawn。
console.log('\n===== F. process cwd deleted away (helper subprocess) =====');
const ghostDir = path.join(os.tmpdir(), 'wave-diag-ghost-' + Date.now());
mkdirSync(ghostDir);

// helper 脚本（写文件，避免 Windows -e 引号问题）
const helperPath = path.join(root, 'ghost-helper.mjs');
writeFileSync(
  helperPath,
  `
import { spawn } from 'node:child_process';
const ghostDir = process.argv[1];
const waveCmd = process.argv[2];
process.chdir(ghostDir);
process.stdout.write('READY\\n');
process.stdin.once('data', () => {
  // cwd 已被父进程删除，此处进程 cwd 指向已不存在的目录
  try {
    const child = spawn('"' + waveCmd + '"', ['--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      shell: true,
    });
    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    const timer = setTimeout(() => {
      child.kill();
      setTimeout(() => {
        console.log(JSON.stringify({ status: 'ALIVE', stderr, stdout }));
        process.exit(0);
      }, 1000);
    }, 3000);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      console.log(JSON.stringify({ status: 'EXIT', code, signal, stderr, stdout }));
      process.exit(0);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      console.log(JSON.stringify({ status: 'SPAWN_ERROR', msg: err.message, stderr, stdout }));
      process.exit(0);
    });
  } catch (err) {
    console.log(JSON.stringify({ status: 'THROW', msg: err.message }));
    process.exit(1);
  }
});
`,
);

let fOut = '';
const fResult = await new Promise((resolve) => {
  const helper = spawn(process.execPath, [helperPath, ghostDir, waveCmd], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  helper.stdout.on('data', (d) => (fOut += d.toString('utf8')));
  helper.stderr.on('data', (d) => (fOut += `[helper stderr] ${d.toString('utf8')}`));
  helper.stdout.once('data', () => {
    // READY 已收到 → 删除 helper 的 cwd
    try {
      rmSync(ghostDir, { recursive: true, force: true });
      console.log('[diag] ghost cwd deleted:', ghostDir);
    } catch (err) {
      console.log(`[diag] rmSync ghost cwd failed: ${err.message}`);
    }
    helper.stdin.write('GO\n');
  });
  helper.on('exit', (code) => {
    const lines = fOut.trim().split('\n');
    let jsonLine = lines.find((l) => l.startsWith('{'));
    let parsed = null;
    if (jsonLine) {
      try {
        parsed = JSON.parse(jsonLine);
      } catch {
        parsed = null;
      }
    }
    resolve({ code, fOut, parsed });
  });
});

console.log(`helper exit code: ${fResult.code}`);
console.log('helper output:');
console.log(fResult.fOut);
if (fResult.parsed) {
  const p = fResult.parsed;
  console.log(
    `status: ${p.status}${p.code !== null && p.code !== undefined ? ` code=${p.code}` : ''}${p.signal ? ` signal=${p.signal}` : ''}`,
  );
  if (p.msg) console.log(`msg: ${p.msg}`);
  if (p.stderr?.trim()) console.log(`stderr: ${JSON.stringify(p.stderr)}`);
  if (p.stdout?.trim()) console.log(`stdout: ${JSON.stringify(p.stdout)}`);
}

try {
  rmSync(root, { recursive: true, force: true });
} catch (e) {
  console.log(`[diag] cleanup warning: ${e.message}`);
}

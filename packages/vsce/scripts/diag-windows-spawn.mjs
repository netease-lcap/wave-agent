#!/usr/bin/env node
/**
 * 临时诊断脚本（用完删除）：复现 VS Code 扩展宿主 spawn `wave.cmd --stdio` 报
 * 「系统找不到指定的路径。」（ERROR_PATH_NOT_FOUND, exit code 1）的场景。
 *
 * 模拟 stdioClient.ts 的 spawn 调用：
 *   spawn(`"${binaryPath}"`, ['--stdio'], { stdio:['pipe','pipe','pipe'], env:{...process.env}, shell:true })
 *
 * 核心理论：cmd.exe 报「系统找不到指定的路径。」（错误码 3）只在程序路径中
 * 某个目录不存在时发生——即 wave.cmd 本身或 shim 引用的
 * %dp0%\node_modules\wave-code\bin\wave-code.js 所在目录缺失。
 *
 * 场景：
 *   A-E. 基线（正常/cwd 缺失/PATH 缺 node/组合/继承 cwd）
 *   F.   进程 cwd 指向已删除目录（helper 子进程；Windows 上不可达，EBUSY）
 *   G.   真实 wave-code 0.19.7 vs 1.0.4 tarball（fetch 下载，非 npm install）
 *   H.   路径状态矩阵 —— 定位「系统找不到指定的路径。」的确切触发条件（核心）
 *        H1 程序路径目录不存在
 *        H2 wave.cmd 存在但 shim 引用的 JS 目录不存在（npm 安装中断/布局分离）
 *        H3 shim 引用的 JS 文件不存在（目录在）
 *        H4 完整布局（对照，期望 ALIVE）
 *        H5 shim 内 node 不在 PATH（GUI 最小 PATH）
 *
 * 运行：node packages/vsce/scripts/diag-windows-spawn.mjs （仅 Windows）
 */
import { spawn, execSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fs_exists = (p) => existsSync(p);

console.log(`[diag] platform=${process.platform} node=${process.version} arch=${process.arch}`);

// ── 构造模拟 npm 全局安装目录 ───────────────────────────────────
const root = mkdtempSync(path.join(os.tmpdir(), 'wave-diag-'));
const binDir = path.join(root, 'node_modules', 'wave-code', 'bin');
mkdirSync(binDir, { recursive: true });

// npm 生成的 wave.cmd shim（与真实全局安装完全一致，dp0=<prefix>）
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
function trySpawn(label, targetCmd, { cwd, pathEnv, inheritCwd = false }) {
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: pathEnv ?? process.env.PATH };
    const command = `"${targetCmd}"`;
    const child = spawn(command, ['--stdio'], {
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
      child.once('exit', () => resolve({ label, status: 'ALIVE (3s, expected success)', code: null, signal: null, stderr, stdout }));
      setTimeout(() => resolve({ label, status: 'ALIVE (3s, expected success)', code: null, signal: null, stderr, stdout }), 1000);
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

// ── 基线场景 A-E ────────────────────────────────────────────────
const validCwd = root;
const missingCwd = path.join(os.tmpdir(), 'wave-diag-missing-' + Date.now());
const nodeDir = path.dirname(process.execPath);

// PATH 移除 node 目录（模拟 GUI 启动的 VS Code 继承注册表 PATH）
const pathNoNode = (process.env.PATH ?? '')
  .split(';')
  .filter((p) => p && path.resolve(p).toLowerCase() !== nodeDir.toLowerCase())
  .join(';');

// GUI 最小 PATH（VS Code 从注册表继承，通常只有系统目录）
const guiPath = [process.env.SystemRoot + '\\System32', process.env.SystemRoot, process.env.SystemRoot + '\\System32\\Wbem'].join(';');

console.log(`[diag] node dir (removed in C/D) = ${nodeDir}`);
console.log(`[diag] missing cwd (B/D)         = ${missingCwd}`);

const a = await trySpawn('A. normal (valid cwd, full PATH)', waveCmd, { cwd: validCwd });
printResult(a);
const b = await trySpawn('B. cwd does not exist', waveCmd, { cwd: missingCwd });
printResult(b);
const c = await trySpawn('C. PATH without node dir', waveCmd, { cwd: validCwd, pathEnv: pathNoNode });
printResult(c);
const d = await trySpawn('D. cwd missing + PATH without node', waveCmd, { cwd: missingCwd, pathEnv: pathNoNode });
printResult(d);
const e = await trySpawn('E. inherit cwd (like extension host)', waveCmd, { inheritCwd: true });
printResult(e);

// ── H. 路径状态矩阵（核心）────────────────────────────────────────
// 构造多种「wave.cmd 与 node_modules 布局」组合，精确复现错误码 3。
console.log('\n===== H. path-state matrix (target: ERROR_PATH_NOT_FOUND) =====');

function makeShimAt(dir) {
  const shim = path.join(dir, 'wave.cmd');
  writeFileSync(
    shim,
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
  return shim;
}

// H1: spawn 的路径本身目录不存在
const h1Cmd = path.join(os.tmpdir(), 'wave-diag-nonexistent-dir', 'wave.cmd');
printResult(await trySpawn('H1. program path dir missing', h1Cmd, { cwd: validCwd }));

// H2: wave.cmd 存在，但 shim 引用的 %dp0%\node_modules\wave-code\bin\ 目录不存在
const h2Dir = path.join(root, 'h2');
mkdirSync(h2Dir);
const h2Cmd = makeShimAt(h2Dir);
printResult(await trySpawn('H2. shim OK but JS dir missing (broken install)', h2Cmd, { cwd: validCwd }));

// H3: bin 目录存在但 wave-code.js 文件缺失
const h3Dir = path.join(root, 'h3');
const h3Bin = path.join(h3Dir, 'node_modules', 'wave-code', 'bin');
mkdirSync(h3Bin, { recursive: true });
const h3Cmd = makeShimAt(h3Dir);
printResult(await trySpawn('H3. JS dir OK but wave-code.js file missing', h3Cmd, { cwd: validCwd }));

// H4: 完整布局（对照）
const h4Dir = path.join(root, 'h4');
const h4Bin = path.join(h4Dir, 'node_modules', 'wave-code', 'bin');
mkdirSync(h4Bin, { recursive: true });
writeFileSync(path.join(h4Bin, 'wave-code.js'), ['process.stdin.resume();', 'setTimeout(() => process.exit(0), 60000);'].join('\n'));
const h4Cmd = makeShimAt(h4Dir);
printResult(await trySpawn('H4. complete layout (control)', h4Cmd, { cwd: validCwd }));

// H5: shim 内 node 不在 PATH（GUI 最小 PATH）
printResult(await trySpawn('H5. shim OK + node not on PATH (GUI PATH)', h4Cmd, { cwd: validCwd, pathEnv: guiPath }));

// ── I. where wave 输出顺序 + 新旧解析逻辑对比 ──────────────────────
// 0.19.7 时代旧代码取 where 第一行；1.0.x 用 pickExecutableLine 偏好 .cmd。
// 验证：真实 npm 全局目录中无扩展名 launcher 在 .cmd 之前，以及两者 spawn 行为。
console.log('\n===== I. where wave ordering + old/new resolver pick =====');
const fakeNpmDir = path.join(root, 'fake-npm-global');
mkdirSync(fakeNpmDir);
// npm 全局安装生成三个文件：wave（无扩展名 bash launcher）、wave.cmd、wave.ps1
writeFileSync(
  path.join(fakeNpmDir, 'wave'),
  [
    '#!/bin/sh',
    `basedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")`,
    'case `uname` in',
    '    *CYGWIN*|*MINGW*|*MSYS*)',
    '        if command -v cygpath > /dev/null 2>&1; then',
    '            basedir=`cygpath -w "$basedir"`',
    '        fi',
    '    ;;',
    'esac',
    'if [ -x "$basedir/node" ]; then',
    '  exec "$basedir/node"  "$basedir/node_modules/wave-code/bin/wave-code.js" "$@"',
    'else',
    '  exec node  "$basedir/node_modules/wave-code/bin/wave-code.js" "$@"',
    'fi',
    '',
  ].join('\n'),
);
makeShimAt(fakeNpmDir);
writeFileSync(path.join(fakeNpmDir, 'wave.ps1'), ['# dummy', ''].join('\n'));
// fake-npm 目录的 node_modules（让 H4 式完整布局在 I 场景也能 ALIVE）
const fakeNpmBin = path.join(fakeNpmDir, 'node_modules', 'wave-code', 'bin');
mkdirSync(fakeNpmBin, { recursive: true });
writeFileSync(path.join(fakeNpmBin, 'wave-code.js'), ['process.stdin.resume();', 'setTimeout(() => process.exit(0), 60000);'].join('\n'));
// 把 fakeNpmDir 放到 PATH 最前面，模拟用户 npm 全局目录
const iPath = fakeNpmDir + ';' + process.env.PATH;
const iEnv = { ...process.env, PATH: iPath };
try {
  const whereOut = execSync('where wave', { encoding: 'utf-8', env: iEnv, stdio: ['ignore', 'pipe', 'ignore'] });
  const lines = whereOut.split('\n').map((l) => l.trim()).filter(Boolean);
  console.log(`[diag] where wave output (${lines.length} lines):`);
  lines.forEach((l, i) => console.log(`  [${i}] ${l}`));
  // 旧逻辑：取第一行
  console.log(`\n[diag] OLD resolver picks: ${lines[0] ?? '(empty)'}`);
  // 新逻辑：pickExecutableLine（偏好 .cmd/.exe/.bat）
  const pick = lines.find((l) => /\.(cmd|exe|bat)$/i.test(l)) ?? lines[0];
  console.log(`[diag] NEW resolver picks: ${pick}`);
  // 分别 spawn 两者（用旧/新解析出的路径）
  if (lines[0]) printResult(await trySpawn('I. OLD pick (first line) spawn', lines[0], { cwd: validCwd, pathEnv: iPath }));
  if (pick) printResult(await trySpawn('I. NEW pick (.cmd line) spawn', pick, { cwd: validCwd, pathEnv: iPath }));
} catch (err) {
  console.log(`[diag] where wave failed: ${err.message}`);
}

// ── K. 含空格 + 中文目录名路径 spawn（真实用户路径盲点）───────────────
// 此前所有场景都在无空格路径（CI runner 8.3 短名 C:\Users\RUNNER~1）下验证。
// 真实用户路径 C:\Users\张三\AppData\Roaming\npm 含空格/非 ASCII，cmd.exe 的
// 引号剥离规则（cmd /? 规则 2）在含空格路径下行为不同，可能报错误码 3。
console.log('\n===== K. path with spaces + CJK (user-realistic) =====');
const kDir = path.join(os.tmpdir(), 'wave agent 测试', 'npm-global');
const kBin = path.join(kDir, 'node_modules', 'wave-code', 'bin');
mkdirSync(kBin, { recursive: true });
const kCmd = makeShimAt(kDir);
writeFileSync(path.join(kBin, 'wave-code.js'), ['process.stdin.resume();', 'setTimeout(() => process.exit(0), 60000);'].join('\n'));
console.log(`[diag] K wave.cmd = ${kCmd}`);
printResult(await trySpawn('K1. spaced+CJK path, complete layout', kCmd, { cwd: validCwd }));
// K2: 目录存在但 wave.cmd 文件不存在（模拟 where 找到的是 .cmd 但已被删除）
const kMissingCmd = path.join(kDir, 'wave.cmd');
if (existsSync(kMissingCmd)) rmSync(kMissingCmd, { force: true });
printResult(await trySpawn('K2. spaced+CJK path, shim file deleted', kMissingCmd, { cwd: validCwd }));

// ── G. 真实 wave-code 版本对比（0.19.7 vs 1.0.4，fetch tarball）──────
// 用户线索：0.19.7 时正常，1.0.x 升级后出现「系统找不到指定的路径。」。
// npm install -g 在 Windows runner 上超时（120s），改用 fetch 下载 tarball。
console.log('\n===== G. real wave-code version comparison (tarball) =====');
const realRoot = path.join(os.tmpdir(), 'wave-diag-real-' + Date.now());
mkdirSync(realRoot, { recursive: true });

async function fetchTarball(ver) {
  const url = `https://registry.npmjs.org/wave-code/-/wave-code-${ver}.tgz`;
  const tarball = path.join(realRoot, `wave-code-${ver}.tgz`);
  console.log(`[diag] fetching ${url} ...`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch failed: HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  writeFileSync(tarball, buf);
  console.log(`[diag] ${ver}: downloaded ${buf.length} bytes`);
  return tarball;
}

for (const ver of ['0.19.7', '1.0.4']) {
  const extractDir = path.join(realRoot, `wv-${ver}`);
  try {
    const tarball = await fetchTarball(ver);
    mkdirSync(extractDir, { recursive: true });
    // Windows 10+ 自带 bsdtar，支持 .tgz
    execSync(`tar -xzf "${tarball}" -C "${extractDir}"`, { stdio: 'pipe' });
    const pkgDir = path.join(extractDir, 'package');
    const pkgJson = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(path.join(pkgDir, 'package.json'), 'utf8')));
    console.log(`[diag] ${ver}: version=${pkgJson.version} bin=${JSON.stringify(pkgJson.bin)}`);
    console.log(
      `[diag] ${ver}: bin/wave-code.js exists=${fs_exists(path.join(pkgDir, 'bin', 'wave-code.js'))} dist/cli.js exists=${fs_exists(path.join(pkgDir, 'dist', 'cli.js'))}`,
    );
    const list = execSync(`tar -tzf "${tarball}"`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    const top = list.split('\n').filter(Boolean).map((l) => l.replace(/^package\//, '')).sort();
    console.log(`[diag] ${ver}: package entries (${top.length}):`);
    console.log(top.join('\n'));
  } catch (err) {
    console.log(`[diag] ${ver} failed: ${err.message}`);
  }
}

// ── L. 完整模拟用户环境：0.19.7 → npm 升级 1.0.4 → spawn ──────────────
// 用户线索「0.19.7 时正常，1.0.x 升级后报错」：VSCE 1.0.x pre-spawn 升级 CLI
// （ensureCliUpToDate → upgradeWaveBinary → npm install -g）。此处用真实 npm
// 在含空格+中文目录下做同样升级，观察升级后 binaryPath 与 spawn 结果。
console.log('\n===== L. full user upgrade path: 0.19.7 -> npm i -g 1.0.4 -> spawn =====');
const upgradeRoot = path.join(os.tmpdir(), 'wave upgrade 测试');
const upgradeDir = path.join(upgradeRoot, 'npm-global');
mkdirSync(upgradeDir, { recursive: true });
try {
  // L1: 下载 0.19.7 tarball，解压为 node_modules/wave-code（真实 CLI 文件）
  const tarball197 = await fetchTarball('0.19.7');
  const wcDir = path.join(upgradeDir, 'node_modules', 'wave-code');
  mkdirSync(wcDir, { recursive: true });
  execSync(`tar -xzf "${tarball197}" -C "${wcDir}" --strip-components=1`, { stdio: 'pipe' });
  console.log(`[diag] L: 0.19.7 extracted to ${wcDir}`);

  // L2: npm 风格 shim + PATH 前缀
  makeShimAt(upgradeDir);
  const lPath = upgradeDir + ';' + process.env.PATH;
  const lEnv = { ...process.env, PATH: lPath };

  // L3: 模拟 VSCE init — where wave + pickExecutableLine(.cmd 偏好)
  const where197 = execSync('where wave', { encoding: 'utf-8', env: lEnv, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  console.log(`[diag] L: where wave (0.19.7):\n${where197}`);
  const pick197 = where197.split('\n').map((l) => l.trim()).filter(Boolean).find((l) => /\.(cmd|exe|bat)$/i.test(l));
  console.log(`[diag] L: pickExecutableLine -> ${pick197}`);

  // L4: 真实执行 0.19.7 的 -v
  let ver197 = null;
  try {
    ver197 = execFileSync(`"${pick197}"`, ['-v'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000, shell: true }).trim();
  } catch (e) {
    console.log(`[diag] L: -v (0.19.7) failed: ${e.message}`);
  }
  console.log(`[diag] L: wave -v (before upgrade) = ${ver197}`);

  // L5: 模拟 upgradeWaveBinary — 真实 npm install -g（--prefix 限定目录）
  const whereNpm = execSync('where npm', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const npmPick = whereNpm.split('\n').map((l) => l.trim()).filter(Boolean).find((l) => /\.(cmd|exe)$/i.test(l));
  console.log(`[diag] L: npm = ${npmPick}`);
  console.log('[diag] L: npm install -g wave-code@1.0.4 --prefix=... (may take a while)...');
  const t0 = Date.now();
  try {
    execFileSync(`"${npmPick}"`, ['install', '-g', 'wave-code@1.0.4', `--prefix=${upgradeDir}`, '--registry=https://registry.npmjs.org'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300000,
      shell: true,
    });
    console.log(`[diag] L: npm install done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.log(`[diag] L: npm install FAILED: ${e.message}`);
    console.log(`[diag] L: npm stderr tail: ${String(e.stderr ?? '').slice(-500)}`);
  }

  // L6: 升级后重新解析 + 布局检查（对应 upgradeWaveBinary 里的 resolveWaveBinary()）
  const where104 = execSync('where wave', { encoding: 'utf-8', env: lEnv, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  console.log(`[diag] L: where wave (after upgrade):\n${where104}`);
  const pick104 = where104.split('\n').map((l) => l.trim()).filter(Boolean).find((l) => /\.(cmd|exe|bat)$/i.test(l));
  console.log(`[diag] L: re-resolved -> ${pick104}`);
  const js104 = path.join(upgradeDir, 'node_modules', 'wave-code', 'bin', 'wave-code.js');
  console.log(`[diag] L: bin/wave-code.js exists=${fs_exists(js104)} dist/cli.js exists=${fs_exists(path.join(upgradeDir, 'node_modules', 'wave-code', 'dist', 'cli.js'))}`);
  if (pick104 && existsSync(pick104)) {
    console.log(`[diag] L: wave.cmd content (after npm rewrite):\n${readFileSync(pick104, 'utf8')}`);
  }
  let ver104 = null;
  try {
    ver104 = execFileSync(`"${pick104}"`, ['-v'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000, shell: true }).trim();
  } catch (e) {
    console.log(`[diag] L: -v (after) failed: ${e.message}`);
  }
  console.log(`[diag] L: wave -v (after upgrade) = ${ver104}`);

  // L7: spawn（与 stdioClient 完全一致）
  if (pick104) {
    printResult(await trySpawn('L. post-upgrade spawn --stdio', pick104, { cwd: validCwd, pathEnv: lPath }));
  }
} catch (err) {
  console.log(`[diag] L failed: ${err.message}`);
}

// ── cleanup ────────────────────────────────────────────────────────
try {
  rmSync(root, { recursive: true, force: true });
} catch (e) {
  console.log(`[diag] cleanup warning: ${e.message}`);
}
try {
  rmSync(realRoot, { recursive: true, force: true });
} catch (e) {
  console.log(`[diag] cleanup warning (realRoot): ${e.message}`);
}
try {
  rmSync(path.join(os.tmpdir(), 'wave agent 测试'), { recursive: true, force: true });
  rmSync(path.join(os.tmpdir(), 'wave upgrade 测试'), { recursive: true, force: true });
} catch (e) {
  console.log(`[diag] cleanup warning (k/upgrade): ${e.message}`);
}
console.log('\n[diag] done');

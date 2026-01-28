import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const type = process.argv[2] || 'patch';
const pkgPath = path.resolve(process.cwd(), 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const oldVersion = pkg.version;
const versionMatch = oldVersion.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);

if (!versionMatch) {
  console.error(`Invalid version format: ${oldVersion}`);
  process.exit(1);
}

const parts = [
  parseInt(versionMatch[1], 10),
  parseInt(versionMatch[2], 10),
  parseInt(versionMatch[3], 10)
];
const suffix = versionMatch[4];

if (type === 'major') {
  parts[0]++;
  parts[1] = 0;
  parts[2] = 0;
} else if (type === 'minor') {
  parts[1]++;
  parts[2] = 0;
} else if (type === 'patch') {
  parts[2]++;
} else {
  console.error(`Invalid version type: ${type}. Use major, minor, or patch.`);
  process.exit(1);
}

const newVersion = parts.join('.') + (type === 'patch' ? suffix : '');
pkg.version = newVersion;

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`${pkg.name}: ${oldVersion} -> ${newVersion}`);

try {
  execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
  execSync(`git add ${pkgPath}`, { stdio: 'inherit' });
  execSync(`git commit -m "chore: bump ${pkg.name} to v${newVersion}"`, { stdio: 'inherit' });
  const tagName = `v${newVersion}-${pkg.name}`;
  execSync(`git tag ${tagName}`, { stdio: 'inherit' });
  console.log(`Created tag: ${tagName}`);
  console.log(`\nTo publish this version, run:\n  git push origin ${tagName}\n`);
} catch (error) {
  // Ignore errors if git is not available or nothing to commit
}

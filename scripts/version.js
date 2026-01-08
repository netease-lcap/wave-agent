import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const type = process.argv[2] || 'patch';
const pkgPath = path.resolve(process.cwd(), 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const oldVersion = pkg.version;
const parts = oldVersion.split('.').map((n) => parseInt(n, 10));

if (parts.length !== 3 || parts.some(isNaN)) {
  console.error(`Invalid version format: ${oldVersion}`);
  process.exit(1);
}

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

const newVersion = parts.join('.');
pkg.version = newVersion;

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`${pkg.name}: ${oldVersion} -> ${newVersion}`);

try {
  execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
  execSync(`git add ${pkgPath}`, { stdio: 'inherit' });
  execSync(`git commit -m "chore: bump ${pkg.name} to v${newVersion}"`, {
    stdio: 'inherit',
  });
} catch (error) {
  // Ignore errors if git is not available or nothing to commit
}

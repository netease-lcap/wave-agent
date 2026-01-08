import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const type = args.find(arg => !arg.startsWith('--')) || 'patch';
const shouldTag = args.includes('--tag');

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
} else if (type !== 'none') {
  console.error(`Invalid version type: ${type}. Use major, minor, patch, or none.`);
  process.exit(1);
}

const newVersion = parts.join('.');
if (type !== 'none') {
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`${pkg.name}: ${oldVersion} -> ${newVersion}`);
}

try {
  execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
  if (type !== 'none') {
    execSync(`git add ${pkgPath}`, { stdio: 'inherit' });
    execSync(`git commit -m "chore: bump ${pkg.name} to v${newVersion}"`, {
      stdio: 'inherit',
    });
  }

  if (shouldTag) {
    const tag = `v${newVersion}`;
    console.log(`Tagging ${tag}...`);
    try {
      execSync(`git tag ${tag}`, { stdio: 'inherit' });
    } catch (e) {
      console.log(`Tag ${tag} already exists, skipping tag creation.`);
    }
  }
} catch (error) {
  console.error('Git operation failed:', error.message);
}

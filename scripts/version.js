import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const type = process.argv[2] || 'patch';
const isAll = process.argv[3] === 'all';

function bumpVersion(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const oldVersion = pkg.version;
  const versionMatch = oldVersion.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);

  if (!versionMatch) {
    console.error(`Invalid version format in ${pkgPath}: ${oldVersion}`);
    return null;
  }

  const parts = [
    parseInt(versionMatch[1], 10),
    parseInt(versionMatch[2], 10),
    parseInt(versionMatch[3], 10),
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
  return { name: pkg.name, version: newVersion, path: pkgPath };
}

const results = [];
if (isAll) {
  // Bump root
  const rootPkg = bumpVersion(path.resolve(process.cwd(), 'package.json'));
  if (rootPkg) results.push(rootPkg);

  // Bump packages
  const packagesDir = path.resolve(process.cwd(), 'packages');
  const dirs = fs.readdirSync(packagesDir);
  for (const dir of dirs) {
    const pkgPath = path.resolve(packagesDir, dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const res = bumpVersion(pkgPath);
      if (res) results.push(res);
    }
  }
} else {
  const res = bumpVersion(path.resolve(process.cwd(), 'package.json'));
  if (res) results.push(res);
}

if (results.length > 0) {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
    for (const res of results) {
      execSync(`git add ${res.path}`, { stdio: 'inherit' });
    }

    const mainPkg = results[0];
    const tagName = isAll ? `v${mainPkg.version}` : `v${mainPkg.version}-${mainPkg.name}`;
    const commitMsg = isAll
      ? `chore: bump all versions to v${mainPkg.version}`
      : `chore: bump ${mainPkg.name} to v${mainPkg.version}`;

    // Get commit messages since last tag
    let changelog = '';
    try {
      // Get the most recent tag that is reachable from HEAD
      const lastTag = execSync('git tag --list "v*" --sort=-v:refname | head -n 1', { encoding: 'utf8' }).trim();
      if (lastTag) {
        changelog = execSync(`git log ${lastTag}..HEAD --pretty=format:"- %s (%h)"`, { encoding: 'utf8' }).trim();
      } else {
        changelog = execSync('git log --pretty=format:"- %s (%h)"', { encoding: 'utf8' }).trim();
      }
    } catch (e) {
      changelog = execSync('git log --pretty=format:"- %s (%h)"', { encoding: 'utf8' }).trim();
    }

    execSync(`git commit -m "${commitMsg}" --no-verify`, { stdio: 'inherit' });
    execSync(`git tag -a ${tagName} -m "${commitMsg}\n\n${changelog}"`, { stdio: 'inherit' });
    console.log(`Created tag: ${tagName}`);
    console.log(`\nChangelog:\n${changelog}\n`);
    console.log(`\nTo publish this version, run:\n  git push origin ${tagName}\n`);
  } catch (error) {
    console.error('Git operation failed:', error.message);
  }
}

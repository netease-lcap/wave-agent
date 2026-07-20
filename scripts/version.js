import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const type = process.argv[2] || 'patch';
const isAll = process.argv[3] === 'all';

export function bumpVersion(pkgPath) {
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
  return setVersion(pkgPath, newVersion);
}

// Overwrite a package's version to an explicit target (used to keep all
// packages in the monorepo on the same version as the root).
export function setVersion(pkgPath, newVersion) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const oldVersion = pkg.version;
  if (oldVersion === newVersion) {
    return null;
  }
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`${pkg.name}: ${oldVersion} -> ${newVersion}`);
  return { name: pkg.name, version: newVersion, path: pkgPath };
}

export function bumpGradleProperties(propsPath, newVersion) {
  const content = fs.readFileSync(propsPath, 'utf8');
  const oldMatch = content.match(/^pluginVersion=(.*)$/m);
  const oldVersion = oldMatch ? oldMatch[1] : '';
  const replaced = content.replace(/^pluginVersion=.*$/m, `pluginVersion=${newVersion}`);
  if (replaced !== content) {
    fs.writeFileSync(propsPath, replaced);
  }
  console.log(`wave-jetbrains: ${oldVersion} -> ${newVersion}`);
  return { name: 'wave-jetbrains', version: newVersion, path: propsPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = [];
  if (isAll) {
    // Bump root first to determine the target version for the whole monorepo.
    const rootPkg = bumpVersion(path.resolve(process.cwd(), 'package.json'));
    if (rootPkg) results.push(rootPkg);

    // Sync every sub-package to the root's new version so the monorepo stays
    // on a single consistent version (independent bumps drift when packages
    // are added/removed mid-release).
    const packagesDir = path.resolve(process.cwd(), 'packages');
    const dirs = fs.readdirSync(packagesDir);
    for (const dir of dirs) {
      const pkgPath = path.resolve(packagesDir, dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const res = setVersion(pkgPath, rootPkg.version);
        if (res) results.push(res);
      } else {
        // Packages without package.json (e.g. jetbrains) may have a gradle.properties
        // with a pluginVersion= field that must stay in sync with the monorepo version.
        const propsPath = path.resolve(packagesDir, dir, 'gradle.properties');
        if (fs.existsSync(propsPath)) {
          const res = bumpGradleProperties(propsPath, rootPkg.version);
          if (res) results.push(res);
        }
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

      execSync(`git commit -m "${commitMsg}" --no-verify`, { stdio: 'inherit' });

      execSync(`git tag -a ${tagName} -m "${commitMsg.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
      console.log(`Created tag: ${tagName}`);
      console.log(`\nTo publish this version, run:\n  git push origin ${tagName}\n`);
    } catch (error) {
      console.error('Git operation failed:', error.message);
      process.exit(1);
    }
  }
}

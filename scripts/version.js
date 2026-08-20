import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// GUI 包已内置 CLI，独立发版，不参与 npm 线锁步。
const GUI_PACKAGES = new Set(["wave-desktop", "wave-vscode", "wave-jetbrains"]);

const type = process.argv[2] || "patch";

// 解析 --package 后的包名列表（可多个）。
function parsePackageArgs(argv) {
  const out = [];
  let collecting = false;
  for (const arg of argv) {
    if (arg === "--package") {
      collecting = true;
    } else if (arg.startsWith("-")) {
      collecting = false;
    } else if (collecting) {
      out.push(arg);
    }
  }
  return out;
}

// Compute the next version for a given bump type, or null for an invalid format.
function nextVersion(oldVersion) {
  const versionMatch = oldVersion.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!versionMatch) {
    console.error(`Invalid version format: ${oldVersion}`);
    return null;
  }

  const parts = [
    parseInt(versionMatch[1], 10),
    parseInt(versionMatch[2], 10),
    parseInt(versionMatch[3], 10),
  ];
  const suffix = versionMatch[4];

  if (type === "major") {
    parts[0]++;
    parts[1] = 0;
    parts[2] = 0;
  } else if (type === "minor") {
    parts[1]++;
    parts[2] = 0;
  } else if (type === "patch") {
    parts[2]++;
  } else {
    console.error(`Invalid version type: ${type}. Use major, minor, or patch.`);
    process.exit(1);
  }

  return parts.join(".") + (type === "patch" ? suffix : "");
}

export function bumpVersion(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const newVersion = nextVersion(pkg.version);
  if (newVersion === null) {
    return null;
  }
  return setVersion(pkgPath, newVersion);
}

// Overwrite a package's version to an explicit target (used to keep all
// packages in the monorepo on the same version as the root).
export function setVersion(pkgPath, newVersion) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const oldVersion = pkg.version;
  if (oldVersion === newVersion) {
    return null;
  }
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`${pkg.name}: ${oldVersion} -> ${newVersion}`);
  return { name: pkg.name, version: newVersion, path: pkgPath };
}

export function bumpGradleProperties(propsPath, newVersion) {
  const content = fs.readFileSync(propsPath, "utf8");
  const oldMatch = content.match(/^pluginVersion=(.*)$/m);
  const oldVersion = oldMatch ? oldMatch[1] : "";
  const replaced = content.replace(
    /^pluginVersion=.*$/m,
    `pluginVersion=${newVersion}`,
  );
  if (replaced !== content) {
    fs.writeFileSync(propsPath, replaced);
  }
  console.log(`wave-jetbrains: ${oldVersion} -> ${newVersion}`);
  return { name: "wave-jetbrains", version: newVersion, path: propsPath };
}

// Bump jetbrains by one step based on its current pluginVersion.
export function bumpGradleVersion(propsPath) {
  const content = fs.readFileSync(propsPath, "utf8");
  const match = content.match(/^pluginVersion=(.*)$/m);
  if (!match) {
    console.error(`Missing pluginVersion in ${propsPath}`);
    return null;
  }
  const newVersion = nextVersion(match[1]);
  if (newVersion === null) {
    return null;
  }
  return bumpGradleProperties(propsPath, newVersion);
}

// Build a name -> { path, kind } map for every package in packages/.
// Packages without package.json (e.g. jetbrains) use gradle.properties.
function discoverPackages() {
  const packagesDir = path.resolve(process.cwd(), "packages");
  const map = new Map();
  for (const dir of fs.readdirSync(packagesDir)) {
    const pkgPath = path.resolve(packagesDir, dir, "package.json");
    const propsPath = path.resolve(packagesDir, dir, "gradle.properties");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      map.set(pkg.name, { path: pkgPath, kind: "pkg" });
    } else if (fs.existsSync(propsPath)) {
      map.set("wave-jetbrains", { path: propsPath, kind: "gradle" });
    }
  }
  return { map, packagesDir };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const packageArgs = parsePackageArgs(process.argv.slice(3));
  const results = [];
  const { map, packagesDir } = discoverPackages();

  if (packageArgs.length === 0) {
    // npm 线锁步：bump root 确定目标版本，其余非 GUI 包同步到该版本。
    const rootPkg = bumpVersion(path.resolve(process.cwd(), "package.json"));
    if (!rootPkg) {
      console.error("Failed to bump root package version.");
      process.exit(1);
    }
    results.push(rootPkg);

    for (const [name, target] of map) {
      if (GUI_PACKAGES.has(name)) continue;
      const res =
        target.kind === "pkg"
          ? setVersion(target.path, rootPkg.version)
          : bumpGradleProperties(target.path, rootPkg.version);
      if (res) results.push(res);
    }
  } else {
    // GUI 独立发布：各自基于当前版本 bump，版本互不联动。
    for (const name of packageArgs) {
      const target = map.get(name);
      if (!target) {
        console.error(
          `Unknown package: ${name}. Available: ${[...map.keys()].join(", ")}`,
        );
        process.exit(1);
      }
      const res =
        target.kind === "pkg"
          ? bumpVersion(target.path)
          : bumpGradleVersion(target.path);
      if (res) results.push(res);
    }
  }

  if (results.length > 0) {
    try {
      execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });
      for (const res of results) {
        execSync(`git add ${res.path}`, { stdio: "inherit" });
      }

      // npm 线打 vX.Y.Z；GUI 独立打 wave-<name>@X.Y.Z（name 已含 wave- 前缀，多包时各打各的）。
      const tags =
        packageArgs.length === 0
          ? [`v${results[0].version}`]
          : results.map((r) => `${r.name}@${r.version}`);
      const commitMsg =
        packageArgs.length === 0
          ? `chore: bump all versions to v${results[0].version}`
          : `chore: bump ${results.map((r) => `${r.name} to v${r.version}`).join(", ")}`;

      execSync(`git commit -m "${commitMsg}" --no-verify`, {
        stdio: "inherit",
      });

      for (const tagName of tags) {
        execSync(
          `git tag -a ${tagName} -m "${commitMsg.replace(/"/g, '\\"')}"`,
          { stdio: "inherit" },
        );
        console.log(`Created tag: ${tagName}`);
      }
      console.log(
        `\nTo publish this version, run:\n  git push origin ${tags.join(" ")}\n`,
      );
    } catch (error) {
      console.error("Git operation failed:", error.message);
      process.exit(1);
    }
  }
}

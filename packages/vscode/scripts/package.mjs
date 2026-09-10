import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const rootDir = path.join(__dirname, "..");

  // Ensure we are in the root directory
  process.chdir(rootDir);

  const args = process.argv.slice(2);
  const packageCurrent = args.includes("--current");
  // The marketplace refuses to publish a package as pre-release unless it was
  // *packaged* as pre-release (vsce stamps Microsoft.VisualStudio.Code.PreRelease
  // into the manifest), so the CI artifact can never be re-published to the
  // pre-release channel — that path has to be packaged locally.
  const preRelease = args.includes("--pre-release");

  // Run build first
  console.log("Running npm run esbuild:prod...");
  execSync("npm run esbuild:prod", { stdio: "inherit" });

  const vsceArgs = [
    packageCurrent ? "" : "--no-dependencies",
    preRelease ? "--pre-release" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Ensure releases directory exists
  const releasesDir = path.join(rootDir, "releases");
  if (!fs.existsSync(releasesDir)) {
    fs.mkdirSync(releasesDir, { recursive: true });
  }

  // Clean up old .vsix files in releases directory
  for (const f of fs.readdirSync(releasesDir)) {
    if (f.endsWith(".vsix")) {
      fs.unlinkSync(path.join(releasesDir, f));
      console.log(`Cleaned up old vsix: ${f}`);
    }
  }

  console.log(`\n=== Packaging extension ===`);
  const pkg = JSON.parse(
    fs.readFileSync(path.join(rootDir, "package.json"), "utf-8"),
  );
  const version = pkg.version;
  const vsixName = `${pkg.name}-${version}.vsix`;
  const vsixPath = path.join(releasesDir, vsixName);
  execSync(`npx @vscode/vsce package --out ${vsixPath} ${vsceArgs}`, {
    stdio: "inherit",
  });

  console.log(`\nCreated releases/${vsixName}`);
  console.log("\nAll targets processed successfully!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

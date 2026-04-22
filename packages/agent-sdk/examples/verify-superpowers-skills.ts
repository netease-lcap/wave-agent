import { MarketplaceService } from "../src/services/MarketplaceService.js";
import { ConfigurationService } from "../src/services/configurationService.js";
import { PluginLoader } from "../src/services/pluginLoader.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

/**
 * Verifies that all skills from the superpowers plugin (sourced via Git URL)
 * are properly loaded by Wave's PluginLoader.
 *
 * marketplace.json entry format:
 * {
 *   "name": "superpowers",
 *   "source": { "source": "url", "url": "https://github.com/obra/superpowers.git" }
 * }
 */
async function main() {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wave-superpowers-skills-"),
  );
  const marketplaceDir = path.join(tempDir, "my-marketplace");
  await fs.mkdir(path.join(marketplaceDir, ".wave-plugin"), {
    recursive: true,
  });

  // 1. Create marketplace.json with url-type object source
  const marketplaceManifest = {
    name: "superpowers-market",
    owner: { name: "Example" },
    plugins: [
      {
        name: "superpowers",
        description:
          "Superpowers teaches Claude brainstorming, subagent driven development with built in code review, systematic debugging, and red/green TDD. Additionally, it teaches Claude how to author and test new skills.",
        category: "development",
        source: {
          source: "url",
          url: "https://github.com/obra/superpowers.git",
        },
        homepage: "https://github.com/obra/superpowers.git",
      },
    ],
  };
  await fs.writeFile(
    path.join(marketplaceDir, ".wave-plugin", "marketplace.json"),
    JSON.stringify(marketplaceManifest, null, 2),
  );

  console.log("📦 Marketplace manifest:");
  console.log(JSON.stringify(marketplaceManifest, null, 2));

  try {
    // 2. Add marketplace and install the plugin (clones the repo)
    const configService = new ConfigurationService();
    const marketplaceService = new MarketplaceService(tempDir, configService);

    await marketplaceService.addMarketplace(marketplaceDir);

    console.log("\n🔧 Installing superpowers plugin (git clone)...");
    const installedPlugin = await marketplaceService.installPlugin(
      "superpowers@superpowers-market",
      tempDir,
    );
    console.log(
      `✅ Installed: ${installedPlugin.name} v${installedPlugin.version}`,
    );
    console.log(`   Cache path: ${installedPlugin.cachePath}`);

    // 3. Use PluginLoader to load manifest, skills, and commands
    console.log("\n🔍 Loading plugin via PluginLoader...");
    const manifest = await PluginLoader.loadManifest(installedPlugin.cachePath);
    console.log(`   Manifest name: ${manifest.name}`);
    console.log(`   Manifest version: ${manifest.version}`);

    const commands = PluginLoader.loadCommands(installedPlugin.cachePath);
    console.log(`   Commands loaded: ${commands.length}`);

    const skills = await PluginLoader.loadSkills(installedPlugin.cachePath);
    console.log(`   Skills loaded: ${skills.length}`);

    // 4. List all skills
    console.log("\n📋 Superpowers skills:");
    if (skills.length === 0) {
      console.log("   ⚠️  No skills found!");
      // Check if the skills directory exists
      const skillsDir = path.join(installedPlugin.cachePath, "skills");
      try {
        const entries = await fs.readdir(skillsDir, { withFileTypes: true });
        console.log(
          `   skills/ directory exists with ${entries.length} entries:`,
        );
        for (const entry of entries.slice(0, 5)) {
          console.log(
            `     - ${entry.name} (${entry.isDirectory() ? "dir" : "file"})`,
          );
        }
        if (entries.length > 5) {
          console.log(`     ... and ${entries.length - 5} more`);
        }
      } catch {
        console.log(`   skills/ directory not found`);
      }
    } else {
      for (const skill of skills) {
        console.log(`   ✅ ${skill.name}`);
        console.log(`      Description: ${skill.description}`);
      }
    }

    // 5. List commands too
    console.log("\n📋 Superpowers commands:");
    if (commands.length === 0) {
      console.log("   No commands found");
    } else {
      for (const cmd of commands) {
        console.log(`   /${cmd.name}: ${cmd.description}`);
      }
    }

    // 6. Final summary
    console.log("\n" + "=".repeat(60));
    console.log(
      `Summary: ${skills.length} skills, ${commands.length} commands`,
    );
    if (skills.length > 0) {
      console.log("✅ All superpowers skills loaded successfully!");
    } else {
      console.log("❌ No skills were loaded!");
    }
  } finally {
    // Clean up: remove the test marketplace from user settings
    const configService = new ConfigurationService();
    const marketplaceService = new MarketplaceService(tempDir, configService);
    await marketplaceService.removeMarketplace("superpowers-market");
    console.log(`\n🧹 Removed test marketplace from user settings`);

    await fs.rm(tempDir, { recursive: true, force: true });
    console.log(`\n🧹 Cleaned up: ${tempDir}`);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Unhandled error:", error);
    process.exit(1);
  });

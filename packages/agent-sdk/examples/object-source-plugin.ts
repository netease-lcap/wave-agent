import { MarketplaceService } from "../src/services/MarketplaceService.js";
import { ConfigurationService } from "../src/services/configurationService.js";
import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

/**
 * This example verifies that plugin entries with object-style URL sources work:
 *
 * {
 *   "name": "superpowers",
 *   "source": {
 *     "source": "url",
 *     "url": "https://github.com/obra/superpowers.git"
 *   }
 * }
 *
 * Unlike the "directory" source variant, this will actually clone a Git repo.
 */
async function main() {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wave-object-url-example-"),
  );
  const marketplaceDir = path.join(tempDir, "my-marketplace");
  await fs.mkdir(path.join(marketplaceDir, ".wave-plugin"), {
    recursive: true,
  });

  const marketplaceManifest = {
    name: "object-url-market",
    owner: {
      name: "Example Developer",
    },
    plugins: [
      {
        name: "superpowers",
        description:
          "Superpowers teaches Claude brainstorming, subagent driven development with built in code review, systematic debugging, and red/green TDD. Additionally, it teaches Claude how to author and test new skills.",
        category: "development",
        // OBJECT-STYLE URL SOURCE
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

  console.log(`Created test marketplace at: ${marketplaceDir}`);
  console.log("Marketplace manifest:");
  console.log(JSON.stringify(marketplaceManifest, null, 2));

  try {
    const configService = new ConfigurationService();
    const marketplaceService = new MarketplaceService(tempDir, configService);

    console.log("\n📦 Adding marketplace...");
    const addedMarketplace =
      await marketplaceService.addMarketplace(marketplaceDir);
    console.log(`✅ Added marketplace: ${addedMarketplace.name}`);
    console.log(`   Source: ${JSON.stringify(addedMarketplace.source)}`);

    console.log("\n🔧 Installing plugin superpowers@object-url-market...");
    console.log("   (This will clone the repo, may take a moment)");
    const installedPlugin = await marketplaceService.installPlugin(
      "superpowers@object-url-market",
      tempDir,
    );
    console.log(`✅ Installed plugin: ${installedPlugin.name}`);
    console.log(`   Version: ${installedPlugin.version}`);
    console.log(`   Cache path: ${installedPlugin.cachePath}`);

    // Verify the cloned plugin contains expected files
    const wavePluginPath = path.join(
      installedPlugin.cachePath,
      ".wave-plugin",
      "plugin.json",
    );
    const claudePluginPath = path.join(
      installedPlugin.cachePath,
      ".claude-plugin",
      "plugin.json",
    );
    const manifestPath = existsSync(wavePluginPath)
      ? wavePluginPath
      : claudePluginPath;
    const manifestContent = await fs.readFile(manifestPath, "utf-8");
    const cachedManifest = JSON.parse(manifestContent);
    console.log(`\n📋 Cached plugin manifest:`);
    console.log(JSON.stringify(cachedManifest, null, 2));

    console.log("\n✅ Object-style URL source plugin installation verified!");
  } finally {
    // Clean up: remove the test marketplace from user settings
    const configService = new ConfigurationService();
    const marketplaceService = new MarketplaceService(tempDir, configService);
    await marketplaceService.removeMarketplace("object-url-market");
    console.log(`\n🧹 Removed test marketplace from user settings`);

    await fs.rm(tempDir, { recursive: true, force: true });
    console.log(`\n🧹 Cleaned up temporary directory: ${tempDir}`);
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

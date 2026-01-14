import { MarketplaceService } from "wave-agent-sdk";

export async function addMarketplaceCommand(argv: { input: string }) {
  const service = new MarketplaceService();
  try {
    const marketplace = await service.addMarketplace(argv.input);
    const sourceInfo =
      marketplace.source.source === "directory"
        ? marketplace.source.path
        : marketplace.source.repo;
    console.log(
      `Successfully added marketplace: ${marketplace.name} (${sourceInfo})`,
    );
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to add marketplace: ${message}`);
    process.exit(1);
  }
}

export async function listMarketplacesCommand() {
  const service = new MarketplaceService();
  try {
    const marketplaces = await service.listMarketplaces();
    if (marketplaces.length === 0) {
      console.log("No marketplaces registered.");
    } else {
      console.log("Registered Marketplaces:");
      marketplaces.forEach((m) => {
        const sourceInfo =
          m.source.source === "directory" ? m.source.path : m.source.repo;
        console.log(`- ${m.name}: ${sourceInfo} (${m.source.source})`);
      });
    }
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to list marketplaces: ${message}`);
    process.exit(1);
  }
}

export async function updateMarketplaceCommand(argv: { name?: string }) {
  const service = new MarketplaceService();
  try {
    console.log(
      argv.name
        ? `Updating marketplace: ${argv.name}...`
        : "Updating all marketplaces...",
    );
    await service.updateMarketplace(argv.name);
    console.log("Successfully updated.");
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to update marketplace: ${message}`);
    process.exit(1);
  }
}

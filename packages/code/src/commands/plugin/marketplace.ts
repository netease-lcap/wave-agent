import { MarketplaceService } from "wave-agent-sdk";

export async function addMarketplaceCommand(argv: { path: string }) {
  const service = new MarketplaceService();
  try {
    const marketplace = await service.addMarketplace(argv.path);
    console.log(
      `Successfully added marketplace: ${marketplace.name} (${marketplace.path})`,
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
        console.log(`- ${m.name}: ${m.path}`);
      });
    }
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to list marketplaces: ${message}`);
    process.exit(1);
  }
}

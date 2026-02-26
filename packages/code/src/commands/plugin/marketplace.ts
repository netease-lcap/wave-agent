import { MarketplaceService } from "wave-agent-sdk";

export async function addMarketplaceCommand(argv: { input: string }) {
  const service = new MarketplaceService();
  try {
    const marketplace = await service.addMarketplace(argv.input);
    const source = marketplace.source;
    let sourceInfo = "";
    if (source.source === "directory") {
      sourceInfo = source.path;
    } else if (source.source === "github") {
      sourceInfo = source.repo + (source.ref ? `#${source.ref}` : "");
    } else {
      sourceInfo = source.url + (source.ref ? `#${source.ref}` : "");
    }
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
        const source = m.source;
        let sourceInfo = "";
        if (source.source === "directory") {
          sourceInfo = source.path;
        } else if (source.source === "github") {
          sourceInfo = source.repo + (source.ref ? `#${source.ref}` : "");
        } else {
          sourceInfo = source.url + (source.ref ? `#${source.ref}` : "");
        }
        const builtinLabel = m.isBuiltin ? " [builtin]" : "";
        console.log(
          `- ${m.name}${builtinLabel}: ${sourceInfo} (${m.source.source})`,
        );
      });
    }
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to list marketplaces: ${message}`);
    process.exit(1);
  }
}

export async function removeMarketplaceCommand(argv: { name: string }) {
  const service = new MarketplaceService();
  try {
    await service.removeMarketplace(argv.name);
    console.log(`Successfully removed marketplace: ${argv.name}`);
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to remove marketplace: ${message}`);
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

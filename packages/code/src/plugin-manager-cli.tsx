import React from "react";
import { render } from "ink";
import { PluginManagerShell } from "./components/PluginManagerShell.js";

/**
 * Entry point for the Plugin Manager CLI.
 * Renders the Ink component and handles the lifecycle.
 */
export async function startPluginManagerCli(): Promise<boolean> {
  const { waitUntilExit } = render(<PluginManagerShell />);
  await waitUntilExit();
  return true;
}

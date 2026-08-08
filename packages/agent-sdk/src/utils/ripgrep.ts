/**
 * Path to the ripgrep binary, provided by the @vscode/ripgrep dependency.
 * The wrapper resolves the platform-specific binary package at import time
 * via optionalDependencies + os/cpu filtering.
 */
export { rgPath } from "@vscode/ripgrep";

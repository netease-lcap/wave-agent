# Research: Update Command Implementation

## 1. Fetching Latest Version from npm Registry

The npm registry provides a simple JSON endpoint for package information:
`https://registry.npmjs.org/wave-code/latest`

Example response:
```json
{
  "name": "wave-code",
  "version": "0.11.6",
  "dist": {
    "shasum": "...",
    "tarball": "..."
  }
}
```

We can use the native `https` module to fetch this information without adding extra dependencies.

## 2. Version Comparison

Using the `semver` library is the standard way to compare versions in the Node.js ecosystem. It handles pre-releases, ranges, and other edge cases correctly.

```typescript
import semver from "semver";
const isUpdateAvailable = semver.gt(latestVersion, currentVersion);
```

## 3. Detecting Package Manager

To provide a seamless update experience, we should detect how the tool was installed. We can check global installation lists for common package managers:

- **pnpm**: `pnpm list -g wave-code`
- **yarn**: `yarn global list`
- **npm**: `npm list -g wave-code`

If multiple package managers are found, we can prioritize them (e.g., pnpm > yarn > npm) or default to npm.

## 4. Executing Update Command

We can use `spawnSync` from `child_process` to execute the update command. Setting `stdio: 'inherit'` allows the user to see the progress and interact with the command if necessary (e.g., entering a password for sudo).

```typescript
const result = spawnSync(updateCmd, args, { stdio: "inherit" });
```

## 5. Error Handling

- **Network Errors**: Handle `https.get` errors and JSON parsing errors.
- **Permission Errors**: If the update command fails with a non-zero exit code, provide the manual command for the user to run, possibly suggesting `sudo` on non-Windows platforms.
- **Process Exit**: Ensure the process exits with the correct status code after the update check or execution to prevent the main CLI from continuing into interactive mode.

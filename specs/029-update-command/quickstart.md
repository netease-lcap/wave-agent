# Quickstart: Update Command

## 1. Check for Updates

To check if a new version of WAVE Code is available, run:

```bash
wave update
```

or

```bash
wave-code update
```

## 2. Perform Update

If a new version is available, the tool will automatically attempt to update itself using the detected package manager (npm, pnpm, or yarn).

Example output:
```text
Checking for updates...
Current version: 0.11.5
Latest version: 0.11.6
A new version of WAVE Code is available: 0.11.6
Updating WAVE Code using pnpm...
Running: pnpm add -g wave-code@latest
...
WAVE Code updated successfully!
```

## 3. Manual Update

If the automatic update fails (e.g., due to permission issues), the tool will provide the manual command to run:

```text
Failed to update WAVE Code.
Please try running the update command manually: npm install -g wave-code@latest
You might need to run it with sudo if you encounter permission issues.
```

## 4. Already Up to Date

If you are already running the latest version, the tool will inform you:

```text
Checking for updates...
Current version: 0.11.6
Latest version: 0.11.6
WAVE Code is already up to date!
```

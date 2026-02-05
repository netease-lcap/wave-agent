# Quickstart: Smart Prefix Match for Trusted Bash Commands

## Overview
This feature allows Wave to remember and automatically approve bash commands based on a "smart prefix" rather than just exact string matches.

## How to use

### 1. Trusting a command
When Wave asks for permission to run a bash command (e.g., `npm install lodash`):
1. Select option 2: `Yes, and don't ask again for: npm install`.
2. (Optional) Edit the prefix if you want it to be more or less specific.
3. Press Enter.

### 2. Automatic execution
The next time Wave wants to run a similar command (e.g., `npm install express`):
1. Wave will check if the command starts with `npm install`.
2. Since it matches the trusted prefix, Wave will execute it immediately without prompting.

### 3. Managing trusted prefixes
To view or remove trusted prefixes:
1. Open `.wave/settings.local.json` in your project directory.
2. Look for the `permissions.allow` array.
3. You can manually remove entries like `Bash(npm install*)`.

## Security Note
- Commands like `rm`, `sudo`, and `mv` are blacklisted from prefix matching to prevent accidental data loss or security breaches.
- You will always be prompted for these commands unless you have an exact match trusted.

# Contract: Update Command

## 1. npm Registry Response

The system expects the npm registry to return a JSON object with the following structure:

```json
{
  "name": "wave-code",
  "version": "string",
  "dist": {
    "shasum": "string",
    "tarball": "string"
  }
}
```

## 2. Package Manager Detection

The system expects the package manager to return a non-zero exit code if the package is not found in the global installation list.

- **pnpm**: `pnpm list -g wave-code`
- **yarn**: `yarn global list`
- **npm**: `npm list -g wave-code`

## 3. Update Command Execution

The system expects the update command to return an exit code of 0 upon successful completion.

- **pnpm**: `pnpm add -g wave-code@latest`
- **yarn**: `yarn global add wave-code@latest`
- **npm**: `npm install -g wave-code@latest`

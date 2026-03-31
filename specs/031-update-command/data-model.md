# Data Model: Update Command

## 1. Version Information

The version information is fetched from the npm registry:

```typescript
interface NpmRegistryResponse {
  name: string;
  version: string;
  dist: {
    shasum: string;
    tarball: string;
  };
}
```

## 2. Package Manager Detection

The package manager is detected by checking global installation lists:

```typescript
type PackageManager = "npm" | "pnpm" | "yarn";
```

## 3. Update Command Configuration

The update command and its arguments are configured based on the detected package manager:

```typescript
interface UpdateConfig {
  command: string;
  args: string[];
}

const configs: Record<PackageManager, UpdateConfig> = {
  npm: {
    command: "npm",
    args: ["install", "-g", "wave-code@latest"],
  },
  pnpm: {
    command: "pnpm",
    args: ["add", "-g", "wave-code@latest"],
  },
  yarn: {
    command: "yarn",
    args: ["global", "add", "wave-code@latest"],
  },
};
```

# Quickstart: Local Plugin Marketplace

This guide shows how to use the Local Plugin Marketplace feature.

## 1. Create a Local Marketplace

Create a directory for your marketplace and add a `marketplace.json` file.

```bash
mkdir -p my-marketplace/.wave-plugin
```

**my-marketplace/.wave-plugin/marketplace.json**:
```json
{
  "name": "my-plugins",
  "owner": {
    "name": "Your Name"
  },
  "plugins": [
    {
      "name": "review-plugin",
      "source": "./plugins/review-plugin",
      "description": "Adds a /review command for quick code reviews"
    }
  ]
}
```

## 2. Add the Marketplace to Wave

Use the CLI to register your local marketplace.

```bash
wave plugin marketplace add ./my-marketplace
```

## 3. Install a Plugin

Install a plugin from your newly added marketplace.

```bash
wave plugin install review-plugin@my-plugins
```

## 4. Verify Installation

List your installed plugins to verify.

```bash
wave plugin list
```

## 5. Use the Plugin

Run a command provided by the plugin.

```bash
/review-plugin:review
```

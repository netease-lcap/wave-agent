# Quickstart: GitHub Marketplace Support

## Adding a GitHub Marketplace

To add a marketplace hosted on GitHub, use the `owner/repo` format:

```bash
wave plugin marketplace add netease-lcap/wave-plugins-official
```

The system will:
1. Fetch the `marketplace.json` from the repository.
2. Register it locally.
3. Cache the manifest for offline use and faster listing.

## Updating Marketplaces

To refresh the local cache of all marketplaces:

```bash
wave plugin marketplace update
```

To update a specific marketplace:

```bash
wave plugin marketplace update official
```

## Installing Plugins from GitHub

If a marketplace defines a plugin with a GitHub source, installing it is the same as any other plugin:

```bash
wave plugin install my-plugin@official
```

The system will automatically clone the plugin's repository and install it into the Wave Agent's plugin cache.

## Marketplace Manifest Example (`marketplace.json`)

```json
{
  "name": "official",
  "owner": {
    "name": "NetEase LCAP"
  },
  "plugins": [
    {
      "name": "github-plugin",
      "description": "A plugin hosted on GitHub",
      "source": "./plugins/github-plugin"
    },
    {
      "name": "local-plugin",
      "description": "A plugin relative to this marketplace",
      "source": "./plugins/local-plugin"
    }
  ]
}
```

# Quickstart: Plugin Scope Management

This guide demonstrates how to use the new scoped plugin management features.

## 1. Install a Plugin to a Specific Scope

Install a plugin and enable it only for the current project:

```bash
wave plugin install review-plugin@my-plugins --scope project
```

This will:
1. Download/copy the plugin to the central cache.
2. Add the following to `.wave/settings.json`:
   ```json
   {
     "enabledPlugins": {
       "review-plugin@my-plugins": true
     }
   }
   ```

## 2. Enable/Disable Plugins

Enable a plugin globally (user scope):

```bash
wave plugin enable review-plugin@my-plugins --scope user
```

Disable a plugin for the current project (even if enabled globally):

```bash
wave plugin disable review-plugin@my-plugins --scope project
```

## 3. Local Overrides (Not Committed to Git)

Enable a plugin only for your local environment without affecting the project's shared configuration:

```bash
wave plugin enable experimental-plugin@my-plugins --scope local
```

This updates `.wave/settings.local.json`.

## 4. Verifying Plugin State

You can check which plugins are active by listing them (assuming `wave plugin list` is updated to show status):

```bash
wave plugin list
```

## Scope Priority Reminder

1. **Local** (`.wave/settings.local.json`) - Highest priority
2. **Project** (`.wave/settings.json`)
3. **User** (`~/.wave/settings.json`) - Lowest priority

If a plugin is disabled (`false`) in a higher priority scope, it will be disabled regardless of its state in lower priority scopes.

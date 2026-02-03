# Quickstart: Add Builtin Marketplace

## Overview
This feature adds a builtin marketplace `wave-plugins-official` to the Wave CLI. Users will have access to official plugins immediately after installation.

## Usage

### 1. List Marketplaces
On a fresh installation, the builtin marketplace is already there:
```bash
wave plugin marketplace list
```
Output:
```
Registered Marketplaces:
- wave-plugins-official: netease-lcap/wave-plugins-official (github)
```

### 2. Install a Plugin
You can install plugins from the official marketplace without any setup:
```bash
wave plugin install <plugin-name>
```

### 3. Remove the Builtin Marketplace
If you want to use only private marketplaces:
```bash
wave plugin marketplace remove wave-plugins-official
```

### 4. Restore the Builtin Marketplace
If you removed it and want it back:
```bash
wave plugin marketplace add netease-lcap/wave-plugins-official
```

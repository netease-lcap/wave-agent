# Quickstart: Init Slash Command

## Overview
The `/init` command helps you set up your repository for AI agents by generating an `AGENTS.md` file. This file contains essential information about your project's architecture, build commands, and development rules.

## Usage

1. Open the Wave Agent CLI in your repository.
2. Type `/init` and press Enter.
3. The agent will analyze your codebase and propose an `AGENTS.md` file.
4. Review and confirm the changes.

## What it does
- Analyzes `package.json`, `README.md`, and other configuration files.
- Identifies build, test, and lint commands.
- Extracts high-level architecture details.
- Incorporates rules from `.cursorrules` or `.github/copilot-instructions.md`.
- Ensures the mandatory `AGENTS.md` prefix is present.

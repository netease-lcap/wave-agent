# Feature Specification: GitHub Marketplace Support

**Feature Branch**: `046-github-marketplace-support`  
**Created**: 2026-01-14  
**Status**: Draft  
**Input**: User description: "marketplace support GitHub repositories: owner/repo format , `wave plugin marketplace add netease-lcap/wave-plugins-official`, plugin sources support GitHub repositories.
Known marketplaces source should be like:
```json
{
  "source": {
    "source": "directory",
    "path": "/home/liuyiqi/personal-projects/my-marketplace"
  }
}
```
or
```json
{
  "source": {
    "source": "github",
    "repo": "anthropics/claude-plugins-official"
  }
}
```
Marketplace.json plugins source should always be like: `"source": "./plugins/commit-commands"`."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add GitHub Marketplace (Priority: P1)

As a developer, I want to add a GitHub repository as a plugin marketplace using the `owner/repo` format so that I can easily access and share plugins hosted on GitHub.

**Why this priority**: This is the primary entry point for the feature. It allows users to connect to remote marketplaces, expanding the ecosystem beyond local directories.

**Independent Test**: Can be tested by running `wave plugin marketplace add netease-lcap/wave-plugins-official` and verifying that the marketplace is registered and its plugins are listed.

**Acceptance Scenarios**:

1. **Given** a valid GitHub repository `owner/repo` containing a `.wave-plugin/marketplace.json`, **When** I run `wave plugin marketplace add owner/repo`, **Then** the marketplace is successfully registered.
2. **Given** a registered GitHub marketplace, **When** I list available marketplaces, **Then** I should see the GitHub marketplace with its name and repository path.

---

### User Story 2 - Install Plugin from GitHub Marketplace (Priority: P1)

As a user, I want to install a plugin from a GitHub-hosted marketplace so that I can use its functionality in my environment.

**Why this priority**: Installation is the core value proposition of a marketplace.

**Independent Test**: Can be tested by running `wave plugin install [plugin-name]@[marketplace-name]` where the marketplace is a GitHub repository, and verifying the plugin is installed and functional.

**Acceptance Scenarios**:

1. **Given** a registered GitHub marketplace containing a plugin with a GitHub source, **When** I run `wave plugin install [plugin-name]@[marketplace-name]`, **Then** the plugin is downloaded from GitHub and installed locally.
2. **Given** a plugin in a GitHub marketplace that points to another GitHub repository, **When** I install it, **Then** the system correctly clones/downloads the plugin source from the specified repository.

---

### User Story 3 - Update Marketplace (Priority: P2)

As a user, I want to update the local cache of one or all registered marketplaces so that I have access to the latest plugins and versions.

**Why this priority**: While installation is P1, keeping the marketplace data fresh is essential for a good user experience and accessing updates.

**Independent Test**: Can be tested by running `wave plugin marketplace update` (for all) or `wave plugin marketplace update [name]` (for one) and verifying that the local manifest files are refreshed from their sources.

**Acceptance Scenarios**:

1. **Given** multiple registered marketplaces, **When** I run `wave plugin marketplace update`, **Then** all marketplaces are refreshed from their respective sources (local or GitHub).
2. **Given** a specific registered marketplace, **When** I run `wave plugin marketplace update [name]`, **Then** only that marketplace is refreshed.

---

### Edge Cases

- **What happens if the GitHub repository is private?** The system should attempt to use the user's local Git credentials or provide a clear error message if access is denied.
- **What happens if the `marketplace.json` is missing in the GitHub repository?** The system should return an error indicating that the repository is not a valid Wave marketplace.
- **How are rate limits handled?** The system should gracefully handle GitHub API rate limits and inform the user if they are exceeded.
- **What if the `source` in `marketplace.json` uses an unsupported source type?** The system should ignore or report an error for that specific plugin while allowing others to be listed if possible.

## Assumptions

- The system has `git` installed and available in the environment to handle repository cloning/fetching.
- GitHub repositories are public by default for this feature, or the user has configured SSH/HTTPS credentials for private repos.
- The `marketplace.json` file is expected to be at `.wave-plugin/marketplace.json` in the root of the repository.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support adding a GitHub repository as a marketplace using the `owner/repo` format via `wave plugin marketplace add [owner/repo]`.
- **FR-002**: System MUST automatically resolve `owner/repo` to a full GitHub URL (e.g., `https://github.com/owner/repo.git`).
- **FR-003**: System MUST support plugin sources defined as relative paths in `marketplace.json` (e.g., `"source": "./plugins/commit-commands"`).
- **FR-004**: System MUST download/clone the plugin source from GitHub when installing a plugin with a `github` source type.
- **FR-005**: System MUST support the same installation syntax as local marketplaces: `wave plugin install [plugin-name]@[marketplace-name]`.
- **FR-006**: System MUST cache or store the marketplace manifest locally after adding it to avoid redundant network requests for listing.
- **FR-007**: System MUST support updating a specific marketplace via `wave plugin marketplace update [name]`.
- **FR-008**: System MUST support updating all registered marketplaces via `wave plugin marketplace update` (when no name is specified).
- **FR-009**: System SHOULD automatically update the marketplace manifest during `wave plugin install` if the local cache is missing or significantly outdated.

### Key Entities *(include if feature involves data)*

- **GitHub Marketplace**: A marketplace where the manifest and/or plugins are hosted on GitHub.
- **GitHub Plugin Source**: A plugin whose source code is hosted in a GitHub repository, distinct from the marketplace repository itself.

# Feature Specification: GitHub and Git Marketplace Support

**Feature Branch**: `046-github-marketplace-support`  
**Created**: 2026-01-14  
**Status**: Implemented  
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
**Update**: Added support for any Git hosting service (GitLab, Bitbucket, self-hosted) using full repository URLs and fragments for refs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add GitHub or Git Marketplace (Priority: P1)

As a developer, I want to add a GitHub repository (using `owner/repo`) or any Git repository (using a full URL) as a plugin marketplace so that I can easily access and share plugins hosted on any Git platform.

**Why this priority**: This is the primary entry point for the feature. It allows users to connect to remote marketplaces, expanding the ecosystem beyond local directories.

**Independent Test**: 
1. Run `wave plugin marketplace add netease-lcap/wave-plugins-official` and verify it's registered.
2. Run `wave plugin marketplace add https://gitlab.com/company/plugins.git#v1.0.0` and verify it's registered.

**Acceptance Scenarios**:

1. **Given** a valid GitHub repository `owner/repo` containing a `.wave-plugin/marketplace.json`, **When** I run `wave plugin marketplace add owner/repo`, **Then** the marketplace is successfully registered.
2. **Given** a valid Git repository URL containing a `.wave-plugin/marketplace.json`, **When** I run `wave plugin marketplace add [url]`, **Then** the marketplace is successfully registered.
3. **Given** a Git repository URL with a fragment (e.g., `#v1.0.0`), **When** I add it, **Then** the system clones the specific branch/tag/commit.
4. **Given** a registered GitHub or Git marketplace, **When** I list available marketplaces, **Then** I should see the marketplace with its name and repository path/URL.

---

### User Story 2 - Install Plugin from GitHub or Git Marketplace (Priority: P1)

As a user, I want to install a plugin from a GitHub or Git-hosted marketplace so that I can use its functionality in my environment.

**Why this priority**: Installation is the core value proposition of a marketplace.

**Independent Test**: Can be tested by running `wave plugin install [plugin-name]@[marketplace-name]` where the marketplace is a GitHub or Git repository, and verifying the plugin is installed and functional.

**Acceptance Scenarios**:

1. **Given** a registered GitHub marketplace containing a plugin with a GitHub source, **When** I run `wave plugin install [plugin-name]@[marketplace-name]`, **Then** the plugin is downloaded from GitHub and installed locally.
2. **Given** a registered Git marketplace containing a plugin with a Git source, **When** I run `wave plugin install [plugin-name]@[marketplace-name]`, **Then** the plugin is downloaded from the Git repository and installed locally.
3. **Given** a plugin in a marketplace that points to another GitHub or Git repository, **When** I install it, **Then** the system correctly clones/downloads the plugin source from the specified repository.

---

### User Story 3 - Update Marketplace (Priority: P2)

As a user, I want to update the local cache of one or all registered marketplaces so that I have access to the latest plugins and versions.

**Why this priority**: While installation is P1, keeping the marketplace data fresh is essential for a good user experience and accessing updates.

**Independent Test**: Can be tested by running `wave plugin marketplace update` (for all) or `wave plugin marketplace update [name]` (for one) and verifying that the local manifest files are refreshed from their sources.

**Acceptance Scenarios**:

1. **Given** multiple registered marketplaces, **When** I run `wave plugin marketplace update`, **Then** all marketplaces are refreshed from their respective sources (local, GitHub, or Git).
2. **Given** a specific registered marketplace, **When** I run `wave plugin marketplace update [name]`, **Then** only that marketplace is refreshed.

---

### Edge Cases

- **What happens if the repository is private?** The system should attempt to use the user's local Git credentials or provide a clear error message if access is denied.
- **What happens if Git is not installed?** The system should provide a clear error message when attempting to add a GitHub/Git marketplace and gracefully skip them during bulk updates, while still allowing local directory marketplaces to function.
- **What happens if the `marketplace.json` is missing in the repository?** The system should return an error indicating that the repository is not a valid Wave marketplace.
- **How are rate limits handled?** For GitHub, the system should gracefully handle API rate limits. For other services, it depends on their Git protocol implementation.
- **What if the `source` in `marketplace.json` uses an unsupported source type?** The system should ignore or report an error for that specific plugin while allowing others to be listed if possible.

## Assumptions

- The system SHOULD have `git` installed to use GitHub or Git-based marketplaces. If `git` is missing, these operations will be disabled with clear user feedback.
- Repositories are public by default for this feature, or the user has configured SSH/HTTPS credentials for private repos.
- The `marketplace.json` file is expected to be at `.wave-plugin/marketplace.json` in the root of the repository.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support adding a GitHub repository as a marketplace using the `owner/repo` format via `wave plugin marketplace add [owner/repo]`.
- **FR-002**: System MUST support adding any Git repository as a marketplace using a full URL via `wave plugin marketplace add [url]`.
- **FR-003**: System MUST support Git URLs with fragments for specifying branches, tags, or commits (e.g., `https://gitlab.com/org/repo.git#v1.0.0`).
- **FR-004**: System MUST support plugin sources defined as relative paths in `marketplace.json` (e.g., `"source": "./plugins/commit-commands"`).
- **FR-005**: System MUST download/clone the plugin source from GitHub or Git when installing a plugin with a `github` or `git` source type.
- **FR-006**: System MUST support the same installation syntax as local marketplaces: `wave plugin install [plugin-name]@[marketplace-name]`.
- **FR-007**: System MUST cache or store the marketplace manifest locally after adding it to avoid redundant network requests for listing.
- **FR-008**: System MUST support updating a specific marketplace via `wave plugin marketplace update [name]`.
- **FR-009**: System MUST support updating all registered marketplaces via `wave plugin marketplace update` (when no name is specified).
- **FR-010**: System SHOULD automatically update the marketplace manifest during `wave plugin install` if the local cache is missing or significantly outdated.
- **FR-011**: System MUST check for Git availability before performing any GitHub or Git-related operations.
- **FR-012**: System MUST provide a clear error message if a user attempts to add a GitHub/Git marketplace when Git is not installed.
- **FR-013**: System MUST gracefully skip GitHub/Git marketplaces during `wave plugin marketplace update` if Git is not installed, while continuing to update local marketplaces.

### Key Entities *(include if feature involves data)*

- **GitHub Marketplace**: A marketplace where the manifest and/or plugins are hosted on GitHub, added via `owner/repo`.
- **Git Marketplace**: A marketplace where the manifest and/or plugins are hosted on any Git repository, added via full URL.
- **GitHub/Git Plugin Source**: A plugin whose source code is hosted in a GitHub or Git repository, distinct from the marketplace repository itself.

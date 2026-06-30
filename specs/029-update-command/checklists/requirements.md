# Requirements Checklist: Update Command

## 1. Functional Requirements

- [x] **FR-001**: System MUST provide an `update` command.
- [x] **FR-002**: System MUST fetch the latest version of `wave-code` from the npm registry (`https://registry.npmjs.org/wave-code/latest`).
- [x] **FR-003**: System MUST compare the current version with the latest version using semver logic.
- [x] **FR-004**: System MUST detect the package manager used for installation (`npm`, `pnpm`, or `yarn`).
- [x] **FR-005**: System MUST execute the appropriate update command for the detected package manager.
- [x] **FR-006**: System MUST provide real-time feedback during the update process by inheriting stdio.
- [x] **FR-007**: System MUST handle errors during version checking and update execution gracefully.

## 2. User Scenarios

- [x] **US-001**: Check for updates when already up to date.
- [x] **US-002**: Check for updates when a new version is available.
- [x] **US-003**: Perform update using npm.
- [x] **US-004**: Perform update using pnpm.
- [x] **US-005**: Perform update using yarn.
- [x] **US-006**: Handle update failure and provide manual command.

## 3. Edge Cases

- [x] **EC-001**: Network unavailable during version check.
- [x] **EC-002**: Permission issues during update execution.
- [x] **EC-003**: Tool not installed globally.
- [x] **EC-004**: Process exit after update check or execution.

#!/bin/bash

# TypeScript/TSX file checker script for Wave hooks
# This script type-checks and lints a specific TypeScript or TSX file
# Exit codes:
# 0 = Success (no errors)
# 1 = Non-blocking error (warnings)
# 2 = Blocking error (type/lint errors that require AI attention)

set -e

# Read JSON input from stdin
JSON_INPUT=$(cat)

# Extract file path from tool input
FILE_PATH=$(echo "$JSON_INPUT" | jq -r '.tool_input.file_path // empty')

# Check if file path is provided
if [ -z "$FILE_PATH" ] || [ "$FILE_PATH" = "null" ]; then
    # No file path found, exit silently (not a file operation)
    exit 0
fi

# Check if file exists
if [ ! -f "$FILE_PATH" ]; then
    # File does not exist, exit silently
    exit 0
fi

# Check if this is a TypeScript/TSX file
if [[ ! "$FILE_PATH" =~ \.(ts|tsx)$ ]]; then
    # Not a TypeScript file, exit silently
    exit 0
fi

echo "Checking TypeScript file: $FILE_PATH"

# Get absolute path to the project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Determine which package directory to use
PACKAGE_DIR=""
RELATIVE_FILE_PATH=""

if [[ "$FILE_PATH" =~ packages/([^/]+)/ ]]; then
    PACKAGE_NAME="${BASH_REMATCH[1]}"
    PACKAGE_DIR="$PROJECT_ROOT/packages/$PACKAGE_NAME"
    # Extract the relative path within the package
    RELATIVE_FILE_PATH="${FILE_PATH#*packages/$PACKAGE_NAME/}"
    echo "Detected package: $PACKAGE_NAME"
else
    # If not in a package, skip checks since there's no proper configuration
    echo "File is not in a package directory, skipping checks..."
    exit 0
fi

# Initialize error tracking
HAS_ERRORS=false
ERROR_OUTPUT=""

# Change to the appropriate directory and run checks
cd "$PACKAGE_DIR"

# Type check with TypeScript compiler directly on the file
echo "Running TypeScript check in directory: $PACKAGE_DIR"
if ! TYPE_OUTPUT=$(pnpm run type-check 2>&1); then
    HAS_ERRORS=true
    ERROR_OUTPUT="$ERROR_OUTPUT\n=== TypeScript Errors ===\n$TYPE_OUTPUT"
fi

# Lint with ESLint
echo "Running ESLint check..."
if ! LINT_OUTPUT=$(pnpm eslint "$RELATIVE_FILE_PATH" 2>&1); then
    HAS_ERRORS=true
    ERROR_OUTPUT="$ERROR_OUTPUT\n=== ESLint Issues ===\n$LINT_OUTPUT"
fi

# Report results
if [ "$HAS_ERRORS" = true ]; then
    echo -e "$ERROR_OUTPUT" >&2
    exit 2
else
    echo "TypeScript file $FILE_PATH passed all checks"
    exit 0
fi
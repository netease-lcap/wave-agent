#!/bin/bash

# Final check script for type-check and lint
# This script runs both type-check and lint and provides clear output

output=$(pnpm type-check 2>&1 && pnpm lint 2>&1)
exit_code=$?

if [ $exit_code -eq 0 ]; then
    echo "$output"
else
    echo "$output" >&2
    exit 2
fi
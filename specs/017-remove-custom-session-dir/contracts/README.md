# TypeScript Interface Contracts

This directory contains the TypeScript interface contracts that define the API changes for removing the custom session dir feature.

## Contract Files

- `agent-interfaces.ts` - Updated AgentOptions interface without sessionDir
- `session-service-contracts.ts` - Updated session service function signatures  
- `internal-interfaces.ts` - Updated internal interfaces (MessageManagerOptions)

## Breaking Changes Summary

These contracts define the breaking changes that will be introduced:

1. **AgentOptions.sessionDir** - Property removed from interface
2. **Session service functions** - sessionDir parameters removed from all function signatures
3. **MessageManagerOptions.sessionDir** - Property removed from internal interface

## Usage

These contracts serve as the specification for:
- TypeScript interface updates
- Function signature modifications  
- Breaking change documentation
- Migration guidance for users
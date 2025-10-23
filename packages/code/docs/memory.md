# Memory Function Usage Example

This example demonstrates how to use the memory function to save and utilize important contextual information.

## Function Overview

1. **Add Memory**: User input starting with `#` will be automatically saved to the `WAVE.md` file
2. **Automatic Reading**: AI automatically reads the `WAVE.md` file as part of the system prompt on each call
3. **Persistent Storage**: Memory content is persistently saved in the working directory

## Usage Examples

### 1. Add Project Settings Memory

```
User input: #This project uses React + TypeScript, mainly a CLI tool
System response: ✅ Memory added to WAVE.md: This project uses React + TypeScript, mainly a CLI tool
```

### 2. Add Important Convention Memory

```
User input: #Code style: Use ESLint + Prettier, components use functional approach
System response: ✅ Memory added to WAVE.md: Code style: Use ESLint + Prettier, components use functional approach
```

### 3. Add Business Rules Memory

```
User input: #Important: All file operations need error handling, user input needs validation
System response: ✅ Memory added to WAVE.md: Important: All file operations need error handling, user input needs validation
```

## WAVE.md File Example

After adding memories, the `WAVE.md` file content is as follows:

```markdown
# WAVE Memory

This is the AI assistant's memory file, recording important information and context.

- This project uses React + TypeScript, mainly a CLI tool
- Code style: Use ESLint + Prettier, components use functional approach
- Important: All file operations need error handling, user input needs validation
```

## AI System Prompt Integration

AI automatically reads memory content when processing requests, and the system prompt will include:

```
You are a professional web development expert.

## TODOs
⏳ Pending tasks
✅ Completed tasks

## Tool Usage Guidelines:
...

## Memory Context

The following is important context and memory from previous interactions:

# WAVE Memory

This is the AI assistant's memory file, recording important information and context.

- This project uses React + TypeScript, mainly a CLI tool
- Code style: Use ESLint + Prettier, components use functional approach
- Important: All file operations need error handling, user input needs validation
```

## Important Notes

1. **# prefix**: Only messages starting with `#` will be recognized as memory
2. **List format**: The system will save memory content in list item format starting with `-`
3. **File location**: Memory file is fixed to be saved as `WAVE.md` in the working directory
4. **Error handling**: If file operations fail, error messages will be displayed but won't affect normal chat
5. **Append mode**: New memories will be appended to the end of the file, not overwriting existing content

## Best Practices

1. **Project setup**: Add basic configuration and tech stack information at the beginning of the project
2. **Coding standards**: Record team-agreed code styles and best practices
3. **Business rules**: Save important business logic and constraints
4. **Common issues**: Record frequently encountered problems and solutions
5. **Important decisions**: Save reasons for technology choices and architectural decisions

## Format Description

Memory content uses a concise list format:

- Each memory starts with `-` as a list item
- Keep content concise and clear for AI understanding and use
- New memories are automatically appended to the end of the file
- Supports mixed Chinese and English content

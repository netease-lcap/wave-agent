# Data Model: Prompt Engineering Framework

## PromptTemplate

Represents a single prompt template.

```typescript
interface PromptTemplate {
  name: string;
  template: string;
  version: string;
  description?: string;
}
```

## ExecutionContext

Data used to fill prompt templates.

```typescript
interface ExecutionContext {
  workdir: string;
  availableSubagents?: string[];
  availableSkills?: string[];
  language?: string;
  [key: string]: any;
}
```

## PromptRegistry

The central store for prompts.

```typescript
class PromptRegistry {
  private prompts: Map<string, PromptTemplate>;
  
  register(prompt: PromptTemplate): void;
  get(name: string, context: ExecutionContext): string;
  list(): PromptTemplate[];
}
```

/**
 * A simple Dependency Injection container to manage late-binding dependencies
 * and resolve circular references.
 */
export class Container {
  private services = new Map<string, unknown>();
  private factories = new Map<string, () => unknown>();
  private parent?: Container;

  constructor(parent?: Container) {
    this.parent = parent;
  }

  /**
   * Create a child container that inherits from this container
   */
  createChild(): Container {
    return new Container(this);
  }

  /**
   * Register a singleton instance
   */
  register<T>(token: string, instance: T): void {
    this.services.set(token, instance);
  }

  /**
   * Register a factory function for lazy resolution
   */
  provide<T>(token: string, factory: () => T): void {
    this.factories.set(token, factory);
  }

  /**
   * Resolve a service by token
   */
  get<T>(token: string): T | undefined {
    if (this.services.has(token)) {
      return this.services.get(token) as T;
    }

    const factory = this.factories.get(token);
    if (factory) {
      const instance = factory() as T;
      this.services.set(token, instance);
      return instance;
    }

    if (this.parent) {
      return this.parent.get<T>(token);
    }

    return undefined;
  }

  /**
   * Check if a service exists
   */
  has(token: string): boolean {
    return (
      this.services.has(token) ||
      this.factories.has(token) ||
      (this.parent ? this.parent.has(token) : false)
    );
  }
}

// Example usage for ToolManager:
/*
const container = new Container();

// 1. Provide managers lazily
container.provide('SubagentManager', () => new SubagentManager(...));
container.provide('SkillManager', () => new SkillManager(...));

// 2. ToolManager can now resolve them only when needed (e.g., in execute)
class ToolManager {
  constructor(private container: Container) {}

  async execute(name: string, args: any, context: any) {
    const enhancedContext = {
      ...context,
      subagentManager: this.container.has('SubagentManager') 
        ? this.container.get('SubagentManager') 
        : undefined,
      // ...
    };
    // ...
  }
}
*/

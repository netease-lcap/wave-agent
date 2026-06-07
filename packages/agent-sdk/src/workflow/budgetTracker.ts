export class BudgetTracker {
  private totalSpent = 0;

  constructor(private _total: number | null = null) {}

  addUsage(tokens: number): void {
    this.totalSpent += tokens;
  }

  spent(): number {
    return this.totalSpent;
  }

  remaining(): number {
    if (this._total === null) return Infinity;
    return Math.max(0, this._total - this.totalSpent);
  }

  isExceeded(): boolean {
    return this._total !== null && this.totalSpent >= this._total;
  }

  get total(): number | null {
    return this._total;
  }

  toBudgetInfo(): import("./types.js").BudgetInfo {
    return {
      total: this._total,
      spent: () => this.totalSpent,
      remaining: () => this.remaining(),
    };
  }
}

// Minimal cron expression validation.
// Supports the standard 5-field cron subset:
//   minute hour day-of-month month day-of-week
//
// Field syntax: wildcard, N, step (star-slash-N), range (N-M), list (N,M,...).
// No L, W, ?, or name aliases. Based on Claude Code's parseCronExpression.

type FieldRange = { min: number; max: number };

const FIELD_RANGES: FieldRange[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // dayOfMonth
  { min: 1, max: 12 }, // month
  { min: 0, max: 6 }, // dayOfWeek (0=Sunday; 7 accepted as Sunday alias)
];

function expandField(field: string, range: FieldRange): number[] | null {
  const { min, max } = range;
  const out = new Set<number>();

  for (const part of field.split(",")) {
    // wildcard or star-slash-N
    const stepMatch = part.match(/^\*(?:\/(\d+))?$/);
    if (stepMatch) {
      const step = stepMatch[1] ? parseInt(stepMatch[1], 10) : 1;
      if (step < 1) return null;
      for (let i = min; i <= max; i += step) out.add(i);
      continue;
    }

    // N-M or N-M/S
    const rangeMatch = part.match(/^(\d+)-(\d+)(?:\/(\d+))?$/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1]!, 10);
      const hi = parseInt(rangeMatch[2]!, 10);
      const step = rangeMatch[3] ? parseInt(rangeMatch[3], 10) : 1;
      const isDow = min === 0 && max === 6;
      const effMax = isDow ? 7 : max;
      if (lo > hi || step < 1 || lo < min || hi > effMax) return null;
      for (let i = lo; i <= hi; i += step) {
        out.add(isDow && i === 7 ? 0 : i);
      }
      continue;
    }

    // plain N
    const singleMatch = part.match(/^\d+$/);
    if (singleMatch) {
      let n = parseInt(part, 10);
      if (min === 0 && max === 6 && n === 7) n = 0;
      if (n < min || n > max) return null;
      out.add(n);
      continue;
    }

    return null;
  }

  if (out.size === 0) return null;
  return Array.from(out).sort((a, b) => a - b);
}

/**
 * Validate a 5-field cron expression.
 * Returns true if valid, false otherwise.
 */
export function parseCronExpression(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  for (let i = 0; i < 5; i++) {
    const result = expandField(parts[i]!, FIELD_RANGES[i]!);
    if (!result) return false;
  }

  return true;
}

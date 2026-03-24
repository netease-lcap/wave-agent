export interface ParsedLoop {
  interval: string;
  prompt: string;
  originalInterval?: string;
  roundedTo?: string;
}

export function parseLoopInput(
  input: string,
  defaultInterval: string = "10m",
): ParsedLoop {
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    return { interval: defaultInterval, prompt: "" };
  }

  // 1. Leading token: ^\d+[smhd]$
  const tokens = trimmedInput.split(/\s+/);
  if (tokens[0].match(/^\d+[smhd]$/)) {
    const interval = tokens[0];
    const prompt = tokens.slice(1).join(" ");
    return { interval, prompt };
  }

  // 2. Trailing "every" clause: every <N><unit> or every <N> <unit-word>
  // Units: s, m, h, d, second(s), minute(s), hour(s), day(s)
  const everyRegex =
    /\s+every\s+(\d+)\s*(s|m|h|d|seconds?|minutes?|hours?|days?)$/i;
  const match = trimmedInput.match(everyRegex);
  if (match) {
    const n = match[1];
    const unitWord = match[2].toLowerCase();
    const unit = unitWord[0];
    const interval = `${n}${unit}`;
    const prompt = trimmedInput.substring(0, match.index).trim();
    return { interval, prompt };
  }

  // 3. Default
  return { interval: defaultInterval, prompt: trimmedInput };
}

const CLEAN_MINUTES = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30];
const CLEAN_HOURS = [1, 2, 3, 4, 6, 8, 12];

function getNearestClean(value: number, cleanValues: number[]): number {
  let nearest = cleanValues[0];
  let minDiff = Math.abs(value - nearest);
  for (const clean of cleanValues) {
    const diff = Math.abs(value - clean);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = clean;
    } else if (diff === minDiff) {
      // If equal diff, prefer the larger one? Or smaller?
      // Let's prefer the larger one to be less frequent
      if (clean > nearest) {
        nearest = clean;
      }
    }
  }
  return nearest;
}

export function intervalToCron(interval: string): {
  cron: string;
  roundedTo?: string;
  cadence: string;
} {
  const match = interval.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid interval format: ${interval}`);
  }

  let n = parseInt(match[1], 10);
  const unit = match[2];
  let roundedTo: string | undefined;

  if (unit === "s") {
    const minutes = Math.ceil(n / 60);
    const result = intervalToCron(`${minutes}m`);
    return {
      ...result,
      roundedTo:
        result.roundedTo || (minutes * 60 !== n ? `${minutes}m` : undefined),
    };
  }

  if (unit === "m") {
    if (n >= 60) {
      const hours = Math.round(n / 60);
      const result = intervalToCron(`${hours}h`);
      return {
        ...result,
        roundedTo:
          result.roundedTo || (hours * 60 !== n ? `${hours}h` : undefined),
      };
    }

    if (!CLEAN_MINUTES.includes(n)) {
      const nearest = getNearestClean(n, CLEAN_MINUTES);
      roundedTo = `${nearest}m`;
      n = nearest;
    }

    // For minutes, we use */N. Thundering herd is less of an issue for high frequency,
    // but we could still offset it. However, the spec says "random minute for approximate requests like 'hourly'".
    // So for minutes, we'll stick to */N.
    return {
      cron: `*/${n} * * * *`,
      roundedTo,
      cadence: `every ${n} minute${n > 1 ? "s" : ""}`,
    };
  }

  if (unit === "h") {
    if (n > 23) {
      const days = Math.round(n / 24);
      const result = intervalToCron(`${days}d`);
      return {
        ...result,
        roundedTo:
          result.roundedTo || (days * 24 !== n ? `${days}d` : undefined),
      };
    }

    if (!CLEAN_HOURS.includes(n)) {
      const nearest = getNearestClean(n, CLEAN_HOURS);
      roundedTo = `${nearest}h`;
      n = nearest;
    }

    // Thundering herd prevention: pick a random minute
    const randomMinute = Math.floor(Math.random() * 60);
    return {
      cron: `${randomMinute} */${n} * * *`,
      roundedTo,
      cadence: `every ${n} hour${n > 1 ? "s" : ""}`,
    };
  }

  if (unit === "d") {
    if (![1, 2, 3, 4, 5, 6, 7, 10, 14, 30].includes(n)) {
      // For days, we don't have a strict "clean" list in spec, but let's use some common ones if needed.
      // Actually, cron supports any */N for days.
    }

    // Thundering herd prevention: pick a random minute and hour
    const randomMinute = Math.floor(Math.random() * 60);
    const randomHour = Math.floor(Math.random() * 24);
    return {
      cron: `${randomMinute} ${randomHour} */${n} * *`,
      roundedTo,
      cadence: `every ${n} day${n > 1 ? "s" : ""}`,
    };
  }

  throw new Error(`Unsupported unit: ${unit}`);
}

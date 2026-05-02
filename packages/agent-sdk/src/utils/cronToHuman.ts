// Human-readable cron expression display.
// Intentionally narrow: covers common patterns; falls through to raw cron
// string for anything else. Based on Claude Code's cronToHuman implementation.

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function formatLocalTime(minute: number, hour: number): string {
  const d = new Date(2000, 0, 1, hour, minute);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * Convert a cron expression to a human-readable string.
 * Covers common patterns; falls through to raw cron for anything else.
 */
export function cronToHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  // Every N minutes: step/N * * * *
  const everyMinMatch = minute.match(/^\*\/(\d+)$/);
  if (
    everyMinMatch &&
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    const n = parseInt(everyMinMatch[1]!, 10);
    return n === 1 ? "Every minute" : `Every ${n} minutes`;
  }

  // Every hour: 0 * * * *
  if (
    minute.match(/^\d+$/) &&
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    const m = parseInt(minute, 10);
    if (m === 0) return "Every hour";
    return `Every hour at :${m.toString().padStart(2, "0")}`;
  }

  // Every N hours: 0 step/N * * *
  const everyHourMatch = hour.match(/^\*\/(\d+)$/);
  if (
    minute.match(/^\d+$/) &&
    everyHourMatch &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    const n = parseInt(everyHourMatch[1]!, 10);
    const m = parseInt(minute, 10);
    const suffix = m === 0 ? "" : ` at :${m.toString().padStart(2, "0")}`;
    return n === 1 ? `Every hour${suffix}` : `Every ${n} hours${suffix}`;
  }

  if (!minute.match(/^\d+$/) || !hour.match(/^\d+$/)) return cron;
  const m = parseInt(minute, 10);
  const h = parseInt(hour, 10);

  // Daily at specific time: M H * * *
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Every day at ${formatLocalTime(m, h)}`;
  }

  // Specific day of week: M H * * D
  if (dayOfMonth === "*" && month === "*" && dayOfWeek.match(/^\d$/)) {
    const dayIndex = parseInt(dayOfWeek, 10) % 7;
    const dayName = DAY_NAMES[dayIndex];
    if (dayName) return `Every ${dayName} at ${formatLocalTime(m, h)}`;
  }

  // Weekdays: M H * * 1-5
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "1-5") {
    return `Weekdays at ${formatLocalTime(m, h)}`;
  }

  return cron;
}

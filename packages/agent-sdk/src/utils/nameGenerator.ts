/**
 * Random name generator for plan files
 */

const adjectives = [
  "gentle",
  "swift",
  "calm",
  "bold",
  "bright",
  "cool",
  "warm",
  "quiet",
  "loud",
  "fast",
  "slow",
  "high",
  "low",
  "deep",
  "shallow",
  "broad",
  "narrow",
  "long",
  "short",
  "brave",
  "wild",
  "tame",
  "smart",
  "clever",
  "kind",
  "fair",
  "just",
  "wise",
  "strong",
  "weak",
];

const nouns = [
  "breeze",
  "river",
  "mountain",
  "forest",
  "ocean",
  "valley",
  "peak",
  "stream",
  "cloud",
  "storm",
  "sun",
  "moon",
  "star",
  "field",
  "meadow",
  "desert",
  "island",
  "coast",
  "plain",
  "glacier",
  "eagle",
  "wolf",
  "bear",
  "lion",
  "tiger",
  "hawk",
  "owl",
  "fox",
  "deer",
  "elk",
];

/**
 * Generates a random English name (adjective-noun)
 */
export function generateRandomName(): string {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}`;
}

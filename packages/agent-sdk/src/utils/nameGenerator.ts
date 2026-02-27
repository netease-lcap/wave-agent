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
 * Generates a random English name (adjective-adjective-noun)
 */
export function generateRandomName(seed?: string): string {
  let adj1Index: number;
  let adj2Index: number;
  let nounIndex: number;

  if (seed) {
    // Simple hash function to derive indices from seed
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    adj1Index = Math.abs(hash) % adjectives.length;
    adj2Index = Math.abs(hash >> 4) % adjectives.length;
    nounIndex = Math.abs(hash >> 8) % nouns.length;
  } else {
    adj1Index = Math.floor(Math.random() * adjectives.length);
    adj2Index = Math.floor(Math.random() * adjectives.length);
    nounIndex = Math.floor(Math.random() * nouns.length);
  }

  const adj1 = adjectives[adj1Index];
  const adj2 = adjectives[adj2Index];
  const noun = nouns[nounIndex];
  return `${adj1}-${adj2}-${noun}`;
}

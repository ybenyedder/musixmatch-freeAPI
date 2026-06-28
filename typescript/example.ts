// Minimal example: fetch word-by-word lyrics and print the enhanced LRC.
// Run after `npm run build`, or with ts-node:  node --loader ts-node/esm example.ts
import { MusixmatchRichsync } from "./src/index.js";

const mx = new MusixmatchRichsync();

for (const [title, artist, duration] of [
  ["Skyfall", "Adele", 286],
  ["Diamonds", "Rihanna", 225],
  ["Blinding Lights", "The Weeknd", 200],
] as const) {
  const res = await mx.getLyrics({ title, artist, duration });
  if (!res) {
    console.log(`✗ ${artist} – ${title}: no match`);
    continue;
  }
  console.log(`${res.kind === "word" ? "✓ WORD" : "· line"} ${res.artistName} – ${res.trackName}`);
  console.log(res.lrc.split("\n").slice(0, 3).join("\n"));
  console.log("-".repeat(60));
}

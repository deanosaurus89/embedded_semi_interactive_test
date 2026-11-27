import { aggregateBuckets, bucketsFromPieces, chipLabel, chooseGrain } from "../js/histogram.js";

const days = [];
for (let index = 0; index < 40; index += 1) {
  days.push({ date: `2026-10-${String((index % 28) + 1).padStart(2, "0")}`, count: 1 });
}
if (chooseGrain(days) !== "week") throw new Error(`Kurzer Zeitraum soll Wochen sein: ${chooseGrain(days)}`);

const months = [];
for (let month = 0; month < 18; month += 1) {
  const date = new Date(Date.UTC(2024, month, 3));
  months.push({ date: date.toISOString().slice(0, 10), count: 10 });
}
const series = aggregateBuckets(months);
if (series.grain !== "month") throw new Error(`Langer Zeitraum soll Monate sein: ${series.grain}`);
if (series.bars.length !== 18) throw new Error(`Monate fehlen: ${series.bars.length}`);
if (series.total !== 180) throw new Error(`Summe falsch: ${series.total}`);

const chip = chipLabel({ grain: "month", bars: series.bars, from: "2025-03-01", to: "2025-06-30", count: 25 });
if (chip !== "03.2025 – 06.2025 · 40 Teile") throw new Error(chip);

const pieces = bucketsFromPieces([
  { measurements: [
    { pieceId: "a", timestamp: "2026-09-27T00:00:00Z", value: 1 },
    { pieceId: "a", timestamp: "2026-09-28T00:00:00Z", value: 2 },
    { pieceId: "b", timestamp: "2026-10-02T00:00:00Z", value: 3 },
  ] },
]);
if (pieces.total !== 2 || pieces.buckets.length !== 2) throw new Error(`Teile nicht eindeutig: ${JSON.stringify(pieces)}`);
console.log("histogram ok");

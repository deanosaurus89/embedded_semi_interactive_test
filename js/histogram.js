const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

export function parseDay(value) {
  const day = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export function spanDays(buckets) {
  const days = (buckets || []).map((bucket) => parseDay(bucket.date)).filter(Boolean).sort();
  if (days.length < 2) return 0;
  const start = Date.parse(`${days[0]}T00:00:00Z`);
  const end = Date.parse(`${days[days.length - 1]}T00:00:00Z`);
  return Math.round((end - start) / 86400000);
}

export function chooseGrain(buckets) {
  return spanDays(buckets) < 92 ? "week" : "month";
}

function shiftDay(day, delta) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function weekStart(day) {
  const date = new Date(`${day}T00:00:00Z`);
  const dow = date.getUTCDay();
  const delta = dow === 0 ? 6 : dow - 1;
  return shiftDay(day, -delta);
}

function monthEnd(monthStart) {
  const [year, month] = monthStart.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0));
  return last.toISOString().slice(0, 10);
}

export function aggregateBuckets(daily) {
  const grain = chooseGrain(daily);
  const map = new Map();
  let total = 0;
  for (const bucket of daily || []) {
    const day = parseDay(bucket.date);
    const count = Number(bucket.count) || 0;
    if (!day || count <= 0) continue;
    total += count;
    const key = grain === "week" ? weekStart(day) : `${day.slice(0, 7)}-01`;
    const bar = map.get(key) || { start: key, end: key, count: 0 };
    bar.count += count;
    if (day > bar.end) bar.end = day;
    map.set(key, bar);
  }
  const bars = [...map.values()].sort((a, b) => (a.start < b.start ? -1 : 1));
  for (const bar of bars) {
    if (grain === "month") {
      bar.end = monthEnd(bar.start);
      const month = Number(bar.start.slice(5, 7));
      bar.label = MONTHS[month - 1];
      bar.year = Number(bar.start.slice(0, 4));
    } else {
      bar.end = shiftDay(bar.start, 6);
      const date = new Date(`${bar.start}T00:00:00Z`);
      bar.label = `${date.getUTCDate()}.${date.getUTCMonth() + 1}`;
      bar.year = date.getUTCFullYear();
    }
  }
  return { grain, total, bars };
}

export function presetIndex(bars, count) {
  if (count === "all") return 0;
  const target = Number(count) || 0;
  if (!target) return 0;
  let sum = 0;
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    sum += bars[index].count;
    if (sum >= target) return index;
  }
  return 0;
}

function monthStamp(day) {
  return `${day.slice(5, 7)}.${day.slice(0, 4)}`;
}

function dayStamp(day) {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;
}

export function chipLabel({ grain, bars, from, to, count }) {
  if (from && to) {
    const inside = (bars || []).filter((bar) => !(bar.end < from || bar.start > to));
    const sum = inside.reduce((total, bar) => total + bar.count, 0);
    if (grain === "month") {
      const left = monthStamp(from);
      const right = monthStamp(to);
      return `${left === right ? left : `${left} – ${right}`} · ${sum} Teile`;
    }
    return `${dayStamp(from)} – ${dayStamp(to)} · ${sum} Teile`;
  }
  if (count === "all") return "Alle Teile";
  return `Letzte ${count || 25} Teile`;
}

export function spanLabel(bars) {
  if (!bars?.length) return "";
  const first = bars[0];
  const last = bars[bars.length - 1];
  if (String(first.start).slice(8, 10) === "01") {
    return `${monthStamp(first.start)} – ${monthStamp(last.start)}`;
  }
  return `${dayStamp(first.start)} – ${dayStamp(last.end)}`;
}

export function bucketsFromPieces(characteristics) {
  const seen = new Set();
  const days = new Map();
  for (const characteristic of characteristics || []) {
    for (const sample of characteristic.measurements || []) {
      const day = parseDay(sample.timestamp || sample.creationDateUser);
      const id = sample.pieceId || `${day}:${sample.value}`;
      if (!day || seen.has(id)) continue;
      seen.add(id);
      days.set(day, (days.get(day) || 0) + 1);
    }
  }
  return {
    total: seen.size,
    buckets: [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, count]) => ({ date, count })),
  };
}

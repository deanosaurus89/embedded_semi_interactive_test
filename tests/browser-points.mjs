import puppeteer from "/tmp/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import { add, basis, scale } from "../js/fit.js";
import { findPointSamples } from "./point-samples.mjs";

const url = process.argv[2];
const screenshot = process.argv[3];
if (!url || !screenshot) {
  console.error("usage: browser-points.mjs <url> <screenshot>");
  process.exit(1);
}

const samples = findPointSamples();
const browser = await puppeteer.launch({
  executablePath: "/usr/local/bin/google-chrome",
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--window-size=1440,900",
  ],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.setDefaultTimeout(90000);
const failures = [];
page.on("pageerror", (error) => failures.push(String(error)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__probe?.ready);
await page.click("#prepare");
await page.waitForSelector("#editor:not([hidden])");
const savedView = await page.evaluate(() => window.__probe.view());
const [side] = basis(samples.pose.axis);
const eye = add(samples.pose.center, add(scale(samples.pose.axis, samples.pose.length * 0.5 + 90), scale(side, 28)));
await page.evaluate(({ eye, target }) => window.__probe.look(eye, target), { eye, target: samples.pose.center });
const visibleWall = await page.evaluate((items) => items
  .map((item) => ({ ...item, screen: window.__probe.visible(item.point) }))
  .filter((item) => item.screen), samples.cylinderWall);
const quad = chooseCylinderQuad(visibleWall);
if (!quad) throw new Error(`kein sichtbarer 4-Punkt-Zylinder (${visibleWall.length} Knoten sichtbar)`);
await page.select("#tool", "Zylinder");
const clicked = await page.evaluate((points) => {
  const view = document.getElementById("view");
  const click = (point) => {
    const screen = window.__probe.visible(point);
    if (!screen) return false;
    const common = { bubbles: true, cancelable: true, clientX: screen.x, clientY: screen.y, button: 0, pointerId: 1 };
    view.dispatchEvent(new PointerEvent("pointerdown", { ...common, buttons: 1 }));
    view.dispatchEvent(new PointerEvent("pointerup", { ...common, buttons: 0 }));
    return true;
  };
  for (let index = 0; index < 3; index += 1) {
    if (!click(points[index])) return { ok: false, at: index + 1 };
  }
  const hint = window.__probe.status();
  if (!click(points[3])) return { ok: false, at: 4, hint };
  return { ok: true, hint, picks: window.__probe.picks, toast: document.querySelector("#toast")?.textContent || "" };
}, quad.points.map((item) => item.point));
if (!clicked.ok) throw new Error(`Zylinderklick fehlgeschlagen ${JSON.stringify(clicked)}`);
const hint = clicked.hint;
try {
  await page.waitForFunction((expected) => {
    const preview = window.__probe.preview;
    return preview?.type === "Zylinder"
      && Math.abs(preview.diameter - 80) < 0.05
      && Math.abs(preview.length - expected) < 0.5;
  }, { timeout: 8000 }, quad.length);
} catch (error) {
  const debug = await page.evaluate(() => ({
    summary: window.__probe.summary(),
    status: window.__probe.status(),
    preview: window.__probe.preview,
    toast: document.querySelector("#toast")?.textContent || "",
    tool: document.querySelector("#tool").value,
  }));
  throw new Error(`${error.message} ${JSON.stringify(debug)}`);
}
const cylinder = await page.evaluate(() => ({
  summary: window.__probe.summary(),
  status: window.__probe.status(),
  preview: window.__probe.preview,
}));
cylinder.hint = hint;
if (!hint.includes("Punkt 4 von 4") || !hint.includes("in der Tiefe")) {
  throw new Error(`Hinweis fehlt: ${hint}`);
}
await page.evaluate(() => {
  const toast = document.getElementById("toast");
  if (toast) toast.hidden = true;
});
await page.screenshot({ path: screenshot });

await page.evaluate(() => document.querySelector("#fit-cancel")?.click());
let circled = false;
const circleViews = [null, savedView];
for (const view of circleViews) {
  if (view) await page.evaluate((next) => window.__probe.look(next.position, next.target), view);
  for (const group of [samples.circle, ...samples.circleCandidates]) {
    await page.select("#tool", "Kreis");
    try {
      await clickDistinct(page, group, 3);
      circled = true;
      break;
    } catch {
      await page.evaluate(() => document.querySelector("#fit-cancel")?.click());
    }
  }
  if (circled) break;
}
if (!circled) throw new Error("kein sichtbarer Kreisrand");
try {
  await page.waitForFunction(() => {
    const preview = window.__probe.preview;
    return preview?.type === "Kreis" && Math.abs(preview.diameter - 80) < 0.05;
  }, { timeout: 5000 });
} catch (error) {
  const debug = await page.evaluate(() => ({ summary: window.__probe.summary(), status: window.__probe.status(), preview: window.__probe.preview }));
  throw new Error(`${error.message} ${JSON.stringify(debug)}`);
}
const circle = await page.evaluate(() => window.__probe.summary());

await page.click("#fit-cancel");
await page.evaluate((view) => window.__probe.look(view.position, view.target), savedView);
await page.evaluate((view) => {
  document.getElementById("flags").style.visibility = "hidden";
  window.__probe.look(view.position, view.target);
}, savedView);
await page.select("#tool", "Ebene");
let plane = null;
for (let shift = 0; shift < 40 && !plane; shift += 8) {
  const planeScreens = await page.evaluate((origin) => window.__probe.gridPlane(4, origin), shift);
  if (planeScreens.length < 4) continue;
  await page.evaluate(() => document.querySelector("#fit-cancel")?.click());
  for (const point of planeScreens) {
    await page.evaluate((point) => {
      const view = document.getElementById("view");
      const common = { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, button: 0, pointerId: 1 };
      view.dispatchEvent(new PointerEvent("pointerdown", { ...common, buttons: 1 }));
      view.dispatchEvent(new PointerEvent("pointerup", { ...common, buttons: 0 }));
    }, point);
  }
  plane = await page.evaluate(() => {
    const preview = window.__probe.preview;
    return preview?.type === "Ebene" && preview.form < 0.05 ? window.__probe.summary() : null;
  });
}
if (!plane) throw new Error("keine ebene Flaeche im Blick");

console.log(JSON.stringify({ cylinder, circle, plane, pageErrors: failures }, null, 2));
await browser.close();

function farPoints(list, count, gap) {
  const pool = list.slice();
  const chosen = [];
  while (chosen.length < count && pool.length) {
    let best = 0;
    let bestDistance = -1;
    pool.forEach((item, index) => {
      const distance = chosen.length
        ? Math.min(...chosen.map((kept) => Math.hypot(
          kept.point[0] - item.point[0],
          kept.point[1] - item.point[1],
          kept.point[2] - item.point[2],
        )))
        : 1e9;
      if (distance > bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    if (chosen.length && bestDistance < gap) return null;
    chosen.push(pool.splice(best, 1)[0]);
  }
  return chosen.length === count ? chosen : null;
}

function chooseCylinderQuad(visible) {
  const groups = new Map();
  for (const item of visible) {
    const key = Math.round(item.axial);
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }
  const keys = [...groups.keys()].sort((a, b) => a - b);
  let best = null;
  for (const key of keys) {
    const section = groups.get(key);
    if (section.length < 3) continue;
    for (const other of keys) {
      if (Math.abs(other - key) < 40) continue;
      const depth = groups.get(other)[0];
      const triple = farPoints(section, 3, 8);
      if (!triple) continue;
      const mean = (triple[0].axial + triple[1].axial + triple[2].axial) / 3;
      const span = Math.abs(depth.axial - mean);
      if (!best || span > best.length) best = { points: [...triple, depth], length: span };
    }
  }
  return best;
}

async function clickDistinct(page, candidates, count) {
  const visible = await page.evaluate((items) => items
    .map((item) => ({ screen: window.__probe.visible(item.point), angle: item.angle || 0 }))
    .filter((item) => item.screen), candidates);
  const pool = visible.slice();
  const taken = [];
  const skipped = new Set();
  while (taken.length + skipped.size < pool.length) {
    const have = await page.evaluate(() => window.__probe.picks);
    if (have >= count) return;
    let best = -1;
    let bestGap = -1;
    pool.forEach((item, index) => {
      if (taken.includes(index) || skipped.has(index)) return;
      const gap = taken.length
        ? Math.min(...taken.map((kept) => Math.abs(Math.atan2(Math.sin(item.angle - pool[kept].angle), Math.cos(item.angle - pool[kept].angle)))))
        : 1;
      if (gap > bestGap) {
        best = index;
        bestGap = gap;
      }
    });
    if (best < 0 || (taken.length && bestGap < 0.35)) break;
    await page.mouse.click(pool[best].screen.x, pool[best].screen.y);
    const after = await page.evaluate(() => window.__probe.picks);
    if (after > taken.length) taken.push(best);
    else skipped.add(best);
  }
  const have = await page.evaluate(() => window.__probe.picks);
  if (have < count) throw new Error(`nur ${have} von ${count} Punkten gesetzt, sichtbar ${visible.length}`);
}

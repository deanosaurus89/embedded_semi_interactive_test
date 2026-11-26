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
const eye = add(samples.pose.center, add(scale(samples.pose.axis, samples.pose.length * 0.5 + 80), scale(side, 22)));
await page.evaluate(({ eye, target }) => window.__probe.look(eye, target), { eye, target: samples.pose.center });

await page.select("#tool", "Zylinder");
await clickDistinct(page, samples.cylinderCandidates, 5);
try {
  await page.waitForFunction(() => {
    const preview = window.__probe.preview;
    return preview?.type === "Zylinder" && Math.abs(preview.diameter - 80) < 0.05;
  }, { timeout: 8000 });
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
const planeScreens = await page.evaluate(() => window.__probe.gridPlane(4));
if (planeScreens.length < 4) throw new Error(`nur ${planeScreens.length} ebene Knoten im Blick`);
await page.select("#tool", "Ebene");
for (const point of planeScreens) await page.mouse.click(point.x, point.y);
await page.waitForFunction(() => window.__probe.preview?.type === "Ebene" && window.__probe.preview.form < 0.05);
const plane = await page.evaluate(() => window.__probe.summary());

console.log(JSON.stringify({ cylinder, circle, plane, pageErrors: failures }, null, 2));
await browser.close();

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

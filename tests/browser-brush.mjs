// Headless check of the same page the browser loads: weld-backed Fläche grow
// and Pinsel painting on models/milkyway.obj.

import puppeteer from "/tmp/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const url = process.argv[2];
const screenshot = process.argv[3];
if (!url || !screenshot) {
  console.error("usage: browser-brush.mjs <url> <screenshot>");
  process.exit(1);
}

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
page.setDefaultTimeout(120000);
const failures = [];
page.on("pageerror", (error) => failures.push(String(error)));
await page.goto(url, { waitUntil: "networkidle0" });
await page.waitForFunction(() => window.__probe?.ready);
await page.click("#prepare");
await page.waitForSelector("#editor:not([hidden])");
await page.select("#char-select", await page.$eval("#char-select", (el) => el.value));

const targets = await page.evaluate(() => window.__probe.findPaintTargets());
if (!targets.cylinder || !targets.plane) {
  throw new Error(`Sichtbare Flaechen fehlen: ${JSON.stringify(targets)}`);
}

await page.select("#tool", "Zylinder");
await page.select("#method", "brush");
await page.$eval("#brush-radius", (el) => {
  el.value = "6";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await paint(page, targets.cylinder);
try {
  await page.waitForFunction(() => {
    const preview = window.__probe.preview;
    return preview?.type === "Zylinder" && Math.abs(preview.diameter - 80) < 0.1;
  });
} catch (error) {
  const debug = await page.evaluate(() => ({
    summary: window.__probe.summary(),
    brush: window.__probe.brushSize,
    preview: window.__probe.preview,
    toast: document.querySelector("#toast")?.textContent || "",
  }));
  throw new Error(`${error.message} ${JSON.stringify(debug)}`);
}
const brushSummary = await page.evaluate(() => window.__probe.summary());
const brushCount = await page.evaluate(() => window.__probe.brushSize);
await page.screenshot({ path: screenshot });

await page.click("#brush-clear");
await page.select("#tool", "Auto");
await paint(page, targets.plane);
await page.waitForFunction(() => window.__probe.summary().includes("Ebene"));
const planeSummary = await page.evaluate(() => window.__probe.summary());

await page.click("#brush-clear");
await page.select("#method", "patch");
await page.select("#tool", "Zylinder");
await page.mouse.click(targets.cylinder.x, targets.cylinder.y);
await page.waitForFunction(() => {
  const preview = window.__probe.preview;
  return preview?.type === "Zylinder" && Math.abs(preview.diameter - 80) < 0.1 && window.__probe.summary().includes("Punkte");
});
const patchSummary = await page.evaluate(() => window.__probe.summary());

console.log(JSON.stringify({
  brushSummary,
  brushCount,
  planeSummary,
  patchSummary,
  cylinderTarget: { faces: targets.cylinder.faces, diameter: targets.cylinder.diameter },
  planeTarget: { faces: targets.plane.faces, type: targets.plane.type },
  pageErrors: failures,
}, null, 2));

await browser.close();

async function paint(page, target) {
  const path = await page.evaluate((point) => window.__probe.brushPath(point.x, point.y, 14), target);
  const samples = path.length ? path : [target];
  await page.mouse.move(samples[0].x, samples[0].y);
  await page.mouse.down();
  for (const point of samples) await page.mouse.move(point.x, point.y);
  await page.mouse.up();
}

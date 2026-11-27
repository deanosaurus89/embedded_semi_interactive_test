import puppeteer from "/tmp/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const url = process.argv[2];
const screenshot = process.argv[3];
const browser = await puppeteer.launch({
  executablePath: "/usr/local/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--window-size=1440,900"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.setDefaultTimeout(60000);
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__probe?.ready);

const before = await page.evaluate(() => ({ leaders: window.__probe.leaders(), placements: window.__probe.placementCount() }));
if (before.leaders < before.placements) throw new Error(`Linien fehlen: ${before.leaders}/${before.placements}`);

await page.click("#prepare");
await page.evaluate(() => window.__probe.clearAnchor("rundheit-lager"));
const missing = await page.evaluate(() => ({
  leaders: window.__probe.leaders(),
  unassigned: document.querySelector('[data-id="rundheit-lager"]')?.classList.contains("is-unassigned"),
}));
if (!missing.unassigned || missing.leaders !== before.leaders - 1) throw new Error(`Neuverbinden-Zustand falsch ${JSON.stringify(missing)}`);
await page.click('[data-id="rundheit-lager"]');
await page.click("#reconnect");
await page.evaluate(() => {
  const view = document.getElementById("view");
  const rect = view.getBoundingClientRect();
  for (let y = 0.25; y <= 0.8; y += 0.04) {
    for (let x = 0.2; x <= 0.8; x += 0.04) {
      const point = { x: rect.left + rect.width * x, y: rect.top + rect.height * y };
      if (!window.__probe.hit(point.x, point.y)) continue;
      const common = { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, button: 0, pointerId: 1 };
      view.dispatchEvent(new PointerEvent("pointerdown", { ...common, buttons: 1 }));
      view.dispatchEvent(new PointerEvent("pointerup", { ...common, buttons: 0 }));
      return;
    }
  }
  throw new Error("kein Treffer fuer die neue Linie");
});
const relinked = await page.evaluate(() => window.__probe.leaders());
if (relinked < before.placements) throw new Error(`Linie nach Neuverbinden fehlt: ${relinked}`);

await page.evaluate(() => window.__probe.addSlot());
const shapes = await page.evaluate(() => window.__probe.shapes());
if (!shapes.includes("stadium")) throw new Error(`kein Langloch-Umriss: ${shapes.join(",")}`);
const slotLeaders = await page.evaluate(() => window.__probe.leaders());
if (slotLeaders < before.placements) throw new Error("Geometrie ohne Linie");

const tip = await page.evaluate(() => {
  const mark = document.querySelector(".spark .pt");
  const rect = mark.getBoundingClientRect();
  mark.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: rect.left + 2, clientY: rect.top + 2 }));
  const node = document.getElementById("chart-tip");
  return { hidden: node.hidden, text: node.textContent };
});
if (tip.hidden || !tip.text.includes("Istwert") || !tip.text.includes("Auftrag")) throw new Error(`Tooltip fehlt: ${tip.text}`);

await page.$eval('[data-count="all"]', (el) => el.click());
const full = await page.$eval('.flag[data-id="zyl-a-dm"]', (node) => Number(node.getAttribute("data-n")));
await page.$eval("#filter-from", (el) => {
  el.value = "2026-11-01";
  el.dispatchEvent(new Event("change", { bubbles: true }));
});
const ranged = await page.$eval('.flag[data-id="zyl-a-dm"]', (node) => Number(node.getAttribute("data-n")));
await page.$eval("#filter-count", (el) => {
  el.value = "10";
  el.dispatchEvent(new Event("change", { bubbles: true }));
});
const ten = await page.$eval('.flag[data-id="zyl-a-dm"]', (node) => Number(node.getAttribute("data-n")));
if (!(full > ranged && ranged > 10 && ten === 10)) {
  throw new Error(`Filter falsch full=${full} ten=${ten} ranged=${ranged}`);
}

await page.click("#finish");
const lockedMove = await page.evaluate(() => {
  const beforeCam = window.__probe.camera();
  const view = document.getElementById("view");
  view.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120, clientX: 700, clientY: 400 }));
  const after = window.__probe.camera();
  return { locked: window.__probe.locked(), moved: beforeCam.some((value, i) => Math.abs(value - after[i]) > 0.01) };
});
if (!lockedMove.locked || lockedMove.moved) throw new Error(`Sperre haelt nicht ${JSON.stringify(lockedMove)}`);
await page.click("#view-lock");
const unlockedMove = await page.evaluate(() => {
  const beforeCam = window.__probe.camera();
  const view = document.getElementById("view");
  view.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120, clientX: 700, clientY: 400 }));
  const after = window.__probe.camera();
  return { locked: window.__probe.locked(), moved: beforeCam.some((value, i) => Math.abs(value - after[i]) > 0.01) };
});
if (unlockedMove.locked || !unlockedMove.moved) throw new Error(`Entsperren zoomt nicht ${JSON.stringify(unlockedMove)}`);

await page.screenshot({ path: screenshot });
console.log(JSON.stringify({ before, ten, ranged, full, shapes, tip: tip.text.slice(0, 180), unlockedMove }, null, 2));
await browser.close();

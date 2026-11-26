// Live data replaces the demo Merkmale and keeps a layout per template.
import puppeteer from "/tmp/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const url = process.argv[2];
const screenshot = process.argv[3];
const live = {
  schemaVersion: 1,
  source: "live",
  part: { id: "proj-demo", name: "Beispielprojekt", template: { id: "tpl-b", name: "Stand B" } },
  characteristics: [
    {
      id: "Objekt 1 / Merkmal A",
      name: "Objekt 1 / Merkmal A",
      unit: "mm",
      nominal: 10,
      usl: 10.1,
      lsl: 9.9,
      measurements: [{ pieceId: "P-1", pieceName: "P-1", value: 10.01, timestamp: "2026-11-02T08:00:00Z" }],
    },
    {
      id: "Objekt 2 / Merkmal B",
      name: "Objekt 2 / Merkmal B",
      unit: "mm",
      nominal: 4,
      usl: 4.2,
      lsl: 3.8,
      measurements: [{ pieceId: "P-1", pieceName: "P-1", value: 4.05, timestamp: "2026-11-02T08:00:00Z" }],
    },
  ],
};

const browser = await puppeteer.launch({
  executablePath: "/usr/local/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars", "--window-size=1440,900"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
await page.setRequestInterception(true);
page.on("request", (request) => {
  if (request.url().includes("live-measurements.json")) {
    request.respond({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(live),
    });
    return;
  }
  request.continue();
});
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__probe?.ready);
const view = await page.evaluate(() => ({
  badge: document.getElementById("template-badge")?.textContent || "",
  names: [...document.querySelectorAll(".flag .flag-name")].map((node) => node.textContent),
  demo: Boolean(document.querySelector('[data-id="zyl-a-dm"]')),
}));
if (!view.badge.includes("Stand B")) throw new Error(`Vorlage fehlt: ${view.badge}`);
if (view.demo) throw new Error("Demo-Merkmal ist noch sichtbar");
if (!view.names.includes("Objekt 1 / Merkmal A") || !view.names.includes("Objekt 2 / Merkmal B")) {
  throw new Error(`Live-Merkmale fehlen: ${view.names.join(" | ")}`);
}
await page.click("#prepare");
await page.click("#finish");
const stored = await page.evaluate(() => localStorage.getItem("milkyway-setup-v2:tpl-b"));
if (!stored || stored.includes("zyl-a-dm")) throw new Error("Layout ist nicht nach Vorlage getrennt");
await page.screenshot({ path: screenshot });
console.log(JSON.stringify(view, null, 2));
await browser.close();

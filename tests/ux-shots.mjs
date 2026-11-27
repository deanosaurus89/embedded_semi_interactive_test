import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "/tmp/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const port = 4192;
const dir = process.argv[2] || "/opt/cursor/artifacts";
const hash = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const obj = [
  "o box",
  "v 0 0 0", "v 120 0 0", "v 120 70 0", "v 0 70 0",
  "v 0 0 28", "v 120 0 28", "v 120 70 28", "v 0 70 28",
  "f 1 2 3", "f 1 3 4",
  "f 5 6 7", "f 5 7 8",
  "f 1 2 6", "f 1 6 5",
  "f 2 3 7", "f 2 7 6",
  "f 3 4 8", "f 3 8 7",
  "f 4 1 5", "f 4 5 8",
].join("\n");

const buckets = [];
for (let month = 0; month < 36; month += 1) {
  const date = new Date(Date.UTC(2023, 11 + month, 4));
  const count = 12 + (date.getUTCMonth() === 7 ? 40 : (month * 3) % 17);
  buckets.push({ date: date.toISOString().slice(0, 10), count });
}

function send(res, code, body, type) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  res.writeHead(code, {
    "Content-Type": type || "application/json",
    "Cache-Control": "no-store",
    "Content-Length": String(buf.length),
  });
  res.end(buf);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/api/version") return send(res, 200, { name: "DL-Merkmal-Viewer", version: "1.0.0" });
  if (url.pathname === "/api/settings") return send(res, 200, { server: "", tokenSet: false, pollSeconds: 60 });
  if (url.pathname === "/api/projects") {
    return send(res, 200, { total: 1, items: [{ id: "proj-1", name: "Beispielprojekt", workspaceName: "Werkstatt Demo" }] });
  }
  if (url.pathname === "/api/projects/proj-1/templates") {
    return send(res, 200, { items: [{ id: "tpl-1", name: "Gehaeuse A", pieceCount: 904, samplePieceId: "piece-1" }] });
  }
  if (url.pathname.endsWith("/models")) {
    return send(res, 200, { items: [
      { name: "Gehaeuse_Unterteil", hash, sizeBytes: 18 * 1024 * 1024 },
      { name: "Deckel", hash: "ffffffffffffffffffffffffffffffffffffffff", sizeBytes: 6 * 1024 * 1024 },
    ] });
  }
  if (url.pathname === `/api/models/${hash}`) return send(res, 200, obj, "model/obj");
  if (url.pathname.startsWith("/api/models/")) return send(res, 200, obj, "model/obj");
  if (url.pathname === "/api/controls") {
    return send(res, 200, { items: [
      { id: "ctl-1", objectName: "Bohrung_1", name: "Durchmesser", type: "Kreis", nominal: 10, tolerances: { low: -0.1, up: 0.1 } },
      { id: "ctl-2", objectName: "Flaeche_Oben", name: "Ebenheit", type: "Ebene", nominal: 0, tolerances: { low: 0, up: 0.2 } },
      { id: "ctl-3", objectName: "Zapfen_1", name: "Durchmesser", type: "Zylinder", nominal: 14, tolerances: { low: -0.1, up: 0.1 } },
    ] });
  }
  if (url.pathname === "/api/timeline") return send(res, 200, { total: 904, buckets });
  if (url.pathname === "/api/live") {
    return send(res, 200, {
      schemaVersion: 1, source: "live", stale: false, refreshSeconds: 60, fetchedAt: "2026-11-27T10:00:00Z",
      part: { id: "proj-1", name: "Beispielprojekt", template: { id: "tpl-1", name: "Gehaeuse A" } },
      pieces: [], features: [],
      characteristics: [
        { id: "ctl-1", name: "Bohrung_1 / Durchmesser", objectName: "Bohrung_1", controlName: "Durchmesser", unit: "mm", nominal: 10, usl: 10.1, lsl: 9.9, measurements: [] },
        { id: "ctl-2", name: "Flaeche_Oben / Ebenheit", objectName: "Flaeche_Oben", controlName: "Ebenheit", unit: "mm", nominal: 0, usl: 0.2, lsl: 0, measurements: [] },
        { id: "ctl-3", name: "Zapfen_1 / Durchmesser", objectName: "Zapfen_1", controlName: "Durchmesser", unit: "mm", nominal: 14, usl: 14.1, lsl: 13.9, measurements: [] },
      ],
    });
  }
  const file = path.normalize(path.join(root, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, "missing", "text/plain");
  const ext = path.extname(file);
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".obj": "model/obj" };
  send(res, 200, fs.readFileSync(file), types[ext] || "application/octet-stream");
});

await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
fs.mkdirSync(dir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: "/usr/local/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--window-size=1280,800"],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on("pageerror", (error) => console.error("PAGE", error.message));
page.setDefaultTimeout(60000);
await page.goto(`http://127.0.0.1:${port}/index.html?probe=1`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#wizard:not([hidden])");
await page.type("#project-q", "Beispiel");
await page.click("#project-search");
await page.waitForSelector("#project-results button");
await page.evaluate(() => document.querySelector("#project-results button").click());
await page.waitForSelector("#template-results button");
await page.evaluate(() => document.querySelector("#template-results button").click());
await page.waitForSelector("#model-results input");
await page.evaluate(() => {
  for (const box of document.querySelectorAll("#model-results input")) {
    box.checked = box.dataset.name === "Gehaeuse_Unterteil";
    box.dispatchEvent(new Event("change", { bubbles: true }));
  }
});
await page.waitForFunction(() => document.body.innerText.includes("im 3D") && document.body.innerText.includes("geladen"));
await page.screenshot({ path: path.join(dir, "v1-referenz-geladen.png") });

await page.click("#models-next");
await page.waitForSelector("#control-results input");
await page.evaluate(() => {
  for (const box of document.querySelectorAll("#control-results input")) box.checked = true;
});
await page.click("#controls-apply");
await page.waitForSelector(".flag");
await page.click("#prepare");
await page.waitForSelector("#editor:not([hidden])");
const armed = await page.evaluate(() => window.__probe.armReady());
if (!armed?.enabled) throw new Error(`Bestaetigen nicht aktiv: ${JSON.stringify(armed)}`);
await page.screenshot({ path: path.join(dir, "v1-edit-bestaetigen.png") });

await page.click("#mode-view");
await page.waitForFunction(() => {
  const node = document.getElementById("timeline-total");
  return node && !document.getElementById("timeline").hidden && node.textContent.includes("904");
});
await page.evaluate(() => {
  const bars = [...document.querySelectorAll("#timeline-bars button")];
  const start = bars[15];
  const end = bars[20];
  const fire = (type, node) => {
    const rect = node.getBoundingClientRect();
    const event = new PointerEvent(type, { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + 8, button: 0, pointerId: 1 });
    document.getElementById("hist").dispatchEvent(event);
  };
  fire("pointerdown", start);
  fire("pointermove", end);
  fire("pointerup", end);
});
await page.waitForFunction(() => (document.getElementById("range-note")?.textContent || "").includes("Teile"));
await page.screenshot({ path: path.join(dir, "v1-ansicht-zeitraum.png") });
await page.click("#timeline-hide");
await page.waitForSelector("#timeline-collapsed:not([hidden])");
await page.screenshot({ path: path.join(dir, "v1-ansicht-ausgeblendet.png") });
await browser.close();
server.close();
console.log("ux shots ok");

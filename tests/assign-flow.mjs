import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "/tmp/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const port = 4184;
const dir = process.argv[2] || "/opt/cursor/artifacts";
const hash = "dddddddddddddddddddddddddddddddddddddddd";
const obj = "o a\nv 0 0 0\nv 60 0 0\nv 0 30 12\nf 1 2 3\n";

function send(res, code, body, type) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  res.writeHead(code, { "Content-Type": type || "application/json", "Cache-Control": "no-store" });
  res.end(buf);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/api/version") return send(res, 200, { name: "DL-Merkmal-Viewer", version: "1.0.0" });
  if (url.pathname === "/api/settings") return send(res, 200, { server: "", tokenSet: false, pollSeconds: 60 });
  if (url.pathname === "/api/projects") {
    return send(res, 200, { total: 1, items: [{ id: "proj-1", name: "Projekt Eins", workspaceName: "Arbeitsbereich Eins" }] });
  }
  if (url.pathname === "/api/projects/proj-1/templates") {
    return send(res, 200, { items: [
      { id: "tpl-a", name: "Stand A", pieceCount: 400, samplePieceId: "piece-a" },
      { id: "tpl-b", name: "Stand B", pieceCount: 635, samplePieceId: "piece-b" },
    ] });
  }
  if (url.pathname.endsWith("/models") && url.pathname.startsWith("/api/pieces/")) {
    return send(res, 200, { items: [{ name: "Gehaeuse.prt", hash, sizeBytes: 1200000 }] });
  }
  if (url.pathname === `/api/models/${hash}`) return send(res, 200, obj, "model/obj");
  if (url.pathname === "/api/controls") {
    return send(res, 200, { items: [
      { id: "ctl-1", objectName: "Langloch 1", name: "Mating Length 1", type: "Distance", nominal: 10, tolerances: { low: -0.1, up: 0.1 }, label: "Langloch 1 / Mating Length 1" },
      { id: "ctl-2", objectName: "Zylinder 4", name: "Position 1", type: "Position", nominal: 0, tolerances: { low: -0.2, up: 0.2 }, label: "Zylinder 4 / Position 1" },
    ] });
  }
  if (url.pathname === "/api/timeline") {
    return send(res, 200, { total: 635, buckets: [
      { date: "2026-11-01", count: 4 },
      { date: "2026-11-02", count: 9 },
      { date: "2026-11-03", count: 2 },
      { date: "2026-11-04", count: 7 },
    ] });
  }
  if (url.pathname === "/api/live") {
    return send(res, 200, {
      schemaVersion: 1, source: "live", stale: false, refreshSeconds: 60, fetchedAt: "2026-11-27T10:00:00Z",
      part: { id: "proj-1", name: "Projekt Eins", template: { id: "tpl-b", name: "Stand B" } },
      pieces: [{ id: "piece-b", name: "Teil B", timestamp: "2026-11-02T00:00:00Z" }],
      features: [],
      characteristics: [
        { id: "ctl-1", name: "Langloch 1 / Mating Length 1", objectName: "Langloch 1", controlName: "Mating Length 1", unit: "mm", nominal: 10, usl: 10.1, lsl: 9.9, measurements: [{ pieceId: "piece-b", value: 10.02, timestamp: "2026-11-02T00:00:00Z" }] },
        { id: "ctl-2", name: "Zylinder 4 / Position 1", objectName: "Zylinder 4", controlName: "Position 1", unit: "mm", nominal: 0, usl: 0.2, lsl: -0.2, measurements: [{ pieceId: "piece-b", value: 0.01, timestamp: "2026-11-02T00:00:00Z" }] },
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
const browser = await puppeteer.launch({
  executablePath: "/usr/local/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--window-size=1440,900"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.on("pageerror", (error) => console.error("PAGE", error.message));
page.setDefaultTimeout(60000);
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle0" });
await page.waitForSelector("#wizard:not([hidden])");
await page.type("#project-q", "Projekt");
await page.click("#project-search");
await page.waitForSelector("#project-results button");
await page.evaluate(() => document.querySelector("#project-results button").click());
await page.waitForSelector("#template-results button:nth-of-type(1)");
const templates = await page.$eval("#template-results", (el) => el.textContent);
if (!templates.includes("Stand A") || !templates.includes("400") || !templates.includes("Stand B") || !templates.includes("635")) {
  throw new Error(`Vorlagen falsch: ${templates}`);
}
await page.screenshot({ path: path.join(dir, "vorlagen-beide.png") });
await page.evaluate(() => [...document.querySelectorAll("#template-results button")].find((node) => node.textContent.includes("Stand B")).click());
await page.waitForSelector("#model-results input");
await page.click("#models-next");
await page.waitForFunction(() => document.getElementById("control-results").textContent.includes("Langloch"));
const controls = await page.$eval("#control-results", (el) => el.textContent);
if (!controls.includes("Langloch 1 / Mating Length 1") || !controls.includes("Zylinder 4 / Position 1")) {
  const err = await page.evaluate(() => ({
    error: document.getElementById("wizard-error").textContent,
    panels: [...document.querySelectorAll("[data-panel]")].map((el) => `${el.dataset.panel}:${el.hidden}`),
    models: document.getElementById("model-results").textContent,
  }));
  throw new Error(`Namen falsch: ${JSON.stringify(err)}`);
}
await page.screenshot({ path: path.join(dir, "merkmale-benannt.png") });
await page.evaluate(() => {
  for (const box of document.querySelectorAll("#control-results input")) box.checked = true;
});
await page.click("#controls-apply");
await page.waitForSelector(".flag");
await page.click("#prepare");
await page.waitForSelector("#assign-step");
const step = await page.$eval("#assign-step", (el) => el.textContent);
const name = await page.$eval("#assign-name", (el) => el.textContent);
if (!step.includes("1 von 2") || !name.includes("Langloch 1 / Mating Length 1")) throw new Error(`Zuordnung falsch ${step} ${name}`);
await page.click("#mode-view");
await page.waitForFunction(() => {
  const node = document.getElementById("timeline-total");
  return node && !document.getElementById("timeline").hidden && node.textContent.includes("635");
});
const total = await page.$eval("#timeline-total", (el) => el.textContent);
if (!total.includes("635")) throw new Error(`Zeitstrahl ${total}`);
await page.screenshot({ path: path.join(dir, "zuordnung-zeitstrahl.png") });
await browser.close();
server.close();
console.log("assign-flow ok");

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "/tmp/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const port = 4183;
const shot = process.argv[2] || "/opt/cursor/artifacts/live-stand.png";
const hash = "cccccccccccccccccccccccccccccccccccccccc";
const obj = "o a\nv 0 0 0\nv 40 0 0\nv 0 24 10\nf 1 2 3\n";
const view = {
  schemaVersion: 2,
  name: "ansicht-1",
  projectId: "proj-1",
  projectName: "Projekt Eins",
  templateId: "tpl-b",
  templateName: "Stand B",
  pieceId: null,
  models: [{ name: "Gehaeuse.prt", hash, enabled: true }],
  labelSize: "normal",
  pollSeconds: 60,
  controls: [{ id: "ctl-b1", objectName: "Objekt B", name: "Merkmal B", nominal: 1, usl: 1.1, lsl: 0.9, unit: "mm", color: "#2456b5", selected: true }],
  placements: { "ctl-b1": { color: "#2456b5", flag: { x: 0.08, y: 0.12, pinned: true } } },
  geometries: [],
  camera: null,
};
const live = {
  schemaVersion: 1,
  source: "live",
  stale: true,
  refreshSeconds: 60,
  fetchedAt: "2026-11-27T09:20:00Z",
  part: { id: "proj-1", name: "Projekt Eins", template: { id: "tpl-b", name: "Stand B" } },
  pieces: [{ id: "piece-b", name: "Teil B", timestamp: "2026-11-01T00:00:00Z" }],
  features: [],
  characteristics: [{
    id: "ctl-b1",
    name: "Objekt B / Merkmal B",
    objectName: "Objekt B",
    controlName: "Merkmal B",
    unit: "mm",
    nominal: 1,
    usl: 1.1,
    lsl: 0.9,
    measurements: [{ pieceId: "piece-b", pieceName: "Teil B", value: 1.01, timestamp: "2026-11-01T00:00:00Z" }],
  }],
};

function send(res, code, body, type) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(buf);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/api/version") return send(res, 200, { name: "DL-Merkmal-Viewer", version: "0.8.0" }, "application/json");
  if (url.pathname === "/api/settings") return send(res, 200, { server: "https://example.test", tokenSet: true, pollSeconds: 60 }, "application/json");
  if (url.pathname === "/api/views/ansicht-1") return send(res, 200, view, "application/json");
  if (url.pathname === "/api/live") {
    if (url.searchParams.get("view") !== "ansicht-1") return send(res, 400, { error: "view" }, "application/json");
    return send(res, 200, live, "application/json");
  }
  if (url.pathname === `/api/models/${hash}`) return send(res, 200, obj, "model/obj");
  const file = path.normalize(path.join(root, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    send(res, 404, "missing", "text/plain");
    return;
  }
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
page.setDefaultTimeout(60000);
await page.goto(`http://127.0.0.1:${port}/index.html?view=ansicht-1`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => {
  const stand = document.getElementById("stand-badge");
  return stand && !stand.hidden && stand.textContent.includes("veraltet");
});
const header = await page.evaluate(() => ({
  version: document.getElementById("app-version").textContent.trim(),
  view: document.getElementById("view-badge").textContent,
  part: document.getElementById("part-name").textContent,
  template: document.getElementById("template-badge").textContent,
  stand: document.getElementById("stand-badge").textContent,
  value: document.querySelector(".flag .v")?.textContent || "",
  demo: document.getElementById("demo-note").hidden,
}));
if (header.version !== "0.8.0" || !header.view.includes("ansicht-1") || !header.part.includes("Projekt Eins") || !header.template.includes("Stand B")) {
  throw new Error(`Kopf falsch ${JSON.stringify(header)}`);
}
if (!header.stand.includes("Stand:") || !header.stand.includes("veraltet") || !header.demo) throw new Error(`Stand falsch ${JSON.stringify(header)}`);
if (!header.value.includes("1,01") && !header.value.includes("1.01")) throw new Error(`Istwert fehlt ${header.value}`);
await page.screenshot({ path: shot });
await browser.close();
server.close();
console.log("live-stand ok", JSON.stringify(header));

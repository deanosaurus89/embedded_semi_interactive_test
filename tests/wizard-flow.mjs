import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "/tmp/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const port = 4181;
const shots = process.argv[2] || "/opt/cursor/artifacts";
const fetches = { a: 0, b: 0 };

const HASH_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const OBJ_A = "o a\nv 0 0 0\nv 80 0 0\nv 0 40 30\nf 1 2 3\n";
const OBJ_B = "o b\nv 120 10 0\nv 200 10 0\nv 120 70 40\nf 1 2 3\n";

const controls = Array.from({ length: 12 }, (_, i) => ({
  id: `ctl-${i + 1}`,
  objectName: `Objekt ${i + 1}`,
  name: `Merkmal ${String.fromCharCode(65 + i)}`,
  type: i % 2 ? "Angle" : "Distance",
  nominal: 10 + i,
  tolerances: { low: -0.1, up: 0.2 },
}));

const models = [
  { name: "Gehaeuse.prt", hash: HASH_A, sizeBytes: 5 * 1024 * 1024 },
  { name: "Deckel.prt", hash: HASH_B, sizeBytes: 60 * 1024 * 1024 },
  { name: "Deckel Kopie.prt", hash: HASH_B, sizeBytes: 60 * 1024 * 1024 },
];

function send(res, code, body, type) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(buf);
}

function json(res, obj) {
  send(res, 200, JSON.stringify(obj), "application/json; charset=utf-8");
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const route = url.pathname;
  if (route === "/api/version") return json(res, { name: "DL-Merkmal-Viewer", version: "1.0.0" });
  if (route === "/api/settings" && req.method === "GET") return json(res, { server: "", tokenSet: false, pollSeconds: 60 });
  if (route === "/api/settings" && req.method === "POST") {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      if (String(body.token || "").includes("secret")) return json(res, { server: body.server || "", tokenSet: true, pollSeconds: body.pollSeconds || 60 });
      json(res, { server: body.server || "", tokenSet: false, pollSeconds: Number(body.pollSeconds) || 60 });
    });
    return;
  }
  if (route === "/api/projects") {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const all = [
      { id: "proj-alpha", name: "Projekt Alpha", workspaceName: "Arbeitsbereich Eins" },
      { id: "proj-beta", name: "Projekt Beta", workspaceName: "Arbeitsbereich Zwei" },
    ].filter((item) => !q || item.name.toLowerCase().includes(q));
    return json(res, { total: all.length, skip: 0, top: 20, items: all });
  }
  if (route === "/api/projects/proj-alpha/templates") {
    return json(res, { items: [{ id: "tpl-1", name: "Stand B", pieceCount: 4, samplePieceId: "piece-a" }] });
  }
  if (route === "/api/projects/proj-beta/templates") return json(res, { items: [] });
  if (route === "/api/projects/proj-beta/pieces") {
    return json(res, { items: [{ id: "piece-loose", name: "Teil Ohne Vorlage" }] });
  }
  if (route === "/api/pieces/piece-loose/models" || route === "/api/pieces/piece-a/models") return json(res, { items: models });
  if (route === `/api/models/${HASH_A}`) { fetches.a += 1; return send(res, 200, OBJ_A, "model/obj"); }
  if (route === `/api/models/${HASH_B}`) { fetches.b += 1; return send(res, 200, OBJ_B, "model/obj"); }
  if (route === "/api/controls") {
    const pieceId = url.searchParams.get("pieceId");
    const templateId = url.searchParams.get("templateId");
    if (pieceId === "piece-loose" || templateId === "tpl-1") return json(res, { items: controls });
    return json(res, { items: [] });
  }
  const file = path.normalize(path.join(root, decodeURIComponent(route === "/" ? "/index.html" : route)));
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
page.on("pageerror", (error) => console.error("PAGE", error.message));
page.setDefaultTimeout(60000);
await page.goto(`http://127.0.0.1:${port}/index.html?probe=1`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#wizard:not([hidden])");
const version = await page.$eval("#app-version", (el) => el.textContent.trim());
const noteHidden = await page.$eval("#demo-note", (el) => el.hidden);
if (version !== "1.0.0" || !noteHidden) throw new Error(`Start falsch version=${version} note=${noteHidden}`);
await page.type("#project-q", "Projekt");
await page.click("#project-search");
await page.waitForSelector("#project-results button");
const names = await page.$$eval("#project-results button", (nodes) => nodes.map((node) => node.textContent));
if (!names.some((name) => name.includes("Projekt Alpha")) || !names.some((name) => name.includes("Projekt Beta"))) {
  throw new Error(`Projekte fehlen: ${names.join(" | ")}`);
}
await page.screenshot({ path: path.join(shots, "wizard-projekt.png") });
await page.evaluate(() => [...document.querySelectorAll("#project-results button")].find((node) => node.textContent.includes("Projekt Alpha")).click());
await page.waitForSelector("#template-results button");
const templateText = await page.$eval("#template-results", (el) => el.textContent);
if (!templateText.includes("Stand B") || !templateText.includes("4 Teile")) throw new Error(`Vorlage fehlt: ${templateText}`);
await page.screenshot({ path: path.join(shots, "wizard-vorlage.png") });
await page.click("[data-wizard-step=search]");
await page.evaluate(() => [...document.querySelectorAll("#project-results button")].find((node) => node.textContent.includes("Projekt Beta")).click());
await page.waitForSelector("#piece-results button");
const pieceText = await page.$eval("#piece-results", (el) => el.textContent);
if (!pieceText.includes("Teil Ohne Vorlage")) throw new Error(`Teil fehlt: ${pieceText}`);
await page.screenshot({ path: path.join(shots, "wizard-teil.png") });
await page.click("#piece-results button");
await page.waitForSelector("#model-results .warn");
const modelText = await page.$eval("#model-results", (el) => el.textContent);
if (!modelText.includes("Gehaeuse.prt") || !modelText.includes("Deckel Kopie.prt") || !modelText.includes("gleiche Datei") || !modelText.includes("über 50 MB")) {
  throw new Error(`Modelle falsch: ${modelText}`);
}
await page.screenshot({ path: path.join(shots, "wizard-modelle.png") });
await page.evaluate(() => {
  for (const box of document.querySelectorAll("#model-results input")) box.checked = true;
});
await page.click("#models-next");
await page.waitForSelector("#control-results input");
const blocked = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll("#control-results input")];
  boxes.slice(0, 10).forEach((box) => { box.checked = true; box.dispatchEvent(new Event("change")); });
  boxes[10].checked = true;
  boxes[10].dispatchEvent(new Event("change"));
  return { checked: boxes.filter((box) => box.checked).length, error: document.getElementById("wizard-error").textContent };
});
if (blocked.checked !== 10 || !blocked.error.includes("10")) throw new Error(`Limit greift nicht: ${JSON.stringify(blocked)}`);
await page.click("#small-labels");
await page.evaluate(() => {
  const boxes = [...document.querySelectorAll("#control-results input")];
  boxes[10].checked = true;
  boxes[10].dispatchEvent(new Event("change"));
});
const opened = await page.$eval("#control-cap", (el) => el.textContent);
if (!opened.includes("11 / 20")) throw new Error(`Kleine Beschriftungen: ${opened}`);
await page.screenshot({ path: path.join(shots, "wizard-merkmale.png") });
await page.evaluate(() => {
  const boxes = [...document.querySelectorAll("#control-results input")];
  boxes.forEach((box, index) => { box.checked = index < 2; });
});
await page.click("#controls-apply");
await page.waitForFunction(() => document.querySelectorAll(".flag").length === 2 && document.body.dataset.ready === "true");
if (fetches.a !== 1 || fetches.b !== 1) throw new Error(`Hash nicht eindeutig geladen a=${fetches.a} b=${fetches.b}`);
const ready = await page.evaluate(() => ({
  wizard: document.getElementById("wizard").hidden,
  small: document.body.classList.contains("labels-small"),
  part: document.getElementById("part-name").textContent,
  prepare: document.getElementById("prepare").hidden,
}));
if (!ready.wizard || !ready.small || !ready.part.includes("Projekt Beta") || ready.prepare) {
  throw new Error(`Uebernehmen falsch ${JSON.stringify(ready)}`);
}
await page.click("#prepare");
await page.waitForSelector("#editor:not([hidden])");
await page.screenshot({ path: path.join(shots, "wizard-uebernommen.png") });
await browser.close();
server.close();
console.log("wizard-flow ok");

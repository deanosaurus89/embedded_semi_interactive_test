import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "/tmp/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const port = 4182;
const shot = process.argv[2] || "/opt/cursor/artifacts/anchor-farben.png";

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const file = path.normalize(path.join(root, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end("missing");
    return;
  }
  const ext = path.extname(file);
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".obj": "model/obj" };
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
const browser = await puppeteer.launch({
  executablePath: "/usr/local/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--window-size=1440,900"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.setDefaultTimeout(90000);
await page.goto(`http://127.0.0.1:${port}/index.html?probe=1`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__probe?.ready);
const key = "zyl-a-dm";
const center = await page.evaluate((id) => window.__probe.demoCircle(id), key);
const style = await page.evaluate((id) => window.__probe.style(id), key);
if (!style.frame || style.color.toLowerCase() !== "#2456b5" || style.stroke.toLowerCase() !== "#2456b5") {
  throw new Error(`Farbe fehlt ${JSON.stringify(style)}`);
}
const contour = await page.evaluate((id) => window.__probe.setMode(id, "contour"), key);
const radial = Math.hypot(contour[0] - 280, contour[1] - 70);
if (Math.abs(radial - 36) > 0.2 || Math.abs(contour[2] - 78) > 0.2) throw new Error(`Kontur nicht auf dem Kreis ${contour}`);
const middle = await page.evaluate((id) => window.__probe.setMode(id, "center"), key);
if (Math.hypot(middle[0] - 280, middle[1] - 70, middle[2] - 78) > 0.01) throw new Error(`Mitte falsch ${middle}`);
const nearest = await page.evaluate((id) => window.__probe.setMode(id, "nearest"), key);
const nearestRadial = Math.hypot(nearest[0] - 280, nearest[1] - 70);
if (Math.abs(nearestRadial - 36) > 1.5 && Math.hypot(nearest[0] - 280, nearest[1] - 70, nearest[2] - 78) > 0.2) {
  throw new Error(`Naechster Punkt weder Mitte noch Kontur ${nearest}`);
}
await page.evaluate((id) => window.__probe.setMode(id, "contour"), key);
await page.screenshot({ path: shot });
const warn = await page.evaluate((id) => window.__probe.loose(id), key);
if (!warn.warn.includes("Fußpunkt")) throw new Error(`Warnung fehlt ${JSON.stringify(warn)}`);
if (!center) throw new Error("kein Mittelpunkt");
await browser.close();
server.close();
console.log("anchor-color ok", JSON.stringify({ center, contour, middle, nearest }));

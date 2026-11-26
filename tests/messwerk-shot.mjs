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
page.setDefaultTimeout(90000);
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__probe?.ready);
const locked = await page.evaluate(() => window.__probe.cubeHidden());
if (!locked) throw new Error("Wuerfel ist im gesperrten Zustand sichtbar");
await page.click("#view-lock");
const planes = await page.evaluate(() => window.__probe.demoPlanes());
if (!planes.legacyLoaded) throw new Error(`alte Ebene laedt nicht ${JSON.stringify(planes)}`);
if (!planes.closed || !planes.kinds.includes("polyline")) throw new Error(`Linienzug fehlt ${JSON.stringify(planes)}`);
const open = await page.evaluate(() => window.__probe.cubeHidden());
if (open) throw new Error("Wuerfel bleibt nach dem Entsperren verborgen");
await page.evaluate(() => {
  document.getElementById("flags").style.visibility = "hidden";
  document.getElementById("leaders").style.visibility = "hidden";
});
await new Promise((resolve) => setTimeout(resolve, 400));
await page.screenshot({ path: screenshot });
await browser.close();
console.log("messwerk-shot ok", JSON.stringify(planes));

// Dev helper: open the app, optionally type things into the bar, save a screenshot.
//   node --env-file=.env demo/shot.mjs out.png "first thing to ask" "second thing" ...
import { chromium } from "playwright";

const [out = "shot.png", ...asks] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on("console", (m) => ["error", "warning"].includes(m.type()) && console.log(`[${m.type()}]`, m.text().slice(0, 300)));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(process.env.MAPPITY_URL || `http://localhost:${process.env.PORT || 4321}`, { waitUntil: "networkidle" });
await page.waitForSelector("body.ready", { timeout: 30000 });
await page.waitForTimeout(1500);
for (const text of asks) {
  if (text.startsWith("click:")) await page.click(text.slice(6));
  else {
    await page.fill("#ask", text);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !document.body.classList.contains("busy"), null, { timeout: 90000 });
  }
  await page.waitForTimeout(Number(process.env.SETTLE || 2600));
  if (process.env.EACH) await page.screenshot({ path: out.replace(/\.png$/, `-${asks.indexOf(text) + 1}.png`) });
}
await page.screenshot({ path: out });
console.log("saved", out);
await browser.close();

// Records the demo: drives the real app in headless Chromium, captures full-quality frames through
// the DevTools screencast, and logs when each narration line starts so that assemble.sh can lay the
// audio down at exactly those moments. Nothing on screen is faked; the game's outcome is whatever
// happens, and the narration has a line for either ending.
//
//   npm run demo:narrate && npm run demo:record && npm run demo:assemble
// The first take in a new area is a rehearsal: it warms the OpenStreetMap cache (a cold Overpass
// fetch can take half a minute). Record again for the real one.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const OUT = new URL("./out/", import.meta.url).pathname;
const FRAMES = `${OUT}frames/`;
const TEMPO = 1.12; // assemble.mjs speeds the narration up by the same factor
const VIEW = { width: 1920, height: 1080 };
// The screencast ignores deviceScaleFactor, so the page is recorded at its native 1080p and the
// interface (not the map) is enlarged instead, to stay readable once the video is scaled down.
const UI_ZOOM = 1.2;
const durations = JSON.parse(readFileSync(`${OUT}audio/durations.json`));

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await page.goto(process.env.MAPPITY_URL || `http://localhost:${process.env.PORT || 4321}`, { waitUntil: "networkidle" });
await page.waitForSelector("body.ready");
await page.evaluate(() => document.fonts.ready);

// A cursor (headless Chromium draws none) and the closing card. Recorder-only; the app has neither.
await page.addStyleTag({
  content: `
  .brand, .panel, #console, .maplibregl-popup-content { zoom: ${UI_ZOOM}; }
  /* MapLibre places markers and popups with pixel transforms, which zoom would scale: enlarge their insides instead. */
  .area-label { font-size: 14.5px; padding: 4px 12px; }
  #demo-cursor { position: fixed; z-index: 99; left: 0; top: 0; width: 22px; height: 22px; margin: -3px 0 0 -3px; pointer-events: none;
    transition: transform 0.12s ease-out; filter: drop-shadow(0 2px 4px rgba(0,0,0,.6)); }
  #demo-cursor.down { transform: scale(0.82); }
  #demo-end { position: fixed; inset: 0; z-index: 90; display: grid; place-content: center; gap: 18px; text-align: center;
    background: rgba(8, 10, 14, 0.78); backdrop-filter: blur(14px); opacity: 0; transition: opacity 1.4s ease; pointer-events: none; }
  #demo-end.show { opacity: 1; }
  #demo-end h1 { margin: 0; font: italic 400 120px/1 "Libre Caslon Text", serif; color: #f4efe6; letter-spacing: -0.01em; }
  #demo-end p { margin: 0; font: 400 24px/1.4 "Fira Sans", sans-serif; color: #bdb7ab; }
  #demo-end p b { color: #ffb547; font-weight: 500; }`,
});
await page.evaluate(() => {
  const cursor = document.createElement("div");
  cursor.id = "demo-cursor";
  cursor.innerHTML = `<svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2l15 8.2-6.6 1.7L8.6 19z" fill="#fff" stroke="#0b0d11" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  document.body.append(cursor);
  addEventListener("mousemove", (e) => { cursor.style.left = e.clientX + "px"; cursor.style.top = e.clientY + "px"; }, true);
  addEventListener("mousedown", () => cursor.classList.add("down"), true);
  addEventListener("mouseup", () => cursor.classList.remove("down"), true);
  const end = document.createElement("div");
  end.id = "demo-end";
  end.innerHTML = `<h1>mappity</h1><p>Ask the map anything. <b>Every place answers.</b></p><p>OpenStreetMap · Mapillary · TypeSafe Jev · Cactus Needle</p>`;
  document.body.append(end);
});
await page.evaluate((zoom) => {
    const { map } = window.mappity;
    map.setPadding({ top: 100, bottom: 215 * zoom, left: 365 * zoom, right: 400 * zoom }); // the panels grew with the zoom
    map.setLayoutProperty("places-label", "text-size", ["interpolate", ["linear"], ["get", "p"], 0.35, 11.5 * zoom, 1, 14.5 * zoom]);
  }, UI_ZOOM);
await page.mouse.move(VIEW.width * 0.62, VIEW.height * 0.45);
await page.waitForTimeout(1500); // tiles

// ---- capture -----------------------------------------------------------------------------------
const cdp = await context.newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  const name = `f-${String(frames.length).padStart(6, "0")}.jpg`;
  frames.push({ name, at: metadata.timestamp });
  writeFileSync(FRAMES + name, Buffer.from(data, "base64"));
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
const started = Date.now() / 1000;

// ---- choreography ------------------------------------------------------------------------------
const cues = [];
const pause = (s) => page.waitForTimeout(s * 1000);
const say = async (id) => {
  cues.push({ id, at: Date.now() / 1000 - started });
  console.log(`${(Date.now() / 1000 - started).toFixed(1).padStart(6)}s  ${id}`);
  await pause(durations[id] / TEMPO + 0.25);
};
const after = (s, work) => pause(s).then(work);
const glide = async (x, y) => page.mouse.move(x, y, { steps: 28 });
const centre = async (selector) => {
  const box = await page.locator(selector).first().boundingBox();
  return [box.x + box.width / 2, box.y + box.height / 2];
};
const type = async (text) => {
  const [x, y] = await centre("#ask");
  await glide(x - 120, y);
  await page.mouse.click(x - 120, y);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(text, { delay: 34 });
};
const submit = async () => {
  await page.keyboard.press("Enter");
  await pause(0.15);
  await page.waitForFunction(() => !document.body.classList.contains("busy"), null, { timeout: 90000 });
};

await pause(1.4);
await say("hello");
await say("taxes");

// 1. A wish. Needle gets it wrong, Jev overrules it, the chocolate shops light up.
await Promise.all([say("sugar"), after(0.5, () => type("my kid is melting down and needs sugar immediately"))]);
await submit();
await pause(1.1);
await say("answered");
await say("family");
await Promise.all([
  say("overruled"),
  (async () => {
    await glide(...(await centre("#trace .step:nth-child(1) .what")));
    await pause(3.2);
    await glide(...(await centre("#trace .step:nth-child(3) .what")));
  })(),
]);
await say("homework");

// 2. A landmark and a walking time: Needle's half of the job.
await Promise.all([say("aquarium"), after(0.3, () => type("cozy coffee within 5 minutes walk of the aquarium"))]);
await submit();
await pause(1.9);
await Promise.all([
  say("division"),
  (async () => {
    await glide(...(await centre("#trace .step:nth-child(1) .what")));
    await pause(2.6);
    await glide(...(await centre(".result button")));
    await pause(1.6);
    await page.mouse.click(...(await centre(".result button")));
  })(),
]);
await pause(0.8);

// A plain map command on the way: Needle's zoom(), no narration needed.
await type("zoom out a bit");
await submit();
await pause(1.2);

// 3. The street matters: Mapillary joins in, and each place is judged twice.
await Promise.all([say("night"), after(0.3, () => type("somewhere I'd feel fine walking to alone at 11pm"))]);
await submit();
await pause(1.3);
await Promise.all([
  say("street"),
  (async () => {
    await pause(2.5);
    await glide(...(await centre("#trace .step:nth-child(5) .what")));
    await pause(3.5);
    await glide(...(await centre(".result .factors")));
  })(),
]);
await Promise.all([say("lampposts"), glide(VIEW.width * 0.56, VIEW.height * 0.38)]);

// 4. The game.
await say("frivolous");
await Promise.all([say("game"), after(0.2, () => type("let's play a guessing game"))]);
await submit();
await page.waitForSelector("#game:not([hidden])");
await pause(2.4);
await Promise.all([say("eat"), type("Can I eat there?")]);
await submit();
await pause(1.6);
await Promise.all([say("odds"), after(durations.odds / TEMPO - 2.2, () => type("Does it serve alcohol?"))]);
await submit();
await pause(1.8);

// Archibald guesses the likeliest place. Whatever happens, happens.
const guess = await page.evaluate(() => {
  const best = [...window.mappity.places.values()].sort((a, b) => b.target - a.target)[0];
  const point = window.mappity.map.project([best.lng, best.lat]);
  return { name: best.name, x: point.x, y: point.y };
});
await Promise.all([say("bayes"), after(1.5, () => glide(guess.x, guess.y))]);
await page.mouse.click(guess.x, guess.y);
await page.waitForSelector(".card .primary", { timeout: 5000 });
await pause(0.9);
const button = await centre(".card .primary");
await glide(...button);
await pause(0.3);
await page.mouse.click(...button);
await pause(0.5);
const verdict = await page.locator("#verdict").textContent();
const won = verdict.startsWith("Yes!");
console.log(`guessed "${guess.name}": ${won ? "right" : "wrong"} ("${verdict}")`);
await pause(0.7);
await say(won ? "right" : "wrong");

// Closing card.
await page.evaluate(() => document.getElementById("demo-end").classList.add("show"));
await pause(0.9);
await say("credits");
await say("tea");
await pause(1.2);

// ---- wrap up -----------------------------------------------------------------------------------
await cdp.send("Page.stopScreencast");
const ended = Date.now() / 1000;
await browser.close();

const first = frames[0].at;
const concat = ["ffconcat version 1.0"];
frames.forEach((frame, i) => {
  const next = i + 1 < frames.length ? frames[i + 1].at : ended;
  concat.push(`file 'frames/${frame.name}'`, `duration ${Math.max(0.001, next - frame.at).toFixed(4)}`);
});
concat.push(`file 'frames/${frames.at(-1).name}'`); // the concat demuxer ignores the last duration without this
writeFileSync(`${OUT}frames.ffconcat`, concat.join("\n") + "\n");
// Cue times were taken against `started`; the video starts at the first captured frame.
writeFileSync(`${OUT}cues.json`, JSON.stringify({ tempo: TEMPO, length: ended - first, cues: cues.map((c) => ({ ...c, at: c.at - (first - started) })) }, null, 2));
console.log(`${frames.length} frames over ${(ended - first).toFixed(1)}s (${(frames.length / (ended - first)).toFixed(1)} fps average)`);

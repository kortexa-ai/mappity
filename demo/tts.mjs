// Narration: a text-to-speech server speaks each line, then a speech-to-text server transcribes it
// back, so that a garbled or cut-off take is caught without anyone having to listen. Writes
// demo/out/audio/*.wav and durations.json.
//   npm run demo:narrate -- [id ...]   (no ids: every line that has no clip yet)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Both are OpenAI-compatible: POST /v1/audio/speech and POST /v1/audio/transcriptions. See .env.example.
const TTS = process.env.TTS_URL;
const ASR = process.env.ASR_URL;
const TTS_MODEL = process.env.TTS_MODEL || "qwen3-tts-customvoice-1.7b";
if (!TTS || !ASR) {
  console.error("Set TTS_URL and ASR_URL in .env (see .env.example), then run: npm run demo:narrate");
  process.exit(1);
}
const OUT = new URL("./out/audio/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const lines = JSON.parse(readFileSync(new URL("./narration.json", import.meta.url)));
const only = process.argv.slice(2);
const words = (s) => s.toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean);

// Share of the script's words that the transcript also contains. Names ("mappity", "Jev") never
// survive ASR, so this is a smoke alarm for broken takes, not a spelling test.
function overlap(script, heard) {
  const bag = new Map();
  for (const w of words(heard)) bag.set(w, (bag.get(w) || 0) + 1);
  const wanted = words(script);
  let hit = 0;
  for (const w of wanted) if (bag.get(w) > 0) (hit++, bag.set(w, bag.get(w) - 1));
  return hit / wanted.length;
}

async function speak(line) {
  const res = await fetch(`${TTS}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, voice: line.voice, input: line.text, response_format: "wav" }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`tts ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

async function transcribe(wav) {
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), "clip.wav");
  form.append("model", "default");
  const res = await fetch(`${ASR}/v1/audio/transcriptions`, { method: "POST", body: form, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`asr ${res.status}`);
  return (await res.json()).text;
}

const seconds = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());

for (const line of lines) {
  const file = `${OUT}${line.id}.wav`;
  if (only.length ? !only.includes(line.id) : existsSync(file)) continue;
  let best = null;
  for (let take = 1; take <= 4; take++) {
    const wav = await speak(line);
    const heard = await transcribe(wav);
    const score = overlap(line.text, heard);
    if (!best || score > best.score) best = { wav, heard, score };
    if (score >= 0.85) break;
    console.log(`  ${line.id}: take ${take} scored ${score.toFixed(2)} ("${heard}"), trying again`);
  }
  writeFileSync(file, best.wav);
  console.log(`${best.score >= 0.85 ? "ok  " : "WEAK"} ${line.id.padEnd(10)} ${seconds(file).toFixed(1)}s  ${best.score.toFixed(2)}  "${best.heard}"`);
}

const durations = Object.fromEntries(lines.filter((l) => existsSync(`${OUT}${l.id}.wav`)).map((l) => [l.id, seconds(`${OUT}${l.id}.wav`)]));
writeFileSync(`${OUT}durations.json`, JSON.stringify(durations, null, 2));
console.log(`total narration: ${Object.values(durations).reduce((a, b) => a + b, 0).toFixed(1)}s in ${Object.keys(durations).length} clips`);

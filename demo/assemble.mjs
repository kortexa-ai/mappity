// Assembles the demo: timestamped frames become 30 fps video, and each narration clip is laid down at
// the moment the recorder logged for it.   node demo/assemble.mjs [output.mp4]
// MUSIC=/path/to/instrumental.mp3 adds a quiet bed that ducks under the voices.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const OUT = new URL("./out/", import.meta.url).pathname;
const target = process.argv[2] || `${homedir()}/Desktop/mappity-demo.mp4`;
const { tempo, length, cues } = JSON.parse(readFileSync(`${OUT}cues.json`));

function levels(file) {
  // ffmpeg reports on stderr, which execFileSync does not return
  const log = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"]).stderr.toString();
  return { mean: Number(log.match(/mean_volume: (-?[\d.]+) dB/)[1]), peak: Number(log.match(/max_volume: (-?[\d.]+) dB/)[1]) };
}

// Two voices, recorded at different levels: bring each clip to the same mean loudness, without clipping.
function gainFor(file) {
  const { mean, peak } = levels(file);
  return Math.min(-19 - mean, -1.5 - peak);
}

const inputs = ["-f", "concat", "-safe", "0", "-i", `${OUT}frames.ffconcat`];
const filters = [
  `[0:v]fps=30,scale=1920:1080:flags=lanczos,format=yuv420p,fade=t=in:st=0:d=0.7,fade=t=out:st=${(length - 0.9).toFixed(2)}:d=0.9[v]`,
];
cues.forEach((cue, i) => {
  const file = `${OUT}audio/${cue.id}.wav`;
  inputs.push("-i", file);
  const delay = Math.max(0, Math.round(cue.at * 1000));
  filters.push(`[${i + 1}:a]atempo=${tempo},volume=${gainFor(file).toFixed(2)}dB,aresample=48000,adelay=${delay}:all=1[a${i}]`);
});
const voices = `${cues.map((_, i) => `[a${i}]`).join("")}amix=inputs=${cues.length}:normalize=0:dropout_transition=0,apad`;
const MASTER = "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000"; // web playback loudness
const music = process.env.MUSIC;
if (music) {
  // The bed sits 11 dB under the voices and drops further whenever someone speaks.
  inputs.push("-i", music);
  const bed = -30 - levels(music).mean;
  filters.push(`${voices},asplit[voice][key]`);
  filters.push(`[${cues.length + 1}:a]aresample=48000,volume=${bed.toFixed(2)}dB,afade=t=in:st=0:d=2[bed]`);
  filters.push(`[bed][key]sidechaincompress=threshold=0.015:ratio=5:attack=120:release=700[ducked]`);
  filters.push(`[voice][ducked]amix=inputs=2:normalize=0:dropout_transition=0,${MASTER},afade=t=out:st=${(length - 1.6).toFixed(2)}:d=1.6[a]`);
} else {
  filters.push(`${voices},${MASTER},afade=t=out:st=${(length - 0.9).toFixed(2)}:d=0.9[a]`);
}

execFileSync(
  "ffmpeg",
  ["-hide_banner", "-loglevel", "warning", "-y", ...inputs, "-filter_complex", filters.join(";"), "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-movflags", "+faststart", "-t", length.toFixed(2), target],
  { stdio: "inherit" },
);
console.log("wrote", target);

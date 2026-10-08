import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const exec = promisify(execFile);

async function launch(t, shell, dotenv, overrides = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "mappity-startup-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, "bin"));
  await mkdir(join(cwd, "node_modules"));
  await copyFile(new URL("../run.sh", import.meta.url), join(cwd, "run.sh"));
  await writeFile(join(cwd, ".env"), dotenv);
  await symlink(process.execPath, join(cwd, "bin/node"));
  for (const [name, script] of Object.entries({
    lsof: 'exit 1',
    curl: 'printf "curl %s\\n" "$*" >> "$LAUNCH_LOG"',
    npm: 'printf "npm %s\\n" "$*" >> "$LAUNCH_LOG"',
  })) await writeFile(join(cwd, "bin", name), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  await exec(shell, ["-f", "run.sh"], {
    cwd, timeout: 10000,
    env: { PATH: `${cwd}/bin:/usr/bin:/bin`, ZDOTDIR: cwd, LAUNCH_LOG: join(cwd, "calls"), ...overrides },
  });
  assert.equal(await readFile(join(cwd, ".env"), "utf8"), dotenv);
  return readFile(join(cwd, "calls"), "utf8");
}

for (const shell of ["bash", "zsh"]) {
  test(`${shell}: old .env starts with default Jev and absent optional settings`, async (t) => {
    try { await exec(shell, ["--version"]); } catch (error) {
      if (error.code === "ENOENT") return t.skip(`${shell} is not installed`);
      throw error;
    }
    const calls = await launch(t, shell, "TYPESAFE_API_KEY=test-key\nMAPILLARY_ACCESS_TOKEN=test-token\n");
    assert.match(calls, /curl .*http:\/\/localhost:4007\/health/);
    assert.doesNotMatch(calls, /\/v1\/models/);
    assert.match(calls, /npm start/);
  });
}

test("Jev needs no Shingi settings, and shell overrides win over dotenv", async (t) => {
  const calls = await launch(t, "bash", "JEV_PROVIDER=shingi\nNEEDLE_URL='http://dotenv.invalid'\n", {
    JEV_PROVIDER: "jev", NEEDLE_URL: "http://override.invalid",
  });
  assert.match(calls, /http:\/\/override.invalid\/health/);
  assert.doesNotMatch(calls, /dotenv|\/v1\/models/);
  assert.match(calls, /npm start/);
});

test("dotenv quotes/comments and a trailing Shingi slash match Node startup", async (t) => {
  const calls = await launch(t, "bash", 'JEV_PROVIDER="shingi" # local judge\nSHINGI_URL="http://judge.invalid/"\n');
  assert.match(calls, /http:\/\/judge.invalid\/v1\/models/);
  assert.match(calls, /npm start/);
});

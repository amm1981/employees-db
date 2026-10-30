import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { root, loadIntegrations } from "../agent/src/config.js";
import { Spool, extract } from "../agent/src/spool.js";
import { fixtureSource } from "../agent/src/fixture.js";
const repo = root(),
  php = process.env.PHP_BIN ?? "php";
// Refuse arbitrary database targets; never read deployment DB credentials.
const password = randomBytes(32).toString("hex"),
  ingest = randomBytes(32).toString("hex");
const env = {
  ...process.env,
  TEST_USE_MYSQL: "1",
  APP_ENV: "testing",
  APP_KEY: "base64:" + randomBytes(32).toString("base64"),
  APP_DEBUG: "false",
  SYNC_ALLOW_FIXTURES: "true",
  DB_CONNECTION: "mysql",
  DB_HOST: "127.0.0.1",
  DB_PORT: "33079",
  DB_DATABASE: "get_employes_test",
  DB_USERNAME: "get_employes_test",
  DB_PASSWORD: password,
  DB_URL: "",
  TEST_DB_PASSWORD: password,
  TEST_MYSQL_PORT: "33079",
  TEST_INGEST_TOKEN: ingest,
  CACHE_STORE: "array",
  SESSION_DRIVER: "array",
};
execFileSync(php, ["tests/mysql-bootstrap.php"], {
  cwd: repo,
  env,
  stdio: "inherit",
  windowsHide: true,
});
await mkdir(path.join(repo, ".local"), { recursive: true });
const dir = await mkdtemp(path.join(repo, ".local/mysql-check-"));
const tokens = {
  ingestToken: ingest,
  readToken: randomBytes(32).toString("hex"),
  opsToken: randomBytes(32).toString("hex"),
};
const file = path.join(dir, "tokens.json");
await writeFile(file, JSON.stringify(tokens), { mode: 0o600 });
execFileSync(php, ["artisan", "migrate", "--force"], {
  cwd: path.join(repo, "backend"),
  env,
  stdio: "inherit",
  windowsHide: true,
});
execFileSync(php, ["artisan", "fixtures:setup", "--secrets-file=" + file], {
  cwd: path.join(repo, "backend"),
  env,
  stdio: "inherit",
  windowsHide: true,
});
// Run the entire backend suite against actual InnoDB, not SQLite emulation.
execFileSync(
  php,
  ["vendor/phpunit/phpunit/phpunit", "--exclude-group", "none"],
  { cwd: path.join(repo, "backend"), env, stdio: "inherit", windowsHide: true },
);
// RefreshDatabase rolls back fixtures; re-install the current token after PHPUnit.
execFileSync(php, ["artisan", "fixtures:setup", "--secrets-file=" + file], {
  cwd: path.join(repo, "backend"),
  env,
  stdio: "pipe",
  windowsHide: true,
});
const spool = new Spool(path.join(dir, "spool"), randomBytes(32)),
  c = (await loadIntegrations())[0]!;
const m = await extract(spool, c, fixtureSource(), "fixture-agent", true),
  prefix = `/api/v1/sync/runs/${m.runId}`;
function request(
  method: string,
  url: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const p = spawn(php, ["tests/http-worker.php"], {
      cwd: repo,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    p.stdout.on("data", (b) => (out += b));
    p.stderr.on("data", (b) => (err += b));
    p.on("error", reject);
    p.on("exit", (code) => {
      if (code) reject(new Error(err.slice(-1000)));
      else {
        try {
          resolve(JSON.parse(out));
        } catch {
          reject(new Error("Worker output invalid"));
        }
      }
    });
    p.stdin.end(JSON.stringify({ method, path: url, body }));
  });
}
assert.equal((await request("POST", "/api/v1/sync/runs", m)).status, 201);
const b = m.batches[0]!,
  body = {
    hash: b.hash,
    first: b.first,
    count: b.count,
    rows: JSON.parse(await spool.get(m.runId, "batch-0.enc")),
  };
const duplicate = await Promise.all([
  request("PUT", prefix + "/batches/0", body),
  request("PUT", prefix + "/batches/0", body),
]);
duplicate.forEach((r) => assert.equal(r.status, 200, JSON.stringify(r)));
assert.equal((await request("POST", prefix + "/finalize", {})).status, 200);
const publications = await Promise.all([
  request("POST", prefix + "/publish", {}),
  request("POST", prefix + "/publish", {}),
]);
publications.forEach((r) => assert.equal(r.status, 200, JSON.stringify(r)));
assert.equal(
  publications[0]!.body.publicationId,
  publications[1]!.body.publicationId,
);
console.log(
  "PASS: InnoDB migrations, full backend suite, simultaneous batch replay and simultaneous publication (separate PHP processes).",
);

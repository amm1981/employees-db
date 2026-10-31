import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { root, loadIntegrations } from "../agent/src/config.js";
import { Spool, extract } from "../agent/src/spool.js";
import { fixtureRows, fixtureSource } from "../agent/src/fixture.js";
import { Transport } from "../agent/src/transport.js";
import { decodeExactRows } from "../agent/src/dotnet-source.js";

const repo = root(),
  php = process.env.PHP_BIN ?? "php";
await mkdir(path.join(repo, ".local"), { recursive: true });
const dir = await mkdtemp(path.join(repo, ".local/e2e-"));
const tokens = {
  ingestToken: randomBytes(32).toString("hex"),
  readToken: randomBytes(32).toString("hex"),
  opsToken: randomBytes(32).toString("hex"),
};
await writeFile(path.join(dir, "tokens.json"), JSON.stringify(tokens), {
  mode: 0o600,
});
if (process.platform === "win32") {
  const user = execFileSync("whoami", [], { encoding: "utf8" }).trim();
  execFileSync(
    "icacls",
    [dir, "/inheritance:r", "/grant:r", `${user}:(OI)(CI)F`],
    { stdio: "ignore" },
  );
}
await writeFile(path.join(dir, "database.sqlite"), "");
const env = {
  ...process.env,
  APP_ENV: "testing",
  APP_DEBUG: "false",
  APP_KEY: "base64:" + randomBytes(32).toString("base64"),
  DB_CONNECTION: "sqlite",
  DB_DATABASE: path.join(dir, "database.sqlite"),
  DB_URL: "",
  CACHE_STORE: "array",
  SESSION_DRIVER: "array",
  LOG_CHANNEL: "single",
  SYNC_ALLOW_FIXTURES: "true",
  SQL_SOURCE_TIMEZONE: "UTC",
  API_CONSUMER_PASSWORD: randomBytes(32).toString("hex"),
  SERVICE_TOKEN_NEW: randomBytes(32).toString("hex"),
};
const run = (args: string[]) =>
  execFileSync(php, args, {
    cwd: path.join(repo, "backend"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
run(["artisan", "migrate", "--force", "--no-interaction"]);
run([
  "artisan",
  "fixtures:setup",
  "--secrets-file=" + path.join(dir, "tokens.json"),
]);
run([
  "artisan",
  "consumer:create",
  "e2e.reader",
  "--dataset=casablanca-altas-bajas",
  "--simulation",
  "--no-interaction",
]);
const port = await new Promise<number>((resolve) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => {
    const p = (server.address() as net.AddressInfo).port;
    server.close(() => resolve(p));
  });
});
const baseUrl = `http://127.0.0.1:${port}`;
const server: ChildProcess = spawn(
  php,
  [
    "-d",
    "display_errors=0",
    "-S",
    `127.0.0.1:${port}`,
    path.join(
      repo,
      "backend/vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php",
    ),
  ],
  {
    cwd: path.join(repo, "backend/public"),
    env,
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  },
);
let stderr = "";
server.stderr?.on("data", (b) => {
  stderr += String(b);
});
const spool = new Spool(path.join(dir, "spool"), randomBytes(32));
const options = {
  baseUrl,
  token: tokens.ingestToken,
  attempts: 1,
  baseDelayMs: 1,
  timeoutMs: 10000,
  simulation: true,
};
const t = new Transport(options);
async function read(
  url: string,
  token = tokens.readToken,
  method = "GET",
  body?: unknown,
) {
  const response = await fetch(baseUrl + "/api/v1" + url, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await response.json()) as any;
  assert.equal(response.status, 200, JSON.stringify(json));
  return json;
}
try {
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try {
      if ((await fetch(baseUrl + "/up")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(100);
  }
  assert(ready, "Local PHP server unavailable");
  const all = await loadIntegrations(),
    c = all[0]!;
  c.limits.batchRows = 1;
  const m = await extract(spool, c, fixtureSource(), "fixture-agent", true);
  // Deliberately lose the response after the first accepted batch, simulating Internet failure.
  let dropped = false;
  const interrupted = new Transport({
    ...options,
    fetcher: async (input, init) => {
      const res = await fetch(input, init);
      if (init?.method === "PUT" && !dropped) {
        dropped = true;
        await res.arrayBuffer();
        throw new Error("simulated disconnect");
      }
      return res;
    },
  });
  await assert.rejects(
    interrupted.send(spool, m.runId, c, true),
    /NETWORK_UNAVAILABLE/,
  );
  let received = await t.request(
    "GET",
    `/sync/runs/${m.runId}/batches`,
    undefined,
    { "X-Agent-Origin": "fixture-agent" },
  );
  assert.equal(received.batches.length, 1);
  const before = await spool.manifest(m.runId);
  await t.send(spool, m.runId, c, true);
  assert.deepEqual(before, await spool.manifest(m.runId));
  let data = await read(`/datasets/${c.id}/records`);
  assert.deepEqual(
    data.records.map((r: any) => r.values),
    fixtureRows(),
  );
  assert.equal(data.exhaustive, false);
  const firstPublication = data.publicationId;
  received = await t.request(
    "GET",
    `/sync/runs/${m.runId}/batches`,
    undefined,
    { "X-Agent-Origin": "fixture-agent" },
  );
  assert.equal(received.batches.length, 3);
  const next = await extract(
    spool,
    c,
    fixtureSource(false, [fixtureRows()[2]!]),
    "fixture-agent",
    true,
  );
  await t.send(spool, next.runId, c, true);
  data = await read(`/datasets/${c.id}/records`);
  assert.equal(data.total, 1);
  const secondPublication = data.publicationId;
  await read(`/datasets/${c.id}/rollback`, tokens.opsToken, "POST", {
    publicationId: firstPublication,
    expectedActivePublicationId: secondPublication,
  });
  data = await read(`/datasets/${c.id}/records`);
  assert.equal(data.total, 3);
  assert.equal(data.publicationId, firstPublication);
  const diamond = all[1]!,
    dm = await extract(
      spool,
      diamond,
      fixtureSource(true),
      "fixture-agent",
      true,
    );
  await t.send(spool, dm.runId, diamond, true);
  const d = await read(`/datasets/${diamond.id}/records`);
  assert.equal(d.records[0].values[0], null);
  assert.equal(d.total, 3);
  const unauthorized = await fetch(baseUrl + "/api/v1/datasets");
  assert.equal(unauthorized.status, 401);
  const cliEnv = {
    ...env,
    API_BASE_URL: baseUrl,
    API_INGEST_TOKEN: tokens.ingestToken,
    AGENT_ORIGIN: "fixture-agent",
    SPOOL_KEY: randomBytes(32).toString("base64"),
    SPOOL_DIR: path.join(dir, "cli-spool"),
  };
  const cli = (args: string[]) =>
    execFileSync(
      process.execPath,
      [path.join(repo, "agent/dist/cli.js"), ...args],
      { cwd: repo, env: cliEnv, encoding: "utf8", windowsHide: true },
    );
  const cliLogs = cli([
    "sync",
    "--integration",
    c.id,
    "--simulate",
    "--send",
    "--publish",
  ])
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  const cliRun = cliLogs.find((l) => l.msg === "spool_sealed")?.runId;
  assert(cliRun);
  assert(cliLogs.some((l) => l.msg === "transfer_complete"));
  assert(
    cli(["resume", "--run", cliRun, "--publish"]).includes("transfer_complete"),
  );
  assert(cli(["status"]).includes(cliRun));
  assert(
    cli(["recover", "--integration", c.id, "--simulate", "--publish"]).includes(
      "recovery_complete",
    ),
  );
  // Exercise the actual JSON login and consumer window through the HTTP server.
  const recentRows = fixtureRows();
  const recent = new Date(Date.now() - 24 * 3600_000)
    .toISOString()
    .replace(/Z$/, "");
  recentRows[0]![36] = recent;
  recentRows[1]![36] = recent;
  recentRows[2]![36] = new Date(Date.now() - 96 * 3600_000)
    .toISOString()
    .replace(/Z$/, "");
  const consumerRun = await extract(
    spool,
    c,
    fixtureSource(false, recentRows),
    "fixture-agent",
    true,
  );
  await t.send(spool, consumerRun.runId, c, true);
  const login = await read("/auth/login", "", "POST", {
    username: "e2e.reader",
    password: env.API_CONSUMER_PASSWORD,
  });
  assert.equal(login.token_type, "Bearer");
  assert.equal(login.expires_in, 3600);
  const employees = await read(
    `/employees?dataset=${c.id}`,
    login.access_token,
  );
  assert.equal(employees.total, 2);
  assert.equal(employees.window.hours, 72);
  assert.deepEqual(employees.records[0].values, employees.records[1].values);
  assert.equal(employees.records[0].values.cod_trabajador, "00001234");
  assert.equal(Object.keys(employees.records[0].values).length, 37);
  const logout = await fetch(baseUrl + "/api/v1/auth/logout", {
    method: "POST",
    headers: { Authorization: "Bearer " + login.access_token },
  });
  assert.equal(logout.status, 204);
  const expired = await fetch(baseUrl + `/api/v1/employees?dataset=${c.id}`, {
    headers: { Authorization: "Bearer " + login.access_token },
  });
  assert.equal(expired.status, 401);
  if (process.platform === "win32") {
    // Fully synthetic rows, formatted by the same .NET exact conversion layer.
    const reviewed = JSON.parse(
      await readFile(
        path.join(repo, "contracts/schemas/casablanca.reviewed-v1.json"),
        "utf8",
      ),
    );
    const wire = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "RemoteSigned",
        "-File",
        path.join(repo, "scripts/windows/Test-SqlExact.ps1"),
        "-EmitFixture",
      ],
      { windowsHide: true },
    );
    const exactRows = [];
    for await (const row of decodeExactRows(
      (async function* () {
        yield wire;
      })(),
      reviewed.schema,
      100000,
    ))
      exactRows.push(row);
    run(["artisan", "integration:activate", c.id]);
    run([
      "artisan",
      "service-token:issue",
      c.id,
      "ti-pc-01",
      "--scope=ingest",
      "--scope=publish",
    ]);
    run([
      "artisan",
      "consumer:create",
      "e2e.production",
      "--dataset=" + c.id,
      "--no-interaction",
    ]);
    const production = { ...c, publicationEnabled: true };
    const capture = await extract(
      spool,
      production,
      {
        schema: reviewed.schema,
        rows: (async function* () {
          yield* exactRows;
        })(),
      },
      "ti-pc-01",
      false,
    );
    const sender = new Transport({
      ...options,
      baseUrl: "https://receiver.example.invalid",
      simulation: false,
      token: env.SERVICE_TOKEN_NEW,
      fetcher: (input, init) => {
        const url = new URL(String(input));
        assert.equal(url.hostname, "receiver.example.invalid");
        return fetch(baseUrl + url.pathname + url.search, init);
      },
    });
    await sender.send(spool, capture.runId, production, true);
    const session = await read("/auth/login", "", "POST", {
      username: "e2e.production",
      password: env.API_CONSUMER_PASSWORD,
    });
    const result = await read(
      `/employees?dataset=${c.id}`,
      session.access_token,
    );
    assert.equal(result.total, 2);
    assert.equal(result.records[0].values.id_planilla, "999999999999999999");
    assert.equal(result.records[0].values.Nombres, "Ficticio ñá €");
    assert.equal(result.records[0].values.cod_trabajador, "00001234");
    assert.deepEqual(result.records[0].values, result.records[1].values);
  }
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        php: run(["-r", "echo PHP_VERSION;"]).toString(),
        checks: [
          "agent → Laravel HTTP → SQLite → read API",
          "cross-language SHA-256 and canonical Unicode",
          "lost acknowledgement and resume without SQL",
          "exact decimals, dates, zeros, null, empty strings, duplicate rows",
          "atomic publication and explicit rollback",
          "Diamond company null and dataset isolation",
          "anonymous access denied",
          "compiled CLI sync, resume, status and recovery",
          "JSON login → consumer Bearer token → last 72 hours → logout revocation",
          ...(process.platform === "win32"
            ? [
                ".NET exact formatter → CASABLANCA v1 production contract → HTTP → authenticated employee API (synthetic rows)",
              ]
            : []),
        ],
        runs: [m.runId, next.runId, dm.runId],
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error("E2E FAILED", e instanceof Error ? e.message : "unknown");
  console.error(stderr.slice(-1500));
  process.exitCode = 1;
} finally {
  server.kill();
  await new Promise<void>((resolve) => {
    if (server.exitCode !== null) resolve();
    else server.once("exit", () => resolve());
  });
}

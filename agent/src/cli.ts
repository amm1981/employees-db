import { config as envConfig } from "dotenv";
import { parseArgs } from "node:util";
import path from "node:path";
import { readFile } from "node:fs/promises";
import pino from "pino";
import {
  approvedSchema,
  loadIntegrations,
  root,
  requireLive,
  type Integration,
} from "./config.js";
import { Spool, extract, withLock, unlock } from "./spool.js";
import { fixtureSource } from "./fixture.js";
import { Transport } from "./transport.js";
import { SqlExecutor } from "./sql.js";
import { saveInspection } from "./inspection.js";
import { readMetadataExport, ssmsMetadataMethod } from "./metadata.js";
import { scheduleReadiness } from "./schedule.js";
envConfig({ path: path.join(root(), ".env"), quiet: true });
const log = pino({
  base: null,
  redact: ["token", "password", "rows", "payload"],
});
const operationStarted = Date.now();
let correlationRunId: string | undefined;
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    integration: { type: "string" },
    run: { type: "string" },
    simulate: { type: "boolean" },
    send: { type: "boolean" },
    publish: { type: "boolean" },
    "allow-sql": { type: "boolean" },
    "from-file": { type: "string" },
  },
});
async function main(): Promise<void> {
  const command = positionals[0] ?? "validate",
    integrations = await loadIntegrations();
  if (command === "validate") {
    await new SqlExecutor().profiles();
    for (const c of integrations) {
      const m = JSON.parse(
        await readFile(path.resolve(root(), c.schema), "utf8"),
      ) as { status: string };
      if (m.status === "approved") await approvedSchema(c);
      log.info(
        {
          integration: c.id,
          enabled: c.enabled,
          authorization: c.authorization,
          schemaStatus: m.status,
          publication: c.publicationEnabled,
        },
        "configuration_valid",
      );
    }
    return;
  }
  const c = integrations.find(
    (i) =>
      i.id === values.integration ||
      (values.integration === undefined &&
        i.id === "diamond-bridge-altas-bajas"),
  );
  if (command === "inspect") {
    if (!c) throw new Error("UNKNOWN_INTEGRATION");
    if (values.simulate || values.send || values.publish)
      throw new Error("INSPECTION_FLAGS_INVALID");
    if (values["from-file"] && values["allow-sql"])
      throw new Error("INSPECTION_FLAGS_INVALID");
    const imported = values["from-file"]
      ? await readMetadataExport(path.resolve(root(), values["from-file"]), c)
      : undefined;
    const executor = new SqlExecutor();
    const inspectionTrust = imported
      ? false
      : (await executor.profiles())[c.profile]
          ?.inspectionTrustServerCertificate === true;
    const schema =
      imported?.schema ??
      (await executor.inspect(c, values["allow-sql"] === true));
    const result = await saveInspection(
      c,
      schema,
      undefined,
      imported
        ? { method: ssmsMetadataMethod, inputHash: imported.inputHash }
        : {
            certificateValidation: inspectionTrust
              ? "not-verified-user-authorized"
              : "verified",
          },
    );
    log.info(
      {
        integration: c.id,
        ...result,
        columnCount: schema.columns.length,
        status: "pending",
        acquisition: imported ? "ssms-file" : "direct-sql",
      },
      "metadata_candidate_created",
    );
    return;
  }
  if (command === "preflight") {
    if (!c) throw new Error("UNKNOWN_INTEGRATION");
    const readiness = await scheduleReadiness(c);
    log.info(
      { integration: c.id, ...readiness },
      readiness.ready ? "schedule_ready" : "schedule_blocked",
    );
    if (!readiness.ready) process.exitCode = 2;
    return;
  }
  const spool = new Spool(
    path.resolve(root(), process.env.SPOOL_DIR ?? ".local/spool"),
    Buffer.from(process.env.SPOOL_KEY ?? "", "base64"),
  );
  if (command === "status") {
    log.info({ runs: await spool.status() }, "spool_status");
    return;
  }
  if (!c) throw new Error("UNKNOWN_INTEGRATION");
  if (command === "unlock") {
    await unlock(spool, c.id);
    return;
  }
  if (command === "recover") {
    const simulation = values.simulate === true;
    if (!simulation) requireLive(c);
    await withLock(spool, c.id, async () => {
      const runs = (await spool.status()) as {
        runId: string;
        integration?: string;
        simulation?: boolean;
        sealed: boolean;
        checkpoint?: { stage?: string };
      }[];
      const pending = [];
      for (const run of runs) {
        if (run.integration !== c.id || run.simulation !== simulation) continue;
        if (!run.sealed) throw new Error("UNSEALED_SPOOL_REVIEW_REQUIRED");
        const m = await spool.verify(run.runId);
        if (
          m.integrationId === c.id &&
          m.simulation === simulation &&
          run.checkpoint?.stage !== "published" &&
          !(run.checkpoint?.stage === "finalized" && !values.publish)
        )
          pending.push(m);
      }
      pending.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      for (const m of pending) await transfer(spool, m.runId, c, simulation);
      log.info(
        { integration: c.id, count: pending.length },
        "recovery_complete",
      );
    });
    return;
  }
  if (command === "sync") {
    const simulation = values.simulate === true;
    if (!simulation) {
      requireLive(c);
      if (!values["allow-sql"])
        throw new Error("EXPLICIT_SQL_AUTHORIZATION_REQUIRED");
    }
    await withLock(spool, c.id, async () => {
      const source = simulation
        ? fixtureSource(c.id.startsWith("diamond"))
        : await new SqlExecutor().source(c, await approvedSchema(c));
      const m = await extract(
        spool,
        c,
        source,
        process.env.AGENT_ORIGIN ?? "windows-lan-01",
        simulation,
      );
      log.info(
        {
          runId: m.runId,
          integration: c.id,
          rowCount: m.totalRows,
          batchCount: m.batches.length,
          durationMs: Date.now() - Date.parse(m.startedAt),
        },
        "spool_sealed",
      );
      if (values.send || values.publish)
        await transfer(spool, m.runId, c, simulation);
    });
    return;
  }
  if (command === "resume") {
    if (!values.run) throw new Error("RUN_REQUIRED");
    const m = await spool.verify(values.run),
      cfg = integrations.find((i) => i.id === m.integrationId);
    if (!cfg) throw new Error("UNKNOWN_INTEGRATION");
    if (!m.simulation) requireLive(cfg);
    await withLock(spool, cfg.id, () =>
      transfer(spool, m.runId, cfg, m.simulation),
    );
    return;
  }
  throw new Error("UNKNOWN_COMMAND");
}
async function transfer(
  spool: Spool,
  id: string,
  c: Integration,
  simulation: boolean,
): Promise<void> {
  correlationRunId = id;
  const started = Date.now();
  const t = new Transport({
    baseUrl: process.env.API_BASE_URL ?? "",
    token: process.env[c.secrets.apiToken] ?? "",
    attempts: c.retry.attempts,
    baseDelayMs: c.retry.baseDelayMs,
    timeoutMs: 30000,
    simulation,
  });
  await t.send(spool, id, c, values.publish === true);
  log.info(
    { runId: id, integration: c.id, durationMs: Date.now() - started },
    "transfer_complete",
  );
}
main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : "";
  const code = /^[A-Z][A-Z0-9_]+$/.test(message) ? message : "OPERATION_FAILED";
  const runId =
    correlationRunId ??
    (e instanceof Error && "runId" in e ? e.runId : undefined);
  log.error(
    {
      code,
      runId,
      integration: values.integration,
      durationMs: Date.now() - operationStarted,
    },
    "operation_failed",
  );
  process.exitCode = 1;
});

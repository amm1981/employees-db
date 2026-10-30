import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  canonical,
  hash,
  validateRow,
  validateSchema,
} from "../src/contract.js";
import { integrationValidator, loadIntegrations } from "../src/config.js";
import { fixtureSchema, fixtureRows, fixtureSource } from "../src/fixture.js";
import { Spool, extract, withLock } from "../src/spool.js";
import { SqlExecutor } from "../src/sql.js";
import { Transport } from "../src/transport.js";
import { rm } from "node:fs/promises";
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function context() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "get-employes-test-"));
  dirs.push(dir);
  const spool = new Spool(dir, randomBytes(32));
  const c = (await loadIntegrations())[0]!;
  return { spool, c };
}
describe("configuration and SQL authorization", () => {
  it("loads both isolated integrations and blocks Diamond publication", async () => {
    const all = await loadIntegrations();
    expect(all).toHaveLength(2);
    expect(all[1]!.enabled).toBe(false);
    expect(() =>
      integrationValidator.parse({ ...all[1], publicationEnabled: true }),
    ).toThrow();
  });
  it("rejects arbitrary SQL / extra parameters / unsupported modes", async () => {
    const { c } = await context();
    for (const change of [
      { procedure: "DROP TABLE x" },
      { parameters: ["x"] },
      { mode: "FULL" },
      { database: "master" },
    ])
      expect(() => integrationValidator.parse({ ...c, ...change })).toThrow();
  });
  it("refuses SQL connection before approval", async () => {
    const { c } = await context();
    await expect(new SqlExecutor().connect(c)).rejects.toThrow(
      "INTEGRATION_NOT_APPROVED",
    );
  });
  it("fails closed for rounding-prone MSSQL numeric and temporal types", () => {
    expect(() => new SqlExecutor().assertLossless(fixtureSchema)).toThrow(
      "LOSSLESS_ADAPTER_REQUIRED",
    );
  });
});
describe("canonical lossless contract", () => {
  it("preserves all 37 ordered columns, duplicates, null, empty Unicode and exact decimal lexemes", () => {
    const rows = fixtureRows();
    rows.forEach((r) => validateRow(r, fixtureSchema));
    expect(JSON.parse(canonical(rows))).toEqual(rows);
    expect(rows[0]).toEqual(rows[1]);
    expect(rows[0]![2]).toBe("00001234");
    expect(rows[0]![4]).toBe("");
    expect(rows[0]![12]).toBe("12345678901234567890.123456789012345678");
  });
  it("is stable under structural key reordering", () => {
    expect(hash(canonical({ b: 2, a: "ñ/\u2028" }))).toBe(
      hash(canonical({ a: "ñ/\u2028", b: 2 })),
    );
  });
  it("keeps Diamond company code null", () => {
    expect(fixtureRows(true)[0]![0]).toBeNull();
  });
  it("rejects invalid calendar dates, clock ranges, offsets and temporal precision", () => {
    for (const [index, value] of [
      [15, "2026-02-29"],
      [36, "2026-10-26T25:00:00"],
      [36, "2026-10-26T12:00:00+01:00"],
      [36, "2026-10-26T12:00:00.12345678"],
    ] as const) {
      const row = fixtureRows()[0]!.slice();
      row[index] = value;
      expect(() => validateRow(row, fixtureSchema)).toThrow();
    }
    const valid = fixtureRows()[0]!.slice();
    valid[15] = "2024-02-29";
    expect(() => validateRow(valid, fixtureSchema)).not.toThrow();
  });
  it("rejects altered order, missing columns and guessed SQL types", () => {
    const s = structuredClone(fixtureSchema);
    s.columns.reverse();
    expect(() => validateSchema(s)).toThrow("SCHEMA_COLUMN_ORDER");
    expect(() => validateRow([], fixtureSchema)).toThrow();
    s.columns[0]!.sqlType = "invented";
    expect(() => validateSchema(s)).toThrow();
  });
  it("rejects overflow, numeric JSON, excess size and decimal scale", () => {
    for (const [index, value] of [
      [2, 12],
      [5, "x".repeat(129)],
      [12, "1.1234567890123456789"],
    ] as const) {
      const row = fixtureRows()[0]!.slice();
      (row as unknown[])[index] = value;
      expect(() => validateRow(row, fixtureSchema)).toThrow();
    }
  });
});
describe("encrypted sealed spool", () => {
  it("seals only after complete extraction and verifies all hashes", async () => {
    const { spool, c } = await context();
    const m = await extract(spool, c, fixtureSource(), "fixture-agent", true);
    expect(m.totalRows).toBe(3);
    expect((await spool.verify(m.runId)).schemaHash).toBe(
      hash(canonical(fixtureSchema)),
    );
    const raw = await readFile(path.join(spool.dir, m.runId, "batch-0.enc"));
    expect(raw.toString()).not.toContain("Ficticio");
  });
  it("does not seal partial extraction", async () => {
    const { spool, c } = await context();
    c.limits.batchRows = 1;
    const source = {
      schema: fixtureSchema,
      rows: (async function* () {
        yield fixtureRows()[0]!;
        yield fixtureRows()[1]!;
        throw new Error("SQL interrupted");
      })(),
    };
    await expect(
      extract(spool, c, source, "fixture-agent", true),
    ).rejects.toThrow();
    const id = (await readdir(spool.dir))[0]!;
    await expect(spool.manifest(id)).rejects.toThrow();
  });
  it("blocks empty results by default", async () => {
    const { spool, c } = await context();
    await expect(
      extract(spool, c, fixtureSource(false, []), "fixture-agent", true),
    ).rejects.toThrow("EMPTY_BLOCKED");
  });
  it("requires explicit policy for empty captures", async () => {
    const { spool, c } = await context();
    c.emptyPolicy = "allow-approved";
    const m = await extract(
      spool,
      c,
      fixtureSource(false, []),
      "fixture-agent",
      true,
    );
    expect(m.totalRows).toBe(0);
    expect(m.batches).toEqual([]);
  });
  it("detects authenticated ciphertext tampering", async () => {
    const { spool, c } = await context();
    const m = await extract(spool, c, fixtureSource(), "fixture-agent", true);
    const p = path.join(spool.dir, m.runId, "batch-0.enc"),
      buf = await readFile(p);
    buf[20] = buf[20]! ^ 1;
    await writeFile(p, buf);
    await expect(spool.verify(m.runId)).rejects.toThrow();
  });
  it("refuses to overwrite immutable files or traverse run paths", async () => {
    const { spool, c } = await context();
    const m = await extract(spool, c, fixtureSource(), "fixture-agent", true);
    await expect(spool.put(m.runId, "batch-0.enc", "[]")).rejects.toThrow();
    expect(() => spool.runDir("../x")).toThrow();
  });
  it("blocks concurrent integration executions and releases the lock on failure", async () => {
    const { spool, c } = await context();
    await withLock(spool, c.id, async () => {
      await expect(withLock(spool, c.id, async () => 1)).rejects.toThrow(
        "OVERLAP_LOCKED",
      );
    });
    await expect(
      withLock(spool, c.id, async () => {
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");
    expect(await withLock(spool, c.id, async () => 1)).toBe(1);
  });
  it("enforces row and byte limits", async () => {
    const { spool, c } = await context();
    c.limits.maxRows = 1;
    await expect(
      extract(spool, c, fixtureSource(), "fixture-agent", true),
    ).rejects.toThrow("MAX_ROWS");
    c.limits.maxRows = 100;
    c.limits.maxBytes = 1;
    await expect(
      extract(spool, c, fixtureSource(), "fixture-agent", true),
    ).rejects.toThrow("MAX_BYTES");
  });
});
describe("HTTPS transfer and recovery", () => {
  const options = {
    baseUrl: "https://example.invalid",
    token: "fixture",
    attempts: 2,
    baseDelayMs: 1,
    timeoutMs: 1000,
    simulation: true,
  };
  it("disallows HTTP except local simulation and rejects URL credentials", () => {
    expect(
      () => new Transport({ ...options, baseUrl: "http://remote.invalid" }),
    ).toThrow("HTTPS_REQUIRED");
    expect(
      () =>
        new Transport({
          ...options,
          baseUrl: "https://user:pass@example.invalid",
        }),
    ).toThrow();
    expect(
      () =>
        new Transport({
          ...options,
          baseUrl: "http://127.0.0.1",
          simulation: false,
        }),
    ).toThrow();
  });
  it("retries network failures with bounds", async () => {
    let n = 0;
    const t = new Transport({
      ...options,
      fetcher: async () => {
        n++;
        throw new Error("secret payload");
      },
    });
    await expect(t.request("GET", "/sync/runs/x")).rejects.toThrow(
      "NETWORK_UNAVAILABLE",
    );
    expect(n).toBe(2);
  });
  it("does not retry conflict responses", async () => {
    let n = 0;
    const t = new Transport({
      ...options,
      fetcher: async () => {
        n++;
        return new Response("{}", { status: 409 });
      },
    });
    await expect(t.request("POST", "/sync/runs", {})).rejects.toThrow(
      "HTTP_409",
    );
    expect(n).toBe(1);
  });
  it("resumes pending batches from sealed original run after lost response", async () => {
    const { spool, c } = await context();
    c.limits.batchRows = 1;
    const m = await extract(spool, c, fixtureSource(), "fixture-agent", true),
      accepted = new Map<number, string>();
    let offline = true;
    let sent = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      let body: any = {};
      if (url.endsWith("/sync/runs")) body = { runId: m.runId };
      else if (url.endsWith("/batches"))
        body = {
          batches: [...accepted].map(([number, hash]) => ({ number, hash })),
        };
      else if (url.endsWith("/finalize")) body = { status: "finalized" };
      else if (init?.method === "PUT") {
        const num = Number(url.split("/").at(-1));
        const data = JSON.parse(String(init.body));
        accepted.set(num, data.hash);
        sent++;
        if (offline) throw new Error("Lost acknowledgement");
        body = { number: num, hash: data.hash };
      }
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const t = new Transport({ ...options, fetcher });
    await expect(t.send(spool, m.runId, c, false)).rejects.toThrow(
      "NETWORK_UNAVAILABLE",
    );
    expect(accepted.size).toBe(1);
    offline = false;
    await t.send(spool, m.runId, c, false);
    expect(accepted.size).toBe(3);
    expect(sent).toBe(4);
    expect((await spool.verify(m.runId)).totalRows).toBe(3);
  });
  it("does not send incomplete/corrupt spools", async () => {
    const { spool, c } = await context();
    let called = false;
    const t = new Transport({
      ...options,
      fetcher: async () => {
        called = true;
        return new Response("{}");
      },
    });
    await expect(
      t.send(spool, "00000000-0000-4000-8000-000000000000", c, false),
    ).rejects.toThrow();
    expect(called).toBe(false);
  });
});

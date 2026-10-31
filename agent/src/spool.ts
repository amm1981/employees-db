import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  writeFile,
  rename,
  readdir,
  unlink,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  canonical,
  hash,
  validateRow,
  validateSchema,
  type Row,
  type Schema,
} from "./contract.js";
import type { Integration } from "./config.js";
export interface Batch {
  number: number;
  first: number;
  count: number;
  bytes: number;
  hash: string;
}
export interface Manifest {
  protocol: 1;
  runId: string;
  integrationId: string;
  dataset: string;
  origin: string;
  simulation: boolean;
  mode: "ROLLING_WINDOW_CAPTURE";
  schema: Schema;
  schemaHash: string;
  startedAt: string;
  completedAt: string;
  totalRows: number;
  totalBytes: number;
  batches: Batch[];
}
export interface Source {
  schema: Schema;
  rows: AsyncIterable<Row>;
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class Spool {
  constructor(
    readonly dir: string,
    private readonly key: Buffer,
  ) {
    if (key.length !== 32) throw new Error("SPOOL_KEY_REQUIRED");
  }
  runDir(id: string): string {
    if (!uuid.test(id)) throw new Error("INVALID_RUN_UUID");
    return path.join(this.dir, id);
  }
  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    if (process.platform === "win32") {
      const user = execFileSync("whoami", [], { encoding: "utf8" }).trim();
      execFileSync(
        "icacls",
        [
          path.resolve(this.dir),
          "/inheritance:r",
          "/grant:r",
          `${user}:(OI)(CI)F`,
        ],
        { stdio: "ignore" },
      );
    }
  }
  private encrypt(data: string): Buffer {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", this.key, iv);
    return Buffer.concat([
      Buffer.from("GES1"),
      iv,
      c.update(data, "utf8"),
      c.final(),
      c.getAuthTag(),
    ]);
  }
  private decrypt(b: Buffer): string {
    if (b.subarray(0, 4).toString() !== "GES1") throw new Error("SPOOL_FORMAT");
    const d = createDecipheriv("aes-256-gcm", this.key, b.subarray(4, 16));
    d.setAuthTag(b.subarray(-16));
    return Buffer.concat([d.update(b.subarray(16, -16)), d.final()]).toString(
      "utf8",
    );
  }
  async put(id: string, name: string, data: string): Promise<void> {
    if (!/^(manifest|batch-\d+)\.enc$/.test(name))
      throw new Error("SPOOL_FILENAME");
    const file = await open(path.join(this.runDir(id), name), "wx", 0o600);
    try {
      await file.writeFile(this.encrypt(data));
      await file.sync();
    } finally {
      await file.close();
    }
  }
  async get(id: string, name: string): Promise<string> {
    if (!/^(manifest|batch-\d+)\.enc$/.test(name))
      throw new Error("SPOOL_FILENAME");
    return this.decrypt(await readFile(path.join(this.runDir(id), name)));
  }
  async manifest(id: string): Promise<Manifest> {
    const m = JSON.parse(await this.get(id, "manifest.enc")) as Manifest;
    if (m.runId !== id) throw new Error("SPOOL_RUN_MISMATCH");
    return m;
  }
  async verify(id: string): Promise<Manifest> {
    const m = await this.manifest(id);
    validateSchema(m.schema);
    if (hash(canonical(m.schema)) !== m.schemaHash)
      throw new Error("SPOOL_SCHEMA_HASH");
    let n = 0,
      bytes = 0;
    for (const [i, b] of m.batches.entries()) {
      const payload = await this.get(id, `batch-${b.number}.enc`);
      if (
        b.number !== i ||
        b.first !== n ||
        b.hash !== hash(payload) ||
        Buffer.byteLength(payload) !== b.bytes
      )
        throw new Error("SPOOL_INTEGRITY");
      const rows = JSON.parse(payload) as Row[];
      if (rows.length !== b.count) throw new Error("SPOOL_ROW_COUNT");
      rows.forEach((r) => validateRow(r, m.schema));
      n += b.count;
      bytes += b.bytes;
    }
    if (n !== m.totalRows || bytes !== m.totalBytes)
      throw new Error("SPOOL_TOTAL");
    return m;
  }
  async checkpoint(id: string, stage: string): Promise<void> {
    const dir = this.runDir(id),
      temp = path.join(dir, `checkpoint-${randomUUID()}.tmp`);
    await writeFile(
      temp,
      JSON.stringify({ stage, at: new Date().toISOString() }),
      { mode: 0o600 },
    );
    await rename(temp, path.join(dir, "checkpoint.json"));
  }
  async status(): Promise<unknown[]> {
    await this.init();
    const results: unknown[] = [];
    for (const id of await readdir(this.dir)) {
      if (!uuid.test(id)) continue;
      try {
        const m = await this.verify(id);
        results.push({
          runId: id,
          integration: m.integrationId,
          simulation: m.simulation,
          rows: m.totalRows,
          sealed: true,
          checkpoint: JSON.parse(
            await readFile(
              path.join(this.runDir(id), "checkpoint.json"),
              "utf8",
            ).catch(() => "{}"),
          ),
        });
      } catch {
        const identity = await readFile(
          path.join(this.runDir(id), "identity.json"),
          "utf8",
        )
          .then((s) => {
            try {
              return JSON.parse(s) as {
                integration?: string;
                simulation?: boolean;
              };
            } catch {
              return {};
            }
          })
          .catch(() => ({}));
        results.push({
          runId: id,
          ...identity,
          sealed: false,
          error: "INCOMPLETE_OR_CORRUPT",
        });
      }
    }
    return results;
  }
}
export async function withLock<T>(
  spool: Spool,
  integration: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!/^[a-z0-9-]+$/.test(integration)) throw new Error("LOCK_ID");
  await spool.init();
  const lock = path.join(spool.dir, `${integration}.lock`);
  const h = await open(lock, "wx", 0o600).catch(() => {
    throw new Error("OVERLAP_LOCKED");
  });
  try {
    await h.writeFile(
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    return await fn();
  } finally {
    await h.close();
    await unlink(lock);
  }
}
export async function unlock(spool: Spool, integration: string): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(integration)) throw new Error("LOCK_ID");
  const p = path.join(spool.dir, `${integration}.lock`),
    lock = JSON.parse(await readFile(p, "utf8")) as { pid: number };
  try {
    process.kill(lock.pid, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ESRCH") {
      await unlink(p);
      return;
    }
    throw e;
  }
  throw new Error("LOCK_OWNER_ALIVE");
}
export async function extract(
  spool: Spool,
  c: Integration,
  source: Source,
  origin: string,
  simulation: boolean,
): Promise<Manifest> {
  const schema = validateSchema(source.schema),
    runId = randomUUID(),
    startedAt = new Date().toISOString();
  await spool.init();
  await mkdir(spool.runDir(runId), { mode: 0o700 });
  await writeFile(
    path.join(spool.runDir(runId), "identity.json"),
    JSON.stringify({ integration: c.id, simulation }),
    { flag: "wx", mode: 0o600 },
  );
  let rows: Row[] = [],
    size = 2,
    totalRows = 0,
    totalBytes = 0;
  const batches: Batch[] = [];
  const flush = async () => {
    if (!rows.length) return;
    if (batches.length >= 10000) throw new Error("MAX_BATCHES");
    const data = canonical(rows),
      bytes = Buffer.byteLength(data);
    const batch = {
      number: batches.length,
      first: totalRows - rows.length,
      count: rows.length,
      bytes,
      hash: hash(data),
    };
    await spool.put(runId, `batch-${batch.number}.enc`, data);
    batches.push(batch);
    totalBytes += bytes;
    rows = [];
    size = 2;
    if (totalBytes > c.limits.maxBytes) throw new Error("MAX_BYTES");
  };
  try {
    for await (const row of source.rows) {
      validateRow(row, schema);
      if (
        !simulation &&
        c.id === "diamond-bridge-altas-bajas" &&
        c.companyCodePolicy === "preserve-null" &&
        row[0] !== null
      )
        throw new Error("COMPANY_CODE_MISMATCH");
      const bytes = Buffer.byteLength(canonical(row));
      if (bytes + 2 > c.limits.batchBytes) throw new Error("ROW_TOO_LARGE");
      if (
        rows.length &&
        (rows.length >= c.limits.batchRows ||
          size + bytes + 1 > c.limits.batchBytes)
      )
        await flush();
      size += bytes + (rows.length ? 1 : 0);
      rows.push(row);
      if (++totalRows > c.limits.maxRows) throw new Error("MAX_ROWS");
      if (totalBytes + size > c.limits.maxBytes) throw new Error("MAX_BYTES");
    }
    await flush();
    if (!totalRows && c.emptyPolicy === "block")
      throw new Error("EMPTY_BLOCKED");
    const manifest: Manifest = {
      protocol: 1,
      runId,
      integrationId: c.id,
      dataset: c.dataset,
      origin,
      simulation,
      mode: c.mode,
      schema,
      schemaHash: hash(canonical(schema)),
      startedAt,
      completedAt: new Date().toISOString(),
      totalRows,
      totalBytes,
      batches,
    };
    await spool.put(runId, "manifest.enc", canonical(manifest));
    await spool.verify(runId);
    await spool.checkpoint(runId, "sealed");
    return manifest;
  } catch (e) {
    await spool.checkpoint(runId, "extraction_failed");
    const message =
      e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message)
        ? e.message
        : "EXTRACTION_FAILED";
    throw Object.assign(new Error(message), { runId });
  }
}

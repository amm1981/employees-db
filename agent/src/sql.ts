import sql from "mssql";
import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { root, registry, requireLive, type Integration } from "./config.js";
import { canonical, type Row, type Schema } from "./contract.js";
import type { Source } from "./spool.js";
import { connectionErrorCode } from "./sql-errors.js";
import { schemaFromMetadata } from "./metadata.js";
const profileSchema = z
  .object({
    serverEnv: z.string(),
    portEnv: z.string(),
    userEnv: z.string(),
    passwordEnv: z.string(),
    encrypt: z.literal(true),
    trustServerCertificate: z.literal(false),
    inspectionTrustServerCertificate: z.boolean().default(false),
    connectionTimeoutMs: z.number().int().positive(),
  })
  .strict();
export class SqlExecutor {
  constructor(
    private readonly poolFactory: (config: sql.config) => sql.ConnectionPool = (
      config,
    ) => new sql.ConnectionPool(config),
  ) {}

  async profiles(): Promise<Record<string, z.infer<typeof profileSchema>>> {
    return z
      .record(z.string(), profileSchema)
      .parse(
        YAML.parse(
          await readFile(path.join(root(), "config/sql-profiles.yaml"), "utf8"),
        ),
      );
  }
  async connect(c: Integration): Promise<sql.ConnectionPool> {
    requireLive(c);
    return this.openConnection(c, "extraction");
  }

  async inspect(c: Integration, authorized = false): Promise<Schema> {
    if (!authorized) throw new Error("EXPLICIT_SQL_AUTHORIZATION_REQUIRED");
    const pool = await this.openConnection(c, "inspection");
    try {
      return await this.describe(pool, c);
    } finally {
      await pool.close();
    }
  }

  private async openConnection(
    c: Integration,
    purpose: "inspection" | "extraction",
  ): Promise<sql.ConnectionPool> {
    if (registry[c.id] !== c.procedure)
      throw new Error("UNAUTHORIZED_PROCEDURE");
    if (c.database !== "MarcacionesCB" || c.parameters.length !== 0)
      throw new Error("UNAUTHORIZED_SQL_TARGET");
    const profiles = await this.profiles();
    const p = profileSchema.parse(profiles[c.profile]);
    const required = (key: string) => {
      const v = process.env[key];
      if (!v) throw new Error("SQL_SECRET_MISSING");
      return v;
    };
    const port = z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(process.env[p.portEnv] ?? 1433);
    const pool = this.poolFactory({
      server: required(p.serverEnv),
      port,
      user: required(p.userEnv),
      password: required(p.passwordEnv),
      database: c.database,
      connectionTimeout: p.connectionTimeoutMs,
      requestTimeout: c.timeoutMs,
      pool: { min: 0, max: 1, idleTimeoutMillis: 1000 },
      options: {
        encrypt: true,
        trustServerCertificate:
          purpose === "inspection" && p.inspectionTrustServerCertificate,
        useUTC: true,
      },
      arrayRowMode: true,
    });
    pool.on("error", () => {
      /* Request promise reports a sanitized CLI error. Never log driver payloads. */
    });
    try {
      return await pool.connect();
    } catch (error) {
      await pool.close().catch(() => {});
      throw new Error(connectionErrorCode(error));
    }
  }
  // Fixed metadata query. The EXEC string comes only from the compiled allowlist.
  async describe(pool: sql.ConnectionPool, c: Integration): Promise<Schema> {
    if (registry[c.id] !== c.procedure)
      throw new Error("UNAUTHORIZED_PROCEDURE");
    const req = pool.request();
    req.arrayRowMode = false;
    const result = await req
      .input("tsql", sql.NVarChar, `EXEC ${registry[c.id]};`)
      .execute("sys.sp_describe_first_result_set");
    return schemaFromMetadata(result.recordset);
  }
  assertLossless(schema: Schema): void {
    if (this.losslessIssues(schema).length)
      throw new Error("LOSSLESS_ADAPTER_REQUIRED");
  }

  losslessIssues(
    schema: Schema,
  ): { column: string; sqlType: string; reason: string }[] {
    return schema.columns.flatMap((c) => {
      const t = c.sqlType.toLowerCase();
      const reason = /^(decimal|numeric|money|smallmoney)$/.test(t)
        ? "DECIMAL_PRECISION_DRIVER"
        : t === "datetimeoffset"
          ? "TIMEZONE_OFFSET_DRIVER"
          : /^(datetime2|time)$/.test(t) && c.scale > 3
            ? "TEMPORAL_PRECISION_DRIVER"
            : t === "datetime"
              ? "DATETIME_PRECISION_DRIVER"
              : /^(varchar|char|text)$/.test(t) &&
                  (!c.collation || !c.collation.endsWith("_UTF8"))
                ? "SQL_ENCODING_NOT_VERIFIED"
                : undefined;
      return reason ? [{ column: c.name, sqlType: c.sqlType, reason }] : [];
    });
  }
  async source(c: Integration, approved: Schema): Promise<Source> {
    const pool = await this.connect(c);
    try {
      const actual = await this.describe(pool, c);
      actual.version = approved.version;
      if (canonical(actual) !== canonical(approved))
        throw new Error("SQL_SCHEMA_CHANGED");
      this.assertLossless(actual);
    } catch (e) {
      await pool.close();
      throw e;
    }
    const self = this;
    return {
      schema: approved,
      rows: (async function* (): AsyncGenerator<Row> {
        const request = pool.request();
        request.stream = true;
        request.arrayRowMode = true;
        let row: unknown[] | undefined,
          done = false,
          error: Error | undefined,
          sets = 0;
        let wake: (() => void) | undefined;
        const signal = () => {
          wake?.();
          wake = undefined;
        };
        request.on("recordset", (cols: unknown) => {
          sets++;
          const m = cols as {
            name: string;
            length: number;
            precision: number;
            scale: number;
            nullable: boolean;
            type: { declaration: string };
          }[];
          if (
            sets !== 1 ||
            !Array.isArray(m) ||
            m.length !== approved.columns.length ||
            m.some((v, i) => {
              const c = approved.columns[i]!;
              return (
                v.name !== c.name ||
                v.type.declaration.toLowerCase() !== c.sqlType.toLowerCase() ||
                v.nullable !== c.nullable ||
                (/^(n?varchar|n?char|binary|varbinary)$/.test(c.sqlType) &&
                  v.length !== (c.maxLength === -1 ? 65535 : c.maxLength)) ||
                (v.precision !== undefined && v.precision !== c.precision) ||
                (v.scale !== undefined && v.scale !== c.scale)
              );
            })
          ) {
            error = new Error("SQL_RECORDSET_CHANGED");
            request.cancel();
            signal();
          }
        });
        request.on("row", (r: unknown[]) => {
          request.pause();
          row = r;
          signal();
        });
        request.on("error", () => {
          error = new Error("SQL_EXTRACTION_FAILED");
          signal();
        });
        const execution = request.execute(c.procedure).then(
          () => {
            done = true;
            signal();
          },
          () => {
            error = new Error("SQL_EXTRACTION_FAILED");
            done = true;
            signal();
          },
        );
        try {
          while (true) {
            if (error) throw error;
            if (row) {
              const r = row;
              row = undefined;
              yield r.map((v, i) => self.cell(v, approved.columns[i]!.sqlType));
              request.resume();
              continue;
            }
            if (done) break;
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
          await execution;
          if (error || sets !== 1) throw new Error("SQL_INCOMPLETE");
        } finally {
          request.cancel();
          await execution;
          await pool.close();
        }
      })(),
    };
  }
  private cell(v: unknown, t: string): string | null {
    if (v === null) return null;
    if (typeof v === "string") return v;
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "boolean") return v ? "1" : "0";
    if (Buffer.isBuffer(v)) return v.toString("hex");
    if (v instanceof Date) {
      const s = v.toISOString();
      return t === "date"
        ? s.slice(0, 10)
        : t === "time"
          ? s.slice(11, -1)
          : s.slice(0, -1);
    }
    if (
      typeof v === "number" &&
      Number.isFinite(v) &&
      (!/^(bigint|int|smallint|tinyint)$/.test(t) || Number.isSafeInteger(v))
    )
      return String(v);
    throw new Error("SQL_UNSAFE_VALUE");
  }
}

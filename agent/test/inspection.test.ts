import { afterEach, describe, expect, it, vi } from "vitest";
import type sql from "mssql";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadIntegrations } from "../src/config.js";
import { SqlExecutor } from "../src/sql.js";
import { saveInspection } from "../src/inspection.js";
import { fixtureSchema } from "../src/fixture.js";
import { canonical, hash } from "../src/contract.js";
import { connectionErrorCode } from "../src/sql-errors.js";
import {
  readMetadataExport,
  schemaFromExport,
  ssmsMetadataMethod,
} from "../src/metadata.js";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

function mockDatabase(
  metadata: Record<string, unknown>[] = fixtureSchema.columns.map((c, i) => ({
    column_ordinal: i + 1,
    is_hidden: false,
    name: c.name,
    system_type_name: c.sqlType,
    is_nullable: c.nullable,
    max_length: c.maxLength,
    precision: c.precision,
    scale: c.scale,
    collation_name: c.collation,
    user_type_name: null,
  })),
) {
  vi.stubEnv("SQL_HOST", "fixture.invalid");
  vi.stubEnv("SQL_USER", "fixture_metadata_reader");
  vi.stubEnv("SQL_PASSWORD", "synthetic-test-value");
  vi.stubEnv("SQL_PORT", "1433");
  const execute = vi.fn().mockResolvedValue({ recordset: metadata });
  const request = {
    input: vi.fn().mockReturnThis(),
    execute,
    arrayRowMode: true,
  };
  const pool = {
    on: vi.fn(),
    connect: vi.fn().mockImplementation(async () => pool),
    close: vi.fn().mockResolvedValue(undefined),
    request: vi.fn().mockReturnValue(request),
  };
  const factory = vi.fn(
    (_config: sql.config) => pool as unknown as sql.ConnectionPool,
  );
  return {
    executor: new SqlExecutor(factory),
    pool,
    factory,
    execute,
    request,
    metadata,
  };
}

describe("metadata-only inspection authorization", () => {
  it("does not open a connection without explicit inspection consent", async () => {
    const { executor, factory } = mockDatabase();
    await expect(
      executor.inspect((await loadIntegrations())[0]!),
    ).rejects.toThrow("EXPLICIT_SQL_AUTHORIZATION_REQUIRED");
    expect(factory).not.toHaveBeenCalled();
  });
  it("inspects a pending integration using only the metadata SP and the explicit inspection certificate policy", async () => {
    const c = (await loadIntegrations())[0]!;
    const before = structuredClone(c);
    const { executor, factory, execute, request, pool } = mockDatabase();
    const schema = await executor.inspect(c, true);
    expect(schema.columns).toEqual(fixtureSchema.columns);
    expect(c).toEqual(before);
    expect(execute.mock.calls).toEqual([["sys.sp_describe_first_result_set"]]);
    expect(request.input.mock.calls[0]![2]).toBe(`EXEC ${c.procedure};`);
    expect(factory.mock.calls[0]![0]).toMatchObject({
      database: "MarcacionesCB",
      options: { encrypt: true, trustServerCertificate: true },
    });
    expect(pool.close).toHaveBeenCalledOnce();
    await expect(executor.connect(c)).rejects.toThrow(
      "INTEGRATION_NOT_APPROVED",
    );
  });
  it("keeps certificate validation for extraction even when inspection trusts the certificate", async () => {
    const c = (await loadIntegrations())[0]!;
    const { executor, factory, execute, pool } = mockDatabase();
    await executor.connect({ ...c, authorization: "approved" });
    expect(factory.mock.calls[0]![0].options).toMatchObject({
      encrypt: true,
      trustServerCertificate: false,
    });
    expect(execute).not.toHaveBeenCalled();
    await pool.close();
  });
  it("verifies the inspection certificate when its explicit exception is disabled", async () => {
    const c = (await loadIntegrations())[0]!;
    const { executor, factory } = mockDatabase();
    const profiles = await executor.profiles();
    profiles[c.profile]!.inspectionTrustServerCertificate = false;
    vi.spyOn(executor, "profiles").mockResolvedValue(profiles);
    await executor.inspect(c, true);
    expect(factory.mock.calls[0]![0].options).toMatchObject({
      encrypt: true,
      trustServerCertificate: false,
    });
  });
  it("still rejects procedures, databases or parameters outside the allowlist", async () => {
    const c = (await loadIntegrations())[0]!;
    const { executor, factory } = mockDatabase();
    await expect(
      executor.inspect({ ...c, procedure: "dbo.arbitrary" }, true),
    ).rejects.toThrow("UNAUTHORIZED_PROCEDURE");
    await expect(
      executor.inspect({ ...c, database: "master" as typeof c.database }, true),
    ).rejects.toThrow("UNAUTHORIZED_SQL_TARGET");
    expect(factory).not.toHaveBeenCalled();
  });
  it("reports missing secrets before opening any network connection", async () => {
    const { executor, factory } = mockDatabase();
    vi.stubEnv("SQL_PASSWORD", "");
    await expect(
      executor.inspect((await loadIntegrations())[0]!, true),
    ).rejects.toThrow("SQL_SECRET_MISSING");
    expect(factory).not.toHaveBeenCalled();
  });
  it("closes the pool on metadata analysis failure without executing the business SP", async () => {
    const { executor, execute, pool } = mockDatabase();
    execute.mockRejectedValueOnce(new Error("metadata analysis failed"));
    await expect(
      executor.inspect((await loadIntegrations())[0]!, true),
    ).rejects.toThrow();
    expect(pool.close).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });
  it("closes failed connections and sanitizes login failures", async () => {
    const { executor, pool } = mockDatabase();
    pool.connect.mockRejectedValueOnce(
      Object.assign(new Error("sensitive driver details"), { code: "ELOGIN" }),
    );
    await expect(
      executor.inspect((await loadIntegrations())[0]!, true),
    ).rejects.toThrow("SQL_ELOGIN");
    expect(pool.close).toHaveBeenCalledOnce();
  });
  it.each(["is_nullable", "max_length", "collation_name"])(
    "does not guess missing metadata: %s",
    async (field) => {
      const db = mockDatabase();
      delete db.metadata[0]![field];
      await expect(
        db.executor.inspect((await loadIntegrations())[0]!, true),
      ).rejects.toThrow("METADATA_UNRESOLVED");
      expect(db.pool.close).toHaveBeenCalledOnce();
    },
  );
  it("rejects non-contiguous metadata ordinals", async () => {
    const db = mockDatabase();
    db.metadata[0]!.column_ordinal = 2;
    await expect(
      db.executor.inspect((await loadIntegrations())[0]!, true),
    ).rejects.toThrow("METADATA_COLUMN_ORDER");
  });
});

describe("pending inspection artifacts", () => {
  it("saves immutable candidates with exact schema hash, no automatic approval and every adapter blocker", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "get-employes-inspection-"),
    );
    directories.push(directory);
    const c = (await loadIntegrations())[0]!;
    const first = await saveInspection(c, fixtureSchema, directory);
    const original = await readFile(first.file, "utf8");
    const second = await saveInspection(c, fixtureSchema, directory);
    expect(first.file).not.toBe(second.file);
    expect(await readFile(first.file, "utf8")).toBe(original);
    const artifact = JSON.parse(original);
    expect(artifact.status).toBe("pending");
    expect(artifact.schemaHash).toBe(hash(canonical(fixtureSchema)));
    expect(artifact.adapterReview.compatible).toBe(false);
    expect(artifact.adapterReview.issues).toHaveLength(2);
    expect(artifact.source.procedure).toBe(c.procedure);
    expect(c.authorization).toBe("pending");
  });
  it("blocks varchar with missing or unverified collation rather than assuming its encoding", () => {
    const s = structuredClone(fixtureSchema);
    s.columns[0]!.sqlType = "varchar";
    s.columns[0]!.collation = null;
    expect(new SqlExecutor().losslessIssues(s)).toContainEqual({
      column: "cod_empresa",
      sqlType: "varchar",
      reason: "SQL_ENCODING_NOT_VERIFIED",
    });
  });
});

describe("sanitized SQL connection diagnostics", () => {
  it.each([
    ["ECONNREFUSED", "SQL_TCP_CONNECTION_REFUSED"],
    ["ENOTFOUND", "SQL_DNS_LOOKUP_FAILED"],
    ["EHOSTUNREACH", "SQL_NETWORK_UNREACHABLE"],
    ["ETIMEDOUT", "SQL_CONNECTION_TIMEOUT"],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "SQL_TLS_CA_UNTRUSTED"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "SQL_TLS_HOSTNAME_MISMATCH"],
    ["CERT_HAS_EXPIRED", "SQL_TLS_CERTIFICATE_DATE_INVALID"],
  ])(
    "classifies nested %s without revealing driver details",
    (code, expected) => {
      const error = Object.assign(new Error("sensitive endpoint/account"), {
        code: "ESOCKET",
        originalError: new Error("details", {
          cause: new AggregateError([
            Object.assign(new Error("secret"), { code }),
          ]),
        }),
      });
      expect(connectionErrorCode(error)).toBe(expected);
    },
  );
  it("handles cyclic or unknown error objects safely", () => {
    const error: { code: string; cause?: unknown } = { code: "private-value" };
    error.cause = error;
    expect(connectionErrorCode(error)).toBe("SQL_CONNECTION_FAILED");
  });
});

describe("offline SSMS metadata export", () => {
  async function exported() {
    const integration = (await loadIntegrations())[0]!;
    const document = {
      exportVersion: 1,
      integrationId: integration.id,
      database: integration.database,
      procedure: integration.procedure,
      method: ssmsMetadataMethod,
      metadata: mockDatabase().metadata,
    };
    return { integration, document };
  }
  it("uses the same schema validation as direct SQL and strips SQL type size annotations", async () => {
    const { integration, document } = await exported();
    document.metadata[0]!.system_type_name = "nvarchar(128)";
    expect(schemaFromExport(document, integration).columns).toEqual(
      fixtureSchema.columns,
    );
    expect(integration.authorization).toBe("pending");
  });
  it("rejects a different integration, procedure or database", async () => {
    const { integration, document } = await exported();
    for (const changes of [
      { integrationId: "diamond-bridge-altas-bajas" },
      { procedure: "dbo.other" },
      { database: "master" },
    ])
      expect(() =>
        schemaFromExport({ ...document, ...changes }, integration),
      ).toThrow();
  });
  it("rejects aliases and SQL metadata errors without inferring types", async () => {
    const { integration, document } = await exported();
    document.metadata[0]!.user_type_name = "custom_alias";
    expect(() => schemaFromExport(document, integration)).toThrow(
      "ALIAS_TYPE_ADAPTER_REQUIRED",
    );
    document.metadata[0]!.user_type_name = null;
    document.metadata[0]!.error_number = 11514;
    expect(() => schemaFromExport(document, integration)).toThrow(
      "METADATA_UNRESOLVED",
    );
  });
  it.each(["utf8", "utf16le"] as const)(
    "imports %s files and hashes the original bytes without credentials",
    async (encoding) => {
      const { integration, document } = await exported();
      vi.stubEnv("SQL_HOST", "");
      vi.stubEnv("SQL_PASSWORD", "");
      const directory = await mkdtemp(
        path.join(os.tmpdir(), "get-employes-import-"),
      );
      directories.push(directory);
      const file = path.join(directory, "metadata.json");
      const bytes = Buffer.from("\uFEFF" + JSON.stringify(document), encoding);
      await writeFile(file, bytes);
      const imported = await readMetadataExport(file, integration);
      expect(imported.inputHash).toBe(hash(bytes));
      expect(imported.schema.columns).toEqual(fixtureSchema.columns);
      const saved = await saveInspection(
        integration,
        imported.schema,
        directory,
        { method: ssmsMetadataMethod, inputHash: imported.inputHash },
      );
      const candidate = JSON.parse(await readFile(saved.file, "utf8"));
      expect(candidate.status).toBe("pending");
      expect(candidate.source).toMatchObject({
        method: ssmsMetadataMethod,
        inputHash: hash(bytes),
      });
    },
  );
  it("rejects truncated exports, grid headers and oversized files", async () => {
    const { integration } = await exported();
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "get-employes-invalid-import-"),
    );
    directories.push(directory);
    const file = path.join(directory, "metadata.json");
    await writeFile(file, 'ColumnName\n{"metadata":');
    await expect(readMetadataExport(file, integration)).rejects.toThrow(
      "METADATA_EXPORT_JSON_INVALID",
    );
    await writeFile(file, " ".repeat(262145));
    await expect(readMetadataExport(file, integration)).rejects.toThrow(
      "METADATA_EXPORT_SIZE",
    );
  });
});

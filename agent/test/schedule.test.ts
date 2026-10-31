import { describe, expect, it } from "vitest";
import { loadIntegrations } from "../src/config.js";
import { fixtureSchema } from "../src/fixture.js";
import { assessSchedule } from "../src/schedule.js";

const profile = {
  serverEnv: "SQL_HOST",
  userEnv: "SQL_USER",
  passwordEnv: "SQL_PASSWORD",
  portEnv: "SQL_PORT",
};
const env = {
  API_BASE_URL: "https://receiver.example.invalid",
  API_INGEST_TOKEN: "synthetic-token",
  SPOOL_KEY: Buffer.alloc(32, 1).toString("base64"),
  SQL_HOST: "sql.example.invalid",
  SQL_USER: "synthetic-user",
  SQL_PASSWORD: "synthetic-password",
};
const safeSchema = {
  version: "synthetic-schedule",
  columns: fixtureSchema.columns.map((c) => ({
    ...c,
    sqlType: "nvarchar",
    maxLength: 256,
    precision: 0,
    scale: 0,
    collation: "Latin1_General_100_CI_AS_SC",
  })),
};

describe("scheduled synchronization readiness", () => {
  it("allows configured production execution without probing SQL or HTTP", async () => {
    const c = {
      ...(await loadIntegrations())[0]!,
      authorization: "approved" as const,
      publicationEnabled: true,
    };
    expect(
      assessSchedule(
        c,
        { status: "approved", schema: safeSchema },
        profile,
        env,
      ),
    ).toEqual({ ready: true, blockers: [], adapterBlockers: 0 });
  });

  it("keeps a pending schema and unsupported conversions blocked even with credentials", async () => {
    const c = (await loadIntegrations())[0]!;
    const result = assessSchedule(
      c,
      { status: "pending", schema: null },
      profile,
      env,
      fixtureSchema,
    );
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual([
      "INTEGRATION_NOT_APPROVED",
      "PUBLICATION_DISABLED",
      "SCHEMA_APPROVAL_REQUIRED",
      "LOSSLESS_ADAPTER_REQUIRED",
    ]);
    expect(result.adapterBlockers).toBe(2);
    expect(JSON.stringify(result)).not.toContain(env.SQL_PASSWORD);
    expect(JSON.stringify(result)).not.toContain(env.API_INGEST_TOKEN);
  });

  it("rejects loopback simulation configuration, missing secrets and invalid ports for live jobs", async () => {
    const c = {
      ...(await loadIntegrations())[0]!,
      authorization: "approved" as const,
      publicationEnabled: true,
    };
    const result = assessSchedule(
      c,
      { status: "approved", schema: safeSchema },
      profile,
      {
        ...env,
        API_BASE_URL: "http://127.0.0.1:8000",
        API_INGEST_TOKEN: "",
        SPOOL_KEY: "",
        SQL_PASSWORD: "",
        SQL_PORT: "70000",
      },
    );
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual([
      "LIVE_API_HTTPS_REQUIRED",
      "API_TOKEN_MISSING",
      "SPOOL_KEY_INVALID",
      "SQL_SECRET_MISSING",
      "SQL_PORT_INVALID",
    ]);
  });

  it("rejects disabled integrations, malformed approved schemas and credentials in URLs", async () => {
    const c = {
      ...(await loadIntegrations())[0]!,
      enabled: false,
      authorization: "approved" as const,
      publicationEnabled: true,
    };
    for (const schema of [null, { columns: [] }]) {
      expect(
        assessSchedule(c, { status: "approved", schema }, profile, {
          ...env,
          API_BASE_URL: "https://user:pass@receiver.example.invalid",
        }).blockers,
      ).toEqual([
        "INTEGRATION_DISABLED",
        "SCHEMA_CONFIG_INVALID",
        "LIVE_API_HTTPS_REQUIRED",
      ]);
    }
  });
});

import { readFile } from "node:fs/promises";
import path from "node:path";
import { root, type Integration } from "./config.js";
import { validateSchema } from "./contract.js";
import { SqlExecutor } from "./sql.js";

type Manifest = { status?: string; schema?: unknown; candidate?: string };
type Profile = {
  serverEnv: string;
  userEnv: string;
  passwordEnv: string;
  portEnv: string;
};

// Offline checks only: no SQL connection or HTTP request is made here.
export function assessSchedule(
  c: Integration,
  manifest: Manifest,
  profile: Profile,
  env: NodeJS.ProcessEnv,
  candidateSchema?: unknown,
) {
  const blockers: string[] = [];
  if (!c.enabled) blockers.push("INTEGRATION_DISABLED");
  if (c.authorization !== "approved") blockers.push("INTEGRATION_NOT_APPROVED");
  if (!c.publicationEnabled) blockers.push("PUBLICATION_DISABLED");
  if (manifest.status !== "approved") blockers.push("SCHEMA_APPROVAL_REQUIRED");
  let adapterBlockers = 0;
  const schema = manifest.schema ?? candidateSchema;
  if (schema) {
    try {
      adapterBlockers = new SqlExecutor().losslessIssues(
        validateSchema(schema),
        c.extractionAdapter,
      ).length;
      if (adapterBlockers) blockers.push("LOSSLESS_ADAPTER_REQUIRED");
    } catch {
      blockers.push("SCHEMA_CONFIG_INVALID");
    }
  } else if (manifest.status === "approved") {
    blockers.push("SCHEMA_CONFIG_INVALID");
  }
  try {
    const url = new URL(env.API_BASE_URL ?? "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      blockers.push("LIVE_API_HTTPS_REQUIRED");
  } catch {
    blockers.push("LIVE_API_HTTPS_REQUIRED");
  }
  if (!env[c.secrets.apiToken]) blockers.push("API_TOKEN_MISSING");
  if (Buffer.from(env[c.secrets.spoolKey] ?? "", "base64").length !== 32)
    blockers.push("SPOOL_KEY_INVALID");
  if (
    [profile.serverEnv, profile.userEnv, profile.passwordEnv].some(
      (key) => !env[key],
    )
  )
    blockers.push("SQL_SECRET_MISSING");
  const port = Number(env[profile.portEnv] ?? 1433);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    blockers.push("SQL_PORT_INVALID");

  return { ready: blockers.length === 0, blockers, adapterBlockers };
}

export async function scheduleReadiness(c: Integration) {
  const manifest = JSON.parse(
    await readFile(path.resolve(root(), c.schema), "utf8"),
  ) as Manifest;
  const candidate = manifest.candidate
    ? (JSON.parse(
        await readFile(path.resolve(root(), manifest.candidate), "utf8"),
      ) as Manifest)
    : undefined;
  const profile = (await new SqlExecutor().profiles())[c.profile];
  if (!profile) throw new Error("SQL_PROFILE_MISSING");
  return assessSchedule(c, manifest, profile, process.env, candidate?.schema);
}

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { canonical, hash, validateSchema, type Schema } from "./contract.js";
export const registry: Record<string, string> = {
  "casablanca-altas-bajas": "[MarcacionesCB].[dbo].[spListarAltas_Bajas_Csb]",
  "diamond-bridge-altas-bajas":
    "[MarcacionesCB].[dbo].[spListarAltas_Bajas_DB_Prueba]",
};
export const integrationValidator = z
  .object({
    id: z.enum(["casablanca-altas-bajas", "diamond-bridge-altas-bajas"]),
    company: z.string().min(1),
    enabled: z.boolean(),
    authorization: z.enum(["pending", "approved", "pending-company-code"]),
    procedure: z.string(),
    database: z.literal("MarcacionesCB"),
    profile: z.literal("private-lan"),
    extractionAdapter: z.enum(["tedious", "dotnet"]).default("tedious"),
    parameters: z.array(z.never()),
    mode: z.literal("ROLLING_WINDOW_CAPTURE"),
    schema: z.string(),
    dataset: z.string(),
    publicationEnabled: z.boolean(),
    emptyPolicy: z.enum(["block", "allow-approved"]),
    limits: z
      .object({
        maxRows: z.number().int().positive(),
        maxBytes: z.number().int().positive(),
        batchRows: z.number().int().positive().max(5000),
        batchBytes: z.number().int().positive().max(2097152),
      })
      .strict(),
    schedule: z
      .object({
        everyMinutes: z.number().int().min(1).max(1440),
        timezone: z.literal("America/Lima"),
        maxMinutes: z.number().int().positive().max(1440),
      })
      .strict(),
    timeoutMs: z.number().int().positive().max(3600000),
    retry: z
      .object({
        attempts: z.number().int().min(1).max(8),
        baseDelayMs: z.number().int().min(1).max(60000),
      })
      .strict(),
    secrets: z
      .object({
        apiToken: z.string().regex(/^[A-Z_]+$/),
        spoolKey: z.string().regex(/^[A-Z_]+$/),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.procedure !== registry[v.id])
      ctx.addIssue({ code: "custom", message: "UNAUTHORIZED_PROCEDURE" });
    if (v.id === "diamond-bridge-altas-bajas" && v.publicationEnabled)
      ctx.addIssue({ code: "custom", message: "COMPANY_CODE_PENDING" });
    if (v.publicationEnabled && v.authorization !== "approved")
      ctx.addIssue({ code: "custom", message: "APPROVAL_REQUIRED" });
  });
export type Integration = z.infer<typeof integrationValidator>;
export function root(): string {
  return path.resolve(import.meta.dirname, "..", "..");
}
export async function loadIntegrations(): Promise<Integration[]> {
  const dir = path.join(root(), "config/integrations");
  const result = await Promise.all(
    (await readdir(dir))
      .filter((n) => n.endsWith(".yaml"))
      .sort()
      .map(async (f) =>
        applyLocalActivation(
          integrationValidator.parse(
            YAML.parse(await readFile(path.join(dir, f), "utf8")),
          ),
        ),
      ),
  );
  if (new Set(result.map((i) => i.id)).size !== result.length)
    throw new Error("DUPLICATE_INTEGRATION");
  return result;
}
export async function applyLocalActivation(
  c: Integration,
  directory = root(),
): Promise<Integration> {
  const activationFile = path.join(
    directory,
    ".local/activation",
    c.id + ".json",
  );
  let raw: string;
  try {
    raw = await readFile(activationFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return c;
    throw error;
  }
  if (c.id !== "casablanca-altas-bajas")
    throw new Error("COMPANY_CODE_PENDING");
  const activation = z
    .object({ schemaHash: z.string().regex(/^[0-9a-f]{64}$/) })
    .strict()
    .parse(JSON.parse(raw));
  const schemaPath = ".local/approved/" + c.id + ".json";
  const approved = JSON.parse(
    await readFile(path.join(directory, schemaPath), "utf8"),
  );
  const schema = validateSchema(approved.schema);
  if (
    approved.status !== "approved" ||
    approved.integrationId !== c.id ||
    approved.schemaHash !== activation.schemaHash ||
    hash(canonical(schema)) !== activation.schemaHash
  )
    throw new Error("LOCAL_ACTIVATION_INVALID");
  return integrationValidator.parse({
    ...c,
    schema: schemaPath,
    authorization: "approved",
    publicationEnabled: true,
  });
}
export async function approvedSchema(c: Integration): Promise<Schema> {
  const manifest = JSON.parse(
    await readFile(path.resolve(root(), c.schema), "utf8"),
  ) as { status: string; schema: unknown };
  if (manifest.status !== "approved")
    throw new Error("SCHEMA_APPROVAL_REQUIRED");
  return validateSchema(manifest.schema);
}
export function requireLive(c: Integration): void {
  if (!c.enabled || c.authorization !== "approved")
    throw new Error("INTEGRATION_NOT_APPROVED");
}

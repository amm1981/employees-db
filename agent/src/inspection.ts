import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { type Integration, registry, root } from "./config.js";
import { canonical, hash, validateSchema, type Schema } from "./contract.js";
import { SqlExecutor } from "./sql.js";
import type { ssmsMetadataMethod } from "./metadata.js";

export async function saveInspection(
  integration: Integration,
  schema: Schema,
  directory = path.join(root(), "contracts/pending"),
  provenance: {
    method?: "sys.sp_describe_first_result_set" | typeof ssmsMetadataMethod;
    inputHash?: string;
    certificateValidation?: "verified" | "not-verified-user-authorized";
  } = {},
): Promise<{ file: string; schemaHash: string; blockers: number }> {
  if (registry[integration.id] !== integration.procedure)
    throw new Error("UNAUTHORIZED_PROCEDURE");
  const verified = validateSchema(schema);
  const issues = new SqlExecutor().losslessIssues(verified);
  const schemaHash = hash(canonical(verified));
  const inspectionId = randomUUID();
  const document = {
    status: "pending",
    inspectionId,
    inspectedAt: new Date().toISOString(),
    integrationId: integration.id,
    source: {
      database: integration.database,
      procedure: integration.procedure,
      method: provenance.method ?? "sys.sp_describe_first_result_set",
      ...(provenance.inputHash ? { inputHash: provenance.inputHash } : {}),
      ...(provenance.certificateValidation
        ? { certificateValidation: provenance.certificateValidation }
        : {}),
    },
    schemaHash,
    schema: verified,
    adapterReview: { compatible: issues.length === 0, issues },
  };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") {
    const user = execFileSync("whoami", [], { encoding: "utf8" }).trim();
    execFileSync(
      "icacls",
      [
        path.resolve(directory),
        "/inheritance:r",
        "/grant:r",
        `${user}:(OI)(CI)F`,
      ],
      { stdio: "ignore" },
    );
  }
  const file = path.join(directory, `${integration.id}-${inspectionId}.json`);
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(document, null, 2) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { file, schemaHash, blockers: issues.length };
}

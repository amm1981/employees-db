import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { registry, type Integration } from "./config.js";
import { hash, validateSchema, type Schema } from "./contract.js";

export const ssmsMetadataMethod =
  "sys.dm_exec_describe_first_result_set_for_object" as const;
const flag = z.union([z.boolean(), z.literal(0), z.literal(1)]);
const metadataValidator = z
  .array(
    z
      .object({
        column_ordinal: z.number().int().positive(),
        is_hidden: flag,
        name: z.string().min(1),
        system_type_name: z.string().min(1),
        is_nullable: flag,
        max_length: z.number().int(),
        precision: z.number().int(),
        scale: z.number().int(),
        collation_name: z.string().nullable(),
        user_type_name: z.string().nullable(),
        error_number: z.number().nullable().optional(),
      })
      .passthrough(),
  )
  .min(1)
  .max(256);

export function schemaFromMetadata(value: unknown): Schema {
  const result = metadataValidator.safeParse(value);
  if (!result.success) throw new Error("METADATA_UNRESOLVED");
  const columns = result.data
    .filter((r) => !r.is_hidden)
    .map((r, index) => {
      if (r.error_number) throw new Error("METADATA_UNRESOLVED");
      if (r.column_ordinal !== index + 1)
        throw new Error("METADATA_COLUMN_ORDER");
      if (r.user_type_name !== null)
        throw new Error("ALIAS_TYPE_ADAPTER_REQUIRED");
      return {
        name: r.name,
        sqlType: r.system_type_name.split("(")[0]!,
        nullable: Boolean(r.is_nullable),
        maxLength: r.max_length,
        precision: r.precision,
        scale: r.scale,
        collation: r.collation_name,
      };
    });
  return validateSchema({ version: "candidate-1", columns });
}

const exportValidator = z
  .object({
    exportVersion: z.literal(1),
    integrationId: z.string(),
    database: z.literal("MarcacionesCB"),
    procedure: z.string(),
    method: z.literal(ssmsMetadataMethod),
    metadata: z.unknown(),
  })
  .strict();
export function schemaFromExport(
  value: unknown,
  integration: Integration,
): Schema {
  const result = exportValidator.safeParse(value);
  if (!result.success) throw new Error("METADATA_EXPORT_FORMAT");
  const item = result.data;
  if (
    item.integrationId !== integration.id ||
    item.procedure !== registry[integration.id] ||
    item.procedure !== integration.procedure
  )
    throw new Error("METADATA_EXPORT_SOURCE_MISMATCH");
  return schemaFromMetadata(item.metadata);
}

export async function readMetadataExport(
  file: string,
  integration: Integration,
): Promise<{ schema: Schema; inputHash: string }> {
  const size = (await stat(file)).size;
  if (size < 2 || size > 262144) throw new Error("METADATA_EXPORT_SIZE");
  const data = await readFile(file);
  if (data.length > 262144) throw new Error("METADATA_EXPORT_SIZE");
  let value: unknown;
  try {
    const text =
      data[0] === 0xff && data[1] === 0xfe
        ? data.subarray(2).toString("utf16le")
        : new TextDecoder("utf-8", { fatal: true }).decode(data);
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("METADATA_EXPORT_JSON_INVALID");
  }
  return {
    schema: schemaFromExport(value, integration),
    inputHash: hash(data),
  };
}

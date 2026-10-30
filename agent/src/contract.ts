import { createHash } from "node:crypto";
import { z } from "zod";

export const names = [
  "cod_empresa",
  "cod_categoria",
  "cod_trabajador",
  "apellido_pat",
  "apellido_mat",
  "Nombres",
  "tipo_documento",
  "email",
  "sexo",
  "ID_EstadoCivil",
  "cod_nacionalidad",
  "nacionalidad",
  "tipo_trabajador",
  "reloj",
  "tipo_asistencia",
  "Fnacimiento",
  "cod_proyecto",
  "area",
  "area_desc",
  "ccosto",
  "uni_negocio",
  "planilla",
  "id_planilla",
  "planilla_desc",
  "fotocheck",
  "cod_sede",
  "sede",
  "cod_cargo",
  "cargo",
  "cod_funcion",
  "funcion",
  "fingreso",
  "fcese",
  "estado",
  "updpersonal",
  "updagenda",
  "updu",
] as const;
export const columnSchema = z
  .object({
    name: z.string(),
    sqlType: z.string(),
    nullable: z.boolean(),
    maxLength: z.number().int(),
    precision: z.number().int(),
    scale: z.number().int(),
    collation: z.string().nullable(),
  })
  .strict();
export const schemaValidator = z
  .object({
    version: z.string().min(1),
    columns: z.array(columnSchema).length(37),
  })
  .strict();
export type Schema = z.infer<typeof schemaValidator>;
export type Cell = string | null;
export type Row = Cell[];
// Canonical v1: all scalar SQL values use strings or null; no JSON numbers in rows.
// Structural object keys sorted recursively (ASCII protocol keys); arrays retain order.
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
      .join(",") +
    "}"
  );
}
export const hash = (s: string | Buffer): string =>
  createHash("sha256").update(s).digest("hex");
export function validateSchema(s: unknown): Schema {
  const parsed = schemaValidator.parse(s);
  if (parsed.columns.some((c, i) => c.name !== names[i]))
    throw new Error("SCHEMA_COLUMN_ORDER");
  const supported =
    /^(n?varchar|n?char|text|ntext|int|smallint|tinyint|bigint|bit|decimal|numeric|money|smallmoney|float|real|date|datetime|smalldatetime|datetime2|datetimeoffset|time|uniqueidentifier|binary|varbinary|image)$/i;
  if (parsed.columns.some((c) => !supported.test(c.sqlType)))
    throw new Error("SCHEMA_UNSUPPORTED_TYPE");
  return parsed;
}
export function validateRow(row: unknown, s: Schema): asserts row is Row {
  if (!Array.isArray(row) || row.length !== s.columns.length)
    throw new Error("ROW_COLUMNS");
  s.columns.forEach((c, i) => {
    const v: unknown = row[i];
    if (v === null) {
      if (!c.nullable) throw new Error("ROW_NULL");
      return;
    }
    if (typeof v !== "string") throw new Error("ROW_NON_STRING");
    if (!v.isWellFormed()) throw new Error("ROW_UNICODE");
    const t = c.sqlType.toLowerCase();
    if (/^(n?varchar|n?char|binary|varbinary)$/.test(t) && c.maxLength >= 0) {
      // SQL max_length is bytes. varchar collation bytes require the approved encoding adapter.
      const n = /^n/.test(t)
        ? Buffer.byteLength(v, "utf16le")
        : /binary/.test(t)
          ? v.length / 2
          : Buffer.byteLength(v, "utf8");
      if (n > c.maxLength) throw new Error("ROW_SIZE");
    }
    if (/^(int|smallint|tinyint|bigint)$/.test(t)) {
      if (!/^-?\d+$/.test(v)) throw new Error("ROW_INTEGER");
      const bounds: Record<string, [bigint, bigint]> = {
        tinyint: [0n, 255n],
        smallint: [-32768n, 32767n],
        int: [-2147483648n, 2147483647n],
        bigint: [-9223372036854775808n, 9223372036854775807n],
      };
      const b = bounds[t]!;
      if (BigInt(v) < b[0] || BigInt(v) > b[1])
        throw new Error("ROW_INTEGER_RANGE");
    }
    if (t === "bit" && !/^[01]$/.test(v)) throw new Error("ROW_BIT");
    if (/^(decimal|numeric|money|smallmoney)$/.test(t)) {
      if (!/^-?\d+(\.\d+)?$/.test(v)) throw new Error("ROW_DECIMAL");
      const [whole, fraction = ""] = v.replace(/^-/, "").split(".");
      if (
        fraction.length > c.scale ||
        whole!.replace(/^0+/, "").length > c.precision - c.scale
      )
        throw new Error("ROW_DECIMAL_RANGE");
    }
    if (
      /^(float|real)$/.test(t) &&
      (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v) || !Number.isFinite(Number(v)))
    )
      throw new Error("ROW_FLOAT");
    if (
      t === "uniqueidentifier" &&
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v)
    )
      throw new Error("ROW_UUID");
    if (/^(varbinary|binary|image)$/.test(t) && !/^([0-9a-f]{2})*$/.test(v))
      throw new Error("ROW_BINARY");
    if (
      /^(date|datetime|smalldatetime|datetime2|datetimeoffset|time)$/.test(t)
    ) {
      const pattern =
        t === "date"
          ? /^\d{4}-\d{2}-\d{2}$/
          : t === "time"
            ? /^\d{2}:\d{2}:\d{2}(\.\d{1,7})?$/
            : t === "datetimeoffset"
              ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?[+-]\d{2}:\d{2}$/
              : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?$/;
      if (!pattern.test(v)) throw new Error("ROW_DATE");
      if (t !== "time") {
        const [year, month, day] = v.slice(0, 10).split("-").map(Number) as [
          number,
          number,
          number,
        ];
        const days = [
          31,
          year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
          31,
          30,
          31,
          30,
          31,
          31,
          30,
          31,
          30,
          31,
        ];
        if (
          year < 1 ||
          month < 1 ||
          month > 12 ||
          day < 1 ||
          day > days[month - 1]!
        )
          throw new Error("ROW_DATE_RANGE");
        if (t === "datetime" && year < 1753) throw new Error("ROW_DATE_RANGE");
        if (
          t === "smalldatetime" &&
          (v.slice(0, 10) < "1900-01-01" || v.slice(0, 10) > "2079-06-06")
        )
          throw new Error("ROW_DATE_RANGE");
      }
      if (t !== "date") {
        const time = t === "time" ? v : v.slice(11),
          parts = time.slice(0, 8).split(":").map(Number);
        if (parts[0]! > 23 || parts[1]! > 59 || parts[2]! > 59)
          throw new Error("ROW_TIME_RANGE");
        const fraction = time.match(/\.(\d+)/)?.[1] ?? "";
        if (
          ["datetime2", "time", "datetimeoffset"].includes(t) &&
          fraction.length > c.scale
        )
          throw new Error("ROW_TIME_SCALE");
        if (t === "datetimeoffset") {
          const [h, m] = v.slice(-5).split(":").map(Number);
          if (h! > 14 || m! > 59 || (h === 14 && m !== 0))
            throw new Error("ROW_OFFSET");
        }
      }
    }
  });
}

import { names, type Schema, type Row } from "./contract.js";
import type { Source } from "./spool.js";
// Synthetic schema only. No claim about actual SQL types in either stored procedure.
export const fixtureSchema: Schema = {
  version: "fixture-v1",
  columns: names.map((name) => ({
    name,
    sqlType: "nvarchar",
    nullable: true,
    maxLength: 256,
    precision: 0,
    scale: 0,
    collation: "Latin1_General_100_CI_AS_SC",
  })),
};
fixtureSchema.columns[12] = {
  name: "tipo_trabajador",
  sqlType: "decimal",
  nullable: true,
  maxLength: 17,
  precision: 38,
  scale: 18,
  collation: null,
};
fixtureSchema.columns[15] = {
  name: "Fnacimiento",
  sqlType: "date",
  nullable: true,
  maxLength: 3,
  precision: 10,
  scale: 0,
  collation: null,
};
fixtureSchema.columns[36] = {
  name: "updu",
  sqlType: "datetime2",
  nullable: true,
  maxLength: 8,
  precision: 27,
  scale: 7,
  collation: null,
};
export function fixtureRows(diamond = false): Row[] {
  const row: Row = names.map(() => null);
  row[0] = diamond ? null : "99";
  row[2] = "00001234";
  row[3] = "Ficticio";
  row[4] = "";
  row[5] = "Prueba ñ 漢字 😀";
  row[7] = "fixture@example.invalid";
  row[12] = "12345678901234567890.123456789012345678";
  row[15] = "1990-01-02";
  row[33] = "A";
  row[36] = "2026-10-26T12:34:56.1234567";
  return [row, [...row], [...row].map((v, i) => (i === 2 ? "00005678" : v))];
}
export function fixtureSource(
  diamond = false,
  rows: Row[] = fixtureRows(diamond),
): Source {
  return {
    schema: fixtureSchema,
    rows: (async function* () {
      for (const row of rows) yield row;
    })(),
  };
}

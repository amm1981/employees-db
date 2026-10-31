import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { decodeExactRows } from "../src/dotnet-source.js";
import { SqlExecutor } from "../src/sql.js";
import { canonical, validateRow } from "../src/contract.js";
import { fixtureRows, fixtureSchema } from "../src/fixture.js";
import { root } from "../src/config.js";
import { varcharBytes } from "../src/encoding.js";

async function collect(wire: string, chunkSize = 9) {
  const bytes = Buffer.from(wire);
  const stream = (async function* () {
    for (let i = 0; i < bytes.length; i += chunkSize)
      yield bytes.subarray(i, i + chunkSize);
  })();
  const rows = [];
  for await (const row of decodeExactRows(stream, fixtureSchema, 100000))
    rows.push(row);
  return rows;
}
const rowWire = JSON.stringify({ kind: "row", values: fixtureRows()[0] });
describe("exact SQL bridge", () => {
  it("preserves duplicate rows, Unicode across byte boundaries and decimal/date text", async () => {
    const wire =
      '{"kind":"ready"}\n' +
      rowWire +
      "\n" +
      rowWire +
      '\n{"kind":"complete","count":2}\n';
    expect(await collect(wire, 1)).toEqual([
      fixtureRows()[0],
      fixtureRows()[0],
    ]);
  });
  it.each([
    '{"kind":"ready"}\n' + rowWire + "\n",
    '{"kind":"ready"}\n' + rowWire + '\n{"kind":"complete","count":0}\n',
    rowWire + '\n{"kind":"complete","count":1}\n',
    '{"kind":"ready"}\n{"kind":"complete","count":0}\n' + rowWire + "\n",
    '{"kind":"ready"}\n{"kind":"error","code":"MULTIPLE_RECORDSETS"}\n',
  ])(
    "rejects incomplete, inconsistent or multi-result captures",
    async (wire) => {
      await expect(collect(wire)).rejects.toThrow();
    },
  );
  it("accepts inspected CASABLANCA types only through the exact adapter", async () => {
    const reviewed = JSON.parse(
      await readFile(
        path.join(root(), "contracts/schemas/casablanca.reviewed-v1.json"),
        "utf8",
      ),
    );
    expect(new SqlExecutor().losslessIssues(reviewed.schema)).toHaveLength(34);
    expect(new SqlExecutor().losslessIssues(reviewed.schema, "dotnet")).toEqual(
      [],
    );
    const altered = structuredClone(reviewed.schema);
    altered.columns[0].collation = "unknown-code-page";
    expect(new SqlExecutor().losslessIssues(altered, "dotnet")).toHaveLength(1);
  });
  it("preserves safe bridge diagnostics and discards arbitrary error text", async () => {
    await expect(
      collect(
        '{"kind":"error","code":"SQL_BRIDGE_READ_CELL_0_INVALID_OPERATION"}\n',
      ),
    ).rejects.toThrow("SQL_BRIDGE_READ_CELL_0_INVALID_OPERATION");
    await expect(
      collect('{"kind":"error","code":"password=synthetic-private-value"}\n'),
    ).rejects.toThrow("SQL_EXTRACTION_FAILED");
  });
  it("keeps the inspected Diamond contract distinct and preserves its nullable company code", async () => {
    const candidate = JSON.parse(
      await readFile(
        path.join(root(), "contracts/schemas/diamond-bridge.candidate-1.json"),
        "utf8",
      ),
    );
    expect(candidate.integrationId).toBe("diamond-bridge-altas-bajas");
    expect(candidate.status).not.toBe("approved");
    expect(candidate.schema.columns[0]).toMatchObject({
      name: "cod_empresa",
      sqlType: "varchar",
      maxLength: 2,
      nullable: true,
    });
    expect(
      new SqlExecutor().losslessIssues(candidate.schema, "dotnet"),
    ).toEqual([]);
  });
  it("counts CP1252 bytes rather than UTF8 and rejects unrepresentable text", () => {
    expect(varcharBytes("ñá € —", "Modern_Spanish_CI_AS")).toBe(6);
    expect(() => varcharBytes("漢", "Modern_Spanish_CI_AS")).toThrow(
      "ROW_ENCODING",
    );
    const schema = structuredClone(fixtureSchema);
    schema.columns[2] = {
      ...schema.columns[2]!,
      sqlType: "varchar",
      maxLength: 1,
      collation: "SQL_Latin1_General_CP1_CI_AS",
    };
    const row = fixtureRows()[0]!.slice();
    row[2] = "€";
    expect(() => validateRow(row, schema)).not.toThrow();
    row[2] = "áá";
    expect(() => validateRow(row, schema)).toThrow("ROW_SIZE");
    row[2] = "😀";
    expect(() => validateRow(row, schema)).toThrow("ROW_ENCODING");
  });
});

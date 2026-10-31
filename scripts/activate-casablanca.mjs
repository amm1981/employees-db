import { config as envConfig } from "dotenv";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { root, loadIntegrations } from "../agent/dist/config.js";
import { canonical, hash, validateSchema } from "../agent/dist/contract.js";
import { SqlExecutor } from "../agent/dist/sql.js";

try {
  if (process.platform !== "win32")
    throw new Error("WINDOWS_EXACT_READER_REQUIRED");
  envConfig({ path: path.join(root(), ".env"), quiet: true });
  const c = (await loadIntegrations()).find(
    (i) => i.id === "casablanca-altas-bajas",
  );
  if (!c || c.extractionAdapter !== "dotnet")
    throw new Error("EXACT_ADAPTER_REQUIRED");
  execFileSync(
    path.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    ),
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "RemoteSigned",
      "-File",
      path.join(root(), "scripts/windows/Test-SqlExact.ps1"),
    ],
    { windowsHide: true, stdio: "inherit" },
  );
  const document = JSON.parse(
    await readFile(
      path.join(root(), "contracts/schemas/casablanca.reviewed-v1.json"),
      "utf8",
    ),
  );
  const schema = validateSchema(document.schema);
  if (
    hash(canonical(schema)) !== document.schemaHash ||
    document.integrationId !== c.id ||
    document.status !== "reviewed"
  )
    throw new Error("REVIEWED_CONTRACT_INVALID");
  const executor = new SqlExecutor();
  executor.assertLossless(schema, "dotnet");
  const actual = await executor.inspect(c, true);
  actual.version = schema.version;
  if (canonical(actual) !== canonical(schema))
    throw new Error("SQL_SCHEMA_CHANGED");
  const local = path.join(root(), ".local");
  await mkdir(path.join(local, "approved"), { recursive: true, mode: 0o700 });
  await mkdir(path.join(local, "activation"), { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(local, "approved", c.id + ".json"),
    canonical({
      ...document,
      status: "approved",
      approvedAt: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
  await writeFile(
    path.join(local, "activation", c.id + ".json"),
    JSON.stringify({ schemaHash: document.schemaHash }),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      integration: c.id,
      schemaHash: document.schemaHash,
      msg: "local_activation_complete",
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      code: /^[A-Z][A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "ACTIVATION_FAILED",
    }),
  );
  process.exitCode = 1;
}

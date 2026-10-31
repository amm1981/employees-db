import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (Number(process.versions.node.split(".")[0]) !== 24) {
  throw new Error("NODE_24_REQUIRED");
}
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sample = await readFile(path.join(repo, ".env.example"), "utf8");
const configured = sample
  .replace(/^API_BASE_URL=.*$/m, "API_BASE_URL=https://api-employeedb.ccruces.com")
  .replace(/^AGENT_ORIGIN=.*$/m, "AGENT_ORIGIN=ti-pc-01")
  .replace(/^SPOOL_KEY=.*$/m, () => "SPOOL_KEY=" + randomBytes(32).toString("base64"));
try {
  await writeFile(path.join(repo, ".env"), configured, { flag: "wx", mode: 0o600 });
  console.log("Agent .env created. Configure SQL credentials and the VPS ingestion token locally.");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log("Existing .env preserved; no values were replaced.");
}

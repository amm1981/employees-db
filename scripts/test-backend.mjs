import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
  process.env.PHP_BIN ?? "php",
  ["artisan", "test", "--compact", ...process.argv.slice(2)],
  {
    cwd: path.join(repo, "backend"),
    stdio: "inherit",
    env: process.env,
    windowsHide: true,
  },
);
if (result.error) {
  console.error("PHP unavailable; set PHP_BIN to the PHP 8.3 executable.");
  process.exitCode = 1;
} else process.exitCode = result.status ?? 1;

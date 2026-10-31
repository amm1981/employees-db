import { spawn } from "node:child_process";
import path from "node:path";
import { root, type Integration } from "./config.js";
import { type Row, type Schema, validateRow } from "./contract.js";
import type { Source } from "./spool.js";

type Profile = {
  serverEnv: string;
  portEnv: string;
  userEnv: string;
  passwordEnv: string;
  connectionTimeoutMs: number;
  extractionTrustServerCertificate: boolean;
};

export async function* decodeExactRows(
  stream: AsyncIterable<Uint8Array>,
  schema: Schema,
  frameLimit: number,
): AsyncGenerator<Row> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "",
    ready = false,
    complete = false,
    count = 0;
  for await (const bytes of stream) {
    pending += decoder.decode(bytes, { stream: true });
    let end: number;
    while ((end = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, end).replace(/\r$/, "");
      pending = pending.slice(end + 1);
      if (!line || line.length > frameLimit || complete)
        throw new Error("SQL_BRIDGE_PROTOCOL");
      const frame = JSON.parse(line) as {
        kind?: string;
        code?: string;
        values?: unknown;
        count?: number;
      };
      if (frame.kind === "error")
        throw new Error(
          frame.code && /^[A-Z][A-Z0-9_]+$/.test(frame.code)
            ? frame.code
            : "SQL_EXTRACTION_FAILED",
        );
      if (frame.kind === "ready" && !ready) {
        ready = true;
        continue;
      }
      if (frame.kind === "row" && ready) {
        validateRow(frame.values, schema);
        count++;
        yield frame.values;
      } else if (frame.kind === "complete" && ready && frame.count === count) {
        complete = true;
      } else throw new Error("SQL_BRIDGE_PROTOCOL");
    }
    if (pending.length > frameLimit)
      throw new Error("SQL_BRIDGE_FRAME_TOO_LARGE");
  }
  pending += decoder.decode();
  if (pending.length || !complete) throw new Error("SQL_INCOMPLETE");
}

export function dotnetSource(
  c: Integration,
  schema: Schema,
  profile: Profile,
): Source {
  if (process.platform !== "win32")
    throw new Error("WINDOWS_EXACT_READER_REQUIRED");
  return {
    schema,
    rows: (async function* () {
      const executable = path.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      );
      const child = spawn(
        executable,
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-ExecutionPolicy",
          "RemoteSigned",
          "-File",
          path.join(root(), "scripts/windows/Read-SqlExact.ps1"),
        ],
        {
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
          env: process.env,
        },
      );
      // Messages from the bridge must never reach CLI logs or include row values.
      child.stderr.resume();
      let spawnError = false;
      const finished = new Promise<number | null>((resolve) => {
        child.once("error", () => {
          spawnError = true;
          resolve(null);
        });
        child.once("close", resolve);
      });
      child.stdin.on("error", () => {
        /* Process exit is checked below. */
      });
      child.stdin.end(
        JSON.stringify({
          integration: c.id,
          procedure: c.procedure,
          schema,
          serverEnv: profile.serverEnv,
          portEnv: profile.portEnv,
          userEnv: profile.userEnv,
          passwordEnv: profile.passwordEnv,
          connectionTimeoutMs: profile.connectionTimeoutMs,
          timeoutMs: c.timeoutMs,
          rowLimit: c.limits.batchBytes,
          trustServerCertificate: profile.extractionTrustServerCertificate,
        }),
      );
      try {
        yield* decodeExactRows(
          child.stdout,
          schema,
          c.limits.batchBytes * 6 + 4096,
        );
        if ((await finished) !== 0 || spawnError)
          throw new Error("SQL_BRIDGE_EXIT_FAILED");
      } finally {
        if (child.exitCode === null) child.kill();
        await finished;
      }
    })(),
  };
}

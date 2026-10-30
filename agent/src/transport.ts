import { setTimeout as delay } from "node:timers/promises";
import { canonical } from "./contract.js";
import type { Integration } from "./config.js";
import type { Spool } from "./spool.js";
export interface TransportOptions {
  baseUrl: string;
  token: string;
  attempts: number;
  baseDelayMs: number;
  timeoutMs: number;
  simulation: boolean;
  fetcher?: typeof fetch;
}
export class Transport {
  private readonly base: URL;
  constructor(private readonly o: TransportOptions) {
    this.base = new URL(o.baseUrl);
    if (
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash ||
      this.base.pathname !== "/"
    )
      throw new Error("API_URL");
    if (
      this.base.protocol !== "https:" &&
      !(
        o.simulation &&
        this.base.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(this.base.hostname)
      )
    )
      throw new Error("HTTPS_REQUIRED");
    if (!o.token) throw new Error("API_TOKEN_REQUIRED");
  }
  async request(
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<any> {
    for (let attempt = 0; attempt < this.o.attempts; attempt++) {
      let response: Response;
      try {
        response = await (this.o.fetcher ?? fetch)(
          new URL("/api/v1" + url, this.base),
          {
            method,
            redirect: "error",
            signal: AbortSignal.timeout(this.o.timeoutMs),
            headers: {
              Authorization: `Bearer ${this.o.token}`,
              "Content-Type": "application/json",
              ...headers,
            },
            ...(body === undefined ? {} : { body: canonical(body) }),
          },
        );
      } catch {
        if (attempt + 1 === this.o.attempts)
          throw new Error("NETWORK_UNAVAILABLE");
        await this.backoff(attempt);
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        await response.body?.cancel();
        if (attempt + 1 === this.o.attempts)
          throw new Error("REMOTE_RETRY_EXHAUSTED");
        await this.backoff(attempt);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP_${response.status}`);
      }
      return response.json();
    }
    throw new Error("RETRY_EXHAUSTED");
  }
  private async backoff(n: number): Promise<void> {
    await delay(
      Math.min(30000, this.o.baseDelayMs * 2 ** n) +
        Math.floor(Math.random() * this.o.baseDelayMs),
    );
  }
  async send(
    spool: Spool,
    id: string,
    c: Integration,
    publish: boolean,
  ): Promise<void> {
    const m = await spool.verify(id);
    if (
      m.integrationId !== c.id ||
      m.dataset !== c.dataset ||
      m.simulation !== this.o.simulation
    )
      throw new Error("RUN_CONFIG_MISMATCH");
    const ack = await this.request("POST", "/sync/runs", m, {
      "X-Agent-Origin": m.origin,
    });
    if (ack.runId !== id) throw new Error("ACK_RUN");
    const remote = await this.request(
      "GET",
      `/sync/runs/${id}/batches`,
      undefined,
      { "X-Agent-Origin": m.origin },
    );
    const received = new Map<number, string>(
      (remote.batches as { number: number; hash: string }[]).map((b) => [
        b.number,
        b.hash,
      ]),
    );
    for (const b of m.batches) {
      if (received.has(b.number)) {
        if (received.get(b.number) !== b.hash) throw new Error("ACK_HASH");
        continue;
      }
      const rows = JSON.parse(await spool.get(id, `batch-${b.number}.enc`));
      const a = await this.request(
        "PUT",
        `/sync/runs/${id}/batches/${b.number}`,
        { hash: b.hash, first: b.first, count: b.count, rows },
        { "X-Agent-Origin": m.origin },
      );
      if (a.number !== b.number || a.hash !== b.hash)
        throw new Error("ACK_BATCH");
      await spool.checkpoint(id, `batch_${b.number}_accepted`);
    }
    const finalized = await this.request(
      "POST",
      `/sync/runs/${id}/finalize`,
      {},
      { "X-Agent-Origin": m.origin },
    );
    if (!["finalized", "published"].includes(finalized.status))
      throw new Error("ACK_FINALIZE");
    await spool.checkpoint(id, "finalized");
    if (publish) {
      if (!m.simulation && !c.publicationEnabled)
        throw new Error("PUBLICATION_DISABLED");
      const a = await this.request(
        "POST",
        `/sync/runs/${id}/publish`,
        {},
        { "X-Agent-Origin": m.origin },
      );
      if (a.runId !== id || a.status !== "published")
        throw new Error("ACK_PUBLISH");
      await spool.checkpoint(id, "published");
    }
  }
}

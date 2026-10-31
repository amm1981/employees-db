import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyLocalActivation, loadIntegrations } from "../src/config.js";
import { canonical, hash } from "../src/contract.js";
import { fixtureSchema } from "../src/fixture.js";
const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0))
    await rm(folder, { recursive: true, force: true });
});

it("activates only a matching approved local schema and never changes the repository YAML", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "activation-test-"));
  folders.push(directory);
  const c = (await loadIntegrations())[0]!;
  expect(await applyLocalActivation(c, directory)).toEqual(c);
  await mkdir(path.join(directory, ".local/approved"), { recursive: true });
  await mkdir(path.join(directory, ".local/activation"), { recursive: true });
  const schemaHash = hash(canonical(fixtureSchema));
  await writeFile(
    path.join(directory, ".local/approved", c.id + ".json"),
    JSON.stringify({
      integrationId: c.id,
      status: "approved",
      schema: fixtureSchema,
      schemaHash,
    }),
  );
  const activation = path.join(directory, ".local/activation", c.id + ".json");
  await writeFile(activation, JSON.stringify({ schemaHash }));
  expect(await applyLocalActivation(c, directory)).toMatchObject({
    authorization: "approved",
    publicationEnabled: true,
    schema: ".local/approved/" + c.id + ".json",
  });
  expect(c.authorization).toBe("pending");
  await writeFile(activation, JSON.stringify({ schemaHash: "0".repeat(64) }));
  await expect(applyLocalActivation(c, directory)).rejects.toThrow(
    "LOCAL_ACTIVATION_INVALID",
  );
});

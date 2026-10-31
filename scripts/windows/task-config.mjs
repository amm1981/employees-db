import { config as envConfig } from "dotenv";
import path from "node:path";
import { loadIntegrations, root } from "../../agent/dist/config.js";
import { scheduleReadiness } from "../../agent/dist/schedule.js";
envConfig({ path: path.join(root(), ".env"), quiet: true });
const c = (await loadIntegrations()).find((i) => i.id === process.argv[2]);
if (!c) throw new Error("UNKNOWN_INTEGRATION");
console.log(
  JSON.stringify({
    id: c.id,
    enabled: c.enabled,
    authorization: c.authorization,
    publicationEnabled: c.publicationEnabled,
    ...c.schedule,
    readiness: await scheduleReadiness(c),
  }),
);

import { loadIntegrations } from "../../agent/dist/config.js";
const c = (await loadIntegrations()).find((i) => i.id === process.argv[2]);
if (!c) throw new Error("UNKNOWN_INTEGRATION");
console.log(
  JSON.stringify({
    id: c.id,
    enabled: c.enabled,
    authorization: c.authorization,
    publicationEnabled: c.publicationEnabled,
    ...c.schedule,
  }),
);

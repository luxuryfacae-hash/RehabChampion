import { config } from "./config.js";
import { pool } from "./db.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const app = await buildServer({ pool, hmacSecret: config.HMAC_SECRET });
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  // eslint-disable-next-line no-console
  console.log(`RehabChampion backend listening on :${config.PORT}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

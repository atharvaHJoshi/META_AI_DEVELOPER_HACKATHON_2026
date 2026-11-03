import { createApp } from "./app.js";
import { aiMode, config } from "./config.js";
import { closePool } from "./db/pool.js";

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`MIRAIWERK API listening on http://localhost:${config.port}`);
  console.log(`AI mode: ${aiMode.label}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received; shutting down.`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

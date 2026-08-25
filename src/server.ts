import { createApp, loadConfig } from "./app.js";

const config = loadConfig();
const app = createApp(config);
const server = app.listen(config.port, config.host, () => {
  console.log(`UnderSync listening on ${config.host}:${config.port} (local: http://localhost:${config.port})`);
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}; stopping UnderSync.`);
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

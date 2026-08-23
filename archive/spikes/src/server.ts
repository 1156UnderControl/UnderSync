import { createApp, loadConfig } from "./app.js";

const config = loadConfig();
const app = createApp(config);

const server = app.listen(config.port, "127.0.0.1", () => {
  console.log(`UnderSync Onshape selection spike listening at http://localhost:${config.port}`);
  console.log(`Panel URL: http://localhost:${config.port}/panel`);
  console.log(
    `OAuth configuration: ${config.clientId && config.clientSecret ? "present" : "missing (set environment variables)"}`,
  );
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}; stopping local spike.`);
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

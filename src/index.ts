import "dotenv/config";
import http from "node:http";
import { config } from "./config.js";
import { queue } from "./services/queue.js";
import * as store from "./services/store.js";
import { createApp } from "./server.js";
import { logger } from "./utils/logger.js";

const app = createApp();
const server = http.createServer(app);

queue.start();

server.listen(config.PORT, () => {
  logger.info(`REMI ingestor listening on port ${config.PORT}`);
});

function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down gracefully");
  queue.stop();
  server.close(() => {
    store.closeDb();
    logger.info("Shutdown complete");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

import express, { type NextFunction, type Request, type Response } from "express";
import pinoHttp from "pino-http";
import healthRouter from "./routes/health.js";
import statsRouter from "./routes/stats.js";
import webhookRouter from "./routes/webhook.js";
import { logger } from "./utils/logger.js";

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use(pinoHttp({ logger }));

  app.use("/webhook/messages", webhookRouter);
  app.use("/health", healthRouter);
  app.use("/stats", statsRouter);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, "Unhandled error");
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

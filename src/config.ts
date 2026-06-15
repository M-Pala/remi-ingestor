import "dotenv/config";
import os from "node:os";
import path from "node:path";

function parseIntEnv(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function parseSimulateFailureIds(): Set<string> {
  const raw = process.env.SIMULATE_FAILURE_IDS ?? "";
  if (!raw.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export const config = Object.freeze({
  PORT: parseIntEnv("PORT", 3001),
  DB_PATH: process.env.DB_PATH ?? ":memory:",
  MEDIA_DIR:
    process.env.MEDIA_DIR?.trim() ||
    path.join(os.tmpdir(), "remi-media"),
  LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
  WORKER_CONCURRENCY: parseIntEnv("WORKER_CONCURRENCY", 3),
  WORKER_RETRY_DELAY_MS: parseIntEnv("WORKER_RETRY_DELAY_MS", 500),
  WORKER_RETRY_MAX_DELAY_MS: parseIntEnv("WORKER_RETRY_MAX_DELAY_MS", 30_000),
  WORKER_MAX_RETRIES: parseIntEnv("WORKER_MAX_RETRIES", 3),
  MAX_MEDIA_ATTACHMENTS: parseIntEnv("MAX_MEDIA_ATTACHMENTS", 10),
  SIMULATE_FAILURE_IDS: parseSimulateFailureIds(),
});

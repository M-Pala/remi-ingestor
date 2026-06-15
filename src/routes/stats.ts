import { Router } from "express";
import { dedup } from "../services/dedup.js";
import { queue } from "../services/queue.js";
import * as store from "../services/store.js";

const router = Router();

router.get("/", (_req, res) => {
  const q = queue.getStats();
  res.status(200).json({
    messagesReceived: dedup.stats.webhookRequests,
    messagesProcessed: q.processed,
    duplicatesIgnored: dedup.stats.duplicatesIgnored,
    failedMessages: q.failed,
    pendingQueueDepth: q.pendingDepth,
    messagesStoredInDB: store.getStats().messagesStored,
  });
});

export default router;

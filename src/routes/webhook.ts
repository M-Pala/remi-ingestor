import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { dedup } from "../services/dedup.js";
import { deriveGroupId, normalize } from "../services/normalizer.js";
import { queue } from "../services/queue.js";
import * as store from "../services/store.js";
import type { TwilioWebhookPayload } from "../types/remi-message.js";
import { logger } from "../utils/logger.js";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  try {
    dedup.stats.recordWebhookRequest();

    const payload = req.body as TwilioWebhookPayload;

    if (!payload?.MessageSid) {
      res.status(400).json({ error: "Missing MessageSid" });
      return;
    }

    if (!payload.From?.trim()) {
      res.status(400).json({ error: "Missing From" });
      return;
    }

    const { MessageSid } = payload;

    if (dedup.hasSeen(MessageSid)) {
      dedup.stats.incrementDuplicate();
      res.status(200).json({ status: "duplicate", messageId: MessageSid });
      return;
    }

    const groupId = deriveGroupId(payload);
    const sequenceInGroup = store.nextSequenceForGroup(groupId);
    const message = normalize(payload, sequenceInGroup);

    if (config.SIMULATE_FAILURE_IDS.has(MessageSid)) {
      store.armOneShotFailure(MessageSid);
    }

    store.saveRawPayload(MessageSid, "twilio", payload);
    dedup.markPending(MessageSid);
    queue.enqueue(message);

    res.status(202).json({
      status: "accepted",
      messageId: MessageSid,
      groupId: message.groupId,
      queueDepth: queue.getStats().pendingDepth,
    });
  } catch (err) {
    logger.error({ err }, "Webhook handler error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

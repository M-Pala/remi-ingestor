import { config } from "../config.js";
import type { RemiMessage } from "../types/remi-message.js";
import { logger } from "../utils/logger.js";
import { dedup } from "./dedup.js";
import { processAllMedia } from "./media.js";
import * as store from "./store.js";

export interface QueueJob {
  message: RemiMessage;
  attempt: number;
  groupId: string;
}

export class MessageQueue {
  private readonly groupQueues = new Map<string, QueueJob[]>();
  private activeCount = 0;
  private running = false;
  private tickScheduled = false;
  private pendingDepth = 0;

  private stats = {
    enqueued: 0,
    processed: 0,
    failed: 0,
  };

  enqueue(msg: RemiMessage): void {
    const job: QueueJob = {
      message: msg,
      attempt: 1,
      groupId: msg.groupId,
    };

    const queue = this.groupQueues.get(msg.groupId) ?? [];
    queue.push(job);
    this.groupQueues.set(msg.groupId, queue);
    this.pendingDepth++;
    this.stats.enqueued++;
    this.scheduleTick();
  }

  getStats(): {
    enqueued: number;
    processed: number;
    failed: number;
    pendingDepth: number;
  } {
    return {
      ...this.stats,
      pendingDepth: this.pendingDepth,
    };
  }

  start(): void {
    this.running = true;
    this.scheduleTick();
  }

  stop(): void {
    this.running = false;
  }

  private scheduleTick(): void {
    if (!this.running || this.tickScheduled) return;
    this.tickScheduled = true;
    setImmediate(() => {
      this.tickScheduled = false;
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (!this.running) return;

    while (this.activeCount < config.WORKER_CONCURRENCY) {
      const job = this.dequeueNext();
      if (!job) break;

      this.activeCount++;
      void this.processJob(job).finally(() => {
        this.activeCount--;
        this.scheduleTick();
      });
    }

    if (this.pendingDepth > 0 && this.activeCount < config.WORKER_CONCURRENCY) {
      this.scheduleTick();
    }
  }

  private dequeueNext(): QueueJob | undefined {
    for (const [groupId, queue] of this.groupQueues) {
      if (queue.length > 0) {
        const job = queue.shift();
        if (queue.length === 0) {
          this.groupQueues.delete(groupId);
        }
        if (job) {
          this.pendingDepth--;
          return job;
        }
      }
    }
    return undefined;
  }

  private retryDelayMs(attempt: number): number {
    const delay =
      config.WORKER_RETRY_DELAY_MS * 2 ** (attempt - 1);
    return Math.min(delay, config.WORKER_RETRY_MAX_DELAY_MS);
  }

  private async processJob(job: QueueJob): Promise<void> {
    const messageId = job.message.providerMessageId;

    try {
      const mediaAttachments = await processAllMedia(
        job.message.mediaAttachments,
        messageId,
      );
      job.message.mediaAttachments = mediaAttachments;

      store.saveMessage(job.message);
      dedup.markProcessed(messageId);

      logger.info({ message: job.message }, JSON.stringify(job.message));
      this.stats.processed++;
    } catch (err) {
      if (job.attempt < config.WORKER_MAX_RETRIES) {
        logger.warn(
          { err, messageId, attempt: job.attempt },
          "job failed, scheduling retry",
        );
        await this.delay(this.retryDelayMs(job.attempt));
        this.requeueWithRetry(job);
        return;
      }

      dedup.releasePending(messageId);
      this.stats.failed++;
      logger.error({ err, messageId }, "job failed permanently");
    }
  }

  private requeueWithRetry(job: QueueJob): void {
    const retryJob: QueueJob = {
      ...job,
      attempt: job.attempt + 1,
    };

    const queue = this.groupQueues.get(job.groupId) ?? [];
    queue.unshift(retryJob);
    this.groupQueues.set(job.groupId, queue);
    this.pendingDepth++;
    this.scheduleTick();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const queue = new MessageQueue();

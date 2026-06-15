import * as store from "./store.js";

const pendingIds = new Set<string>();

export const stats = {
  webhookRequests: 0,
  duplicatesIgnored: 0,
  recordWebhookRequest(): void {
    this.webhookRequests++;
  },
  incrementDuplicate(): void {
    this.duplicatesIgnored++;
  },
};

export function hasSeen(id: string): boolean {
  return store.messageExists(id) || pendingIds.has(id);
}

export function markPending(id: string): void {
  pendingIds.add(id);
}

export function markProcessed(id: string): void {
  pendingIds.delete(id);
}

export function releasePending(id: string): void {
  pendingIds.delete(id);
}

export const dedup = {
  stats,
  hasSeen,
  markPending,
  markProcessed,
  releasePending,
};

/** @internal test helper */
export function resetDedupState(): void {
  pendingIds.clear();
  stats.webhookRequests = 0;
  stats.duplicatesIgnored = 0;
}

import { beforeEach, describe, expect, it } from "@jest/globals";
import {
  dedup,
  hasSeen,
  markPending,
  markProcessed,
  releasePending,
  resetDedupState,
} from "./dedup.js";
import { saveMessage } from "./store.js";
import type { RemiMessage } from "../types/remi-message.js";

function testMessage(id: string): RemiMessage {
  return {
    provider: "twilio",
    providerMessageId: id,
    groupId: "group-test",
    threadId: "group-test",
    senderPhoneNumber: "+15550001",
    participantPhoneNumbers: ["+15550001"],
    timestamp: Date.now(),
    receivedAt: Date.now(),
    textBody: "test",
    mediaAttachments: [],
    sequenceInGroup: 1,
    rawPayloadReference: {
      MessageSid: id,
      AccountSid: "AC_TEST",
      From: "+15550001",
      To: "+15559999",
      Body: "test",
      NumMedia: "0",
    },
  };
}

describe("dedup", () => {
  beforeEach(() => {
    resetDedupState();
  });

  it("treats pending ids as seen", () => {
    markPending("SM_PENDING");
    expect(hasSeen("SM_PENDING")).toBe(true);
  });

  it("treats persisted messages as seen", () => {
    saveMessage(testMessage("SM_PERSISTED"));
    markProcessed("SM_PERSISTED");
    expect(hasSeen("SM_PERSISTED")).toBe(true);
  });

  it("releases pending after permanent failure so retries are allowed", () => {
    markPending("SM_RELEASE");
    releasePending("SM_RELEASE");
    expect(hasSeen("SM_RELEASE")).toBe(false);
  });

  it("clears pending after successful processing", () => {
    markPending("SM_CLEAR");
    markProcessed("SM_CLEAR");
    expect(hasSeen("SM_CLEAR")).toBe(false);
  });

  it("tracks webhook requests and duplicates separately", () => {
    dedup.stats.recordWebhookRequest();
    dedup.stats.recordWebhookRequest();
    dedup.stats.incrementDuplicate();
    expect(dedup.stats.webhookRequests).toBe(2);
    expect(dedup.stats.duplicatesIgnored).toBe(1);
  });
});

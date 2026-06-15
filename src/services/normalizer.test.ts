import { describe, expect, it } from "@jest/globals";
import {
  canonicalizeParticipants,
  deriveGroupId,
  hashGroupId,
  normalize,
} from "./normalizer.js";
import type { TwilioWebhookPayload } from "../types/remi-message.js";

const basePayload: TwilioWebhookPayload = {
  MessageSid: "SM_TEST",
  AccountSid: "AC_TEST",
  From: "+15550001",
  To: "+15559999",
  Body: "Hello",
  NumMedia: "0",
};

const threeParticipantGroup = [
  "+15550001",
  "+15550002",
  "+15559999",
];

describe("canonicalizeParticipants", () => {
  it("sorts and deduplicates with a non-colliding separator", () => {
    expect(
      canonicalizeParticipants([
        "+15550002",
        "+15550001",
        "+15559999",
        "+15550001",
      ]),
    ).toBe("+15550001\u001f+15550002\u001f+15559999");
  });
});

describe("hashGroupId", () => {
  it("returns a stable prefixed SHA-256 digest", () => {
    const id = hashGroupId(threeParticipantGroup);
    expect(id).toMatch(/^grp_[a-f0-9]{64}$/);
    expect(id).toBe(hashGroupId(["+15550002", "+15550001", "+15559999"]));
  });
});

describe("deriveGroupId", () => {
  it("hashes sorted participants deterministically", () => {
    const groupId = deriveGroupId({
      ...basePayload,
      Participants: "+15550002,+15550001,+15559999",
    });
    expect(groupId).toBe(hashGroupId(threeParticipantGroup));
  });

  it("falls back to From and To when Participants is absent", () => {
    const groupId = deriveGroupId(basePayload);
    expect(groupId).toBe(hashGroupId(["+15550001", "+15559999"]));
  });

  it("includes sender when Participants omits them", () => {
    const withParticipants = deriveGroupId({
      ...basePayload,
      Participants: "+15550002,+15559999",
    });
    const withExplicitSender = deriveGroupId({
      ...basePayload,
      Participants: "+15550001,+15550002,+15559999",
    });
    expect(withParticipants).toBe(withExplicitSender);
  });
});

describe("normalize", () => {
  it("includes sender in participantPhoneNumbers", () => {
    const message = normalize(
      {
        ...basePayload,
        Participants: "+15550002,+15559999",
      },
      1,
    );
    expect(message.participantPhoneNumbers).toEqual(threeParticipantGroup);
    expect(message.groupId).toBe(hashGroupId(threeParticipantGroup));
  });

  it("extracts media attachments from payload", () => {
    const message = normalize(
      {
        ...basePayload,
        NumMedia: "1",
        MediaUrl0: "https://example.com/photo.jpg",
        MediaContentType0: "image/jpeg",
      },
      2,
    );
    expect(message.mediaAttachments).toHaveLength(1);
    expect(message.mediaAttachments[0]).toMatchObject({
      originalUrl: "https://example.com/photo.jpg",
      contentType: "image/jpeg",
      status: "pending",
    });
    expect(message.sequenceInGroup).toBe(2);
  });

  it("clamps invalid NumMedia to zero", () => {
    const message = normalize({ ...basePayload, NumMedia: "-5" }, 1);
    expect(message.mediaAttachments).toHaveLength(0);
  });

  it("uses Date.now fallback for invalid DateCreated", () => {
    const before = Date.now();
    const message = normalize(
      { ...basePayload, DateCreated: "not-a-date" },
      1,
    );
    const after = Date.now();
    expect(message.timestamp).toBeGreaterThanOrEqual(before);
    expect(message.timestamp).toBeLessThanOrEqual(after);
  });
});

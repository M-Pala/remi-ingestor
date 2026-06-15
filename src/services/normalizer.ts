import crypto from "node:crypto";
import { config } from "../config.js";
import type { RemiMessage, TwilioWebhookPayload } from "../types/remi-message.js";

const PARTICIPANT_SEPARATOR = "\u001f";
const GROUP_ID_PREFIX = "grp_";

/** Sorted, deduplicated participant list joined with a non-colliding separator. */
export function canonicalizeParticipants(participants: string[]): string {
  return [...new Set(participants.map((p) => p.trim()).filter(Boolean))]
    .sort()
    .join(PARTICIPANT_SEPARATOR);
}

/** Deterministic group ID from participant phone numbers (SHA-256). */
export function hashGroupId(participants: string[]): string {
  const canonical = canonicalizeParticipants(participants);
  const digest = crypto.createHash("sha256").update(canonical).digest("hex");
  return `${GROUP_ID_PREFIX}${digest}`;
}

function parseParticipants(payload: TwilioWebhookPayload): string[] {
  let participants: string[];

  if (payload.Participants) {
    participants = payload.Participants.split(",")
      .map((p) => p.trim())
      .filter(Boolean);
  } else {
    participants = [payload.From, payload.To].filter(Boolean);
  }

  const sender = payload.From;
  if (sender && !participants.includes(sender)) {
    participants.push(sender);
  }

  return [...new Set(participants)].sort();
}

export function deriveGroupId(payload: TwilioWebhookPayload): string {
  return hashGroupId(parseParticipants(payload));
}

function parseNumMedia(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "0", 10);
  if (Number.isNaN(parsed) || parsed < 0) return 0;
  return Math.min(parsed, config.MAX_MEDIA_ATTACHMENTS);
}

export function normalize(
  payload: TwilioWebhookPayload,
  sequenceInGroup: number,
): RemiMessage {
  const participantPhoneNumbers = parseParticipants(payload);
  const groupId = hashGroupId(participantPhoneNumbers);
  const numMedia = parseNumMedia(payload.NumMedia);
  const mediaAttachments = [];

  for (let i = 0; i < numMedia; i++) {
    const urlKey = `MediaUrl${i}` as keyof TwilioWebhookPayload;
    const typeKey = `MediaContentType${i}` as keyof TwilioWebhookPayload;
    mediaAttachments.push({
      originalUrl: String(payload[urlKey] ?? ""),
      contentType: String(payload[typeKey] ?? "application/octet-stream"),
      localPath: null,
      storedUrl: null,
      status: "pending" as const,
    });
  }

  const timestamp = payload.DateCreated
    ? Date.parse(payload.DateCreated)
    : Date.now();

  return {
    provider: "twilio",
    providerMessageId: payload.MessageSid,
    groupId,
    threadId: groupId,
    senderPhoneNumber: payload.From,
    participantPhoneNumbers,
    timestamp: Number.isNaN(timestamp) ? Date.now() : timestamp,
    receivedAt: Date.now(),
    textBody: payload.Body ?? "",
    mediaAttachments,
    sequenceInGroup,
    rawPayloadReference: payload,
  };
}

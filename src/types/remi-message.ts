export type MediaStatus = "pending" | "downloaded" | "failed";

export interface MediaAttachment {
  originalUrl: string;
  localPath: string | null;
  storedUrl: string | null;
  contentType: string;
  status: MediaStatus;
}

export interface RemiMessage {
  // Identity
  provider: "twilio";
  providerMessageId: string;

  // Group context
  groupId: string; // SHA-256 hash of canonicalized participants (`grp_<hex>`)
  threadId: string; // alias for groupId — same value, kept for clarity

  // Participants
  senderPhoneNumber: string;
  participantPhoneNumbers: string[]; // all known group members, sender included

  // Content
  timestamp: number; // Unix ms — parsed from provider's DateCreated
  receivedAt: number; // Unix ms — Date.now() at ingestion time
  // Rich objects; each `storedUrl` satisfies the assignment's media URL requirement
  textBody: string;
  mediaAttachments: MediaAttachment[];

  // Ordering
  sequenceInGroup: number; // monotonically increasing per groupId, assigned by store

  // Audit
  rawPayloadReference: TwilioWebhookPayload; // stored reference, not a copy in DB
}

// --- Twilio mock payload shape ---
// Models a Twilio Programmable Messaging inbound webhook (POST, form-encoded)
// for a group MMS conversation. Participant list comes from X-Twilio-Participants
// header or a synthetic "Participants" field we add in the mock.
export interface TwilioWebhookPayload {
  MessageSid: string; // unique message ID
  AccountSid: string;
  From: string; // sender E.164 number
  To: string; // receiving Twilio number
  Body: string;
  NumMedia: string; // "0", "1", "2", …
  MediaUrl0?: string;
  MediaContentType0?: string;
  MediaUrl1?: string;
  MediaContentType1?: string;
  DateCreated?: string; // ISO 8601 — optional, fallback to now
  // REMI-specific extension: comma-separated E.164 numbers of all participants
  // This is how we preserve full group context (host, cleaner, vendor, co-host, guest)
  Participants?: string;
}

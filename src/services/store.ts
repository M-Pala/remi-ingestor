import fs from "node:fs";
import Database from "better-sqlite3";
import { config } from "../config.js";
import type { RemiMessage } from "../types/remi-message.js";

fs.mkdirSync(config.MEDIA_DIR, { recursive: true });

const db = new Database(config.DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS raw_payloads (
    id          TEXT PRIMARY KEY,
    provider    TEXT NOT NULL,
    payload     TEXT NOT NULL,
    received_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id                  TEXT PRIMARY KEY,
    group_id            TEXT NOT NULL,
    sender              TEXT NOT NULL,
    participants        TEXT NOT NULL,
    timestamp           INTEGER NOT NULL,
    received_at         INTEGER NOT NULL,
    text_body           TEXT NOT NULL,
    media_attachments   TEXT NOT NULL,
    sequence_in_group   INTEGER NOT NULL,
    raw_payload_id      TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_group_seq ON messages(group_id, sequence_in_group);
`);

const insertRawPayload = db.prepare(`
  INSERT OR REPLACE INTO raw_payloads (id, provider, payload, received_at)
  VALUES (?, ?, ?, ?)
`);

const insertMessage = db.prepare(`
  INSERT OR REPLACE INTO messages (
    id, group_id, sender, participants, timestamp, received_at,
    text_body, media_attachments, sequence_in_group, raw_payload_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const existsStmt = db.prepare(`SELECT 1 FROM messages WHERE id = ? LIMIT 1`);

const nextSeqStmt = db.prepare(`
  SELECT COALESCE(MAX(sequence_in_group), 0) + 1 AS next_seq
  FROM messages
  WHERE group_id = ?
`);

const countStmt = db.prepare(`SELECT COUNT(*) AS count FROM messages`);

const sequenceCounters = new Map<string, number>();
const oneShotFailures = new Set<string>();

export function armOneShotFailure(id: string): void {
  oneShotFailures.add(id);
}

export function saveRawPayload(
  id: string,
  provider: string,
  payload: unknown,
): void {
  insertRawPayload.run(id, provider, JSON.stringify(payload), Date.now());
}

export function saveMessage(msg: RemiMessage): void {
  if (oneShotFailures.has(msg.providerMessageId)) {
    oneShotFailures.delete(msg.providerMessageId);
    throw new Error("Simulated DB write failure");
  }

  insertMessage.run(
    msg.providerMessageId,
    msg.groupId,
    msg.senderPhoneNumber,
    JSON.stringify(msg.participantPhoneNumbers),
    msg.timestamp,
    msg.receivedAt,
    msg.textBody,
    JSON.stringify(msg.mediaAttachments),
    msg.sequenceInGroup,
    msg.providerMessageId,
  );
}

export function messageExists(id: string): boolean {
  return existsStmt.get(id) !== undefined;
}

export function nextSequenceForGroup(groupId: string): number {
  if (!sequenceCounters.has(groupId)) {
    const row = nextSeqStmt.get(groupId) as { next_seq: number } | undefined;
    const dbNext = row?.next_seq ?? 1;
    sequenceCounters.set(groupId, dbNext - 1);
  }

  const next = sequenceCounters.get(groupId)! + 1;
  sequenceCounters.set(groupId, next);
  return next;
}

export function getStats(): { messagesStored: number } {
  const row = countStmt.get() as { count: number };
  return { messagesStored: row.count };
}

export function closeDb(): void {
  db.close();
}

/** @internal test helper */
export function resetSequenceCounters(): void {
  sequenceCounters.clear();
}

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import fetch from "node-fetch";
import { config } from "../config.js";
import type { MediaAttachment } from "../types/remi-message.js";
import { logger } from "../utils/logger.js";

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
};

// Minimal JPEG header for mock placeholder files.
const MOCK_JPEG_PLACEHOLDER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

function extensionForContentType(contentType: string): string {
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return EXT_BY_CONTENT_TYPE[base] ?? "bin";
}

function filenameFor(messageId: string, attachment: MediaAttachment): string {
  const hash = crypto
    .createHash("md5")
    .update(attachment.originalUrl)
    .digest("hex")
    .slice(0, 8);
  return `${messageId}-${hash}.${extensionForContentType(attachment.contentType)}`;
}

async function writeLocalFile(
  filename: string,
  buffer: Buffer,
): Promise<string> {
  const localPath = path.join(config.MEDIA_DIR, filename);
  await fs.writeFile(localPath, buffer);
  return localPath;
}

export async function downloadMedia(
  attachment: MediaAttachment,
  messageId: string,
): Promise<MediaAttachment> {
  const updated: MediaAttachment = { ...attachment };

  try {
    const filename = filenameFor(messageId, attachment);

    if (attachment.originalUrl.startsWith("mock://")) {
      const localPath = await writeLocalFile(filename, MOCK_JPEG_PLACEHOLDER);
      updated.localPath = localPath;
      updated.storedUrl = `https://mock-s3.remi.local/${filename}`;
      updated.status = "downloaded";
      return updated;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(attachment.originalUrl, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching media`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const localPath = await writeLocalFile(filename, buffer);

    updated.localPath = localPath;
    updated.storedUrl = `https://mock-s3.remi.local/${filename}`;
    updated.status = "downloaded";
  } catch (err) {
    logger.error(
      { err, messageId, url: attachment.originalUrl },
      "media download failed",
    );
    updated.status = "failed";
  }

  return updated;
}

export async function processAllMedia(
  attachments: MediaAttachment[],
  messageId: string,
): Promise<MediaAttachment[]> {
  return Promise.all(
    attachments.map((attachment) => downloadMedia(attachment, messageId)),
  );
}

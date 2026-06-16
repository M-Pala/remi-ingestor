const BASE_URL = process.env.SIMULATE_BASE_URL ?? "http://localhost:3001";

interface WebhookResponse {
  status: string;
  messageId?: string;
  groupId?: string;
  queueDepth?: number;
  error?: string;
}

interface StatsResponse {
  messagesReceived: number;
  messagesProcessed: number;
  duplicatesIgnored: number;
  failedMessages: number;
  pendingQueueDepth: number;
  messagesStoredInDB: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendMessage(
  payload: Partial<import("../src/types/remi-message.js").TwilioWebhookPayload>,
): Promise<WebhookResponse> {
  const body = {
    AccountSid: "AC_SIMULATE",
    To: "+15559999",
    Body: "",
    NumMedia: "0",
    ...payload,
    MessageSid: payload.MessageSid!,
    From: payload.From!,
  };

  const response = await fetch(`${BASE_URL}/webhook/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = (await response.json()) as WebhookResponse;
  console.log(`[${response.status}] ${payload.MessageSid}:`, json);
  return json;
}

async function getStats(): Promise<StatsResponse> {
  const response = await fetch(`${BASE_URL}/stats`);
  return (await response.json()) as StatsResponse;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function waitForProcessed(
  baseline: number,
  expectedIncrease: number,
  timeoutMs = 10_000,
): Promise<StatsResponse> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stats = await getStats();
    if (stats.messagesProcessed >= baseline + expectedIncrease) {
      return stats;
    }
    await sleep(200);
  }
  throw new Error(
    `Timed out waiting for messagesProcessed to reach ${baseline + expectedIncrease}`,
  );
}

async function main(): Promise<void> {
  let stats = await getStats();
  let processedBaseline = stats.messagesProcessed;

  console.log("=== SCENARIO 1 — Ordered group messages (Group A) ===");

  const msg1 = await sendMessage({
    MessageSid: "SM001",
    From: "+15550001",
    To: "+15559999",
    Body: "Bathroom faucet is leaking",
    Participants: "+15550001,+15550002,+15559999",
    NumMedia: "0",
  });
  await sleep(300);

  const msg2 = await sendMessage({
    MessageSid: "SM002",
    From: "+15550002",
    To: "+15559999",
    Body: "I can fix it tomorrow at 10am",
    Participants: "+15550001,+15550002,+15559999",
    NumMedia: "0",
  });
  await sleep(300);

  const msg3 = await sendMessage({
    MessageSid: "SM003",
    From: "+15550001",
    To: "+15559999",
    Body: "Perfect, please bring a wrench",
    Participants: "+15550001,+15550002,+15559999",
    NumMedia: "0",
  });

  assert(msg1.status === "accepted", "msg1 should be accepted");
  assert(msg2.status === "accepted", "msg2 should be accepted");
  assert(msg3.status === "accepted", "msg3 should be accepted");

  stats = await waitForProcessed(processedBaseline, 3);
  assert(
    stats.messagesProcessed === processedBaseline + 3,
    "scenario 1 should process 3 messages",
  );
  processedBaseline = stats.messagesProcessed;

  console.log("\n=== SCENARIO 2 — Duplicate idempotency ===");

  stats = await getStats();
  const duplicatesBefore = stats.duplicatesIgnored;

  const dup1 = await sendMessage({
    MessageSid: "SM001",
    From: "+15550001",
    To: "+15559999",
    Body: "Bathroom faucet is leaking",
    Participants: "+15550001,+15550002,+15559999",
    NumMedia: "0",
  });
  await sleep(300);

  const dup2 = await sendMessage({
    MessageSid: "SM001",
    From: "+15550001",
    To: "+15559999",
    Body: "Bathroom faucet is leaking",
    Participants: "+15550001,+15550002,+15559999",
    NumMedia: "0",
  });
  await sleep(300);

  assert(
    dup1.status === "duplicate",
    "first duplicate should return duplicate",
  );
  assert(
    dup2.status === "duplicate",
    "second duplicate should return duplicate",
  );

  stats = await getStats();
  assert(
    stats.duplicatesIgnored === duplicatesBefore + 2,
    "duplicatesIgnored should increase by 2",
  );

  console.log("\n=== SCENARIO 3 — Concurrent multi-group messages ===");

  const [b, c, d] = await Promise.all([
    sendMessage({
      MessageSid: "SM010",
      From: "+15550010",
      Participants: "+15550010,+15550011",
      Body: "AC unit needs inspection",
      NumMedia: "0",
    }),
    sendMessage({
      MessageSid: "SM020",
      From: "+15550020",
      Participants: "+15550020,+15550021",
      Body: "Guest reported broken lock",
      NumMedia: "0",
    }),
    sendMessage({
      MessageSid: "SM030",
      From: "+15550030",
      Participants: "+15550030,+15550031",
      Body: "Wifi not working in the bedroom",
      NumMedia: "0",
    }),
  ]);

  assert(b.status === "accepted", "Group B should be accepted");
  assert(c.status === "accepted", "Group C should be accepted");
  assert(d.status === "accepted", "Group D should be accepted");

  stats = await waitForProcessed(processedBaseline, 3);
  processedBaseline = stats.messagesProcessed;

  console.log("\n=== SCENARIO 4 — Message with media ===");

  const media = await sendMessage({
    MessageSid: "SM100",
    From: "+15550001",
    To: "+15559999",
    Body: "Here is a photo of the damage",
    Participants: "+15550001,+15550002,+15559999",
    NumMedia: "1",
    MediaUrl0:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Malabar_pied_hornbill_%28Anthracoceros_coronatus%29_female_in_flight.jpg/1920px-Malabar_pied_hornbill_%28Anthracoceros_coronatus%29_female_in_flight.jpg",
    MediaContentType0: "image/jpeg",
  });
  assert(media.status === "accepted", "media message should be accepted");

  stats = await waitForProcessed(processedBaseline, 1);
  assert(
    stats.messagesProcessed === processedBaseline + 1,
    "media message should be processed",
  );
  processedBaseline = stats.messagesProcessed;

  console.log("\n=== SCENARIO 5 — Worker failure simulation + retry ===");
  console.log(
    "Note: server must be started with SIMULATE_FAILURE_IDS=SM999 in .env",
  );

  const statsBeforeRetry = await getStats();

  await sendMessage({
    MessageSid: "SM999",
    From: "+15550099",
    Participants: "+15550099,+15550098",
    Body: "Retry test message",
    NumMedia: "0",
  });

  const statsAfterRetry = await waitForProcessed(
    statsBeforeRetry.messagesProcessed,
    1,
    15_000,
  );

  assert(
    statsAfterRetry.failedMessages === statsBeforeRetry.failedMessages,
    "SM999 should succeed after retry, not fail permanently",
  );
  assert(
    statsAfterRetry.messagesProcessed ===
      statsBeforeRetry.messagesProcessed + 1,
    "SM999 should add exactly one processed message after retry",
  );

  console.log("\n=== Final stats ===");
  stats = await getStats();
  console.log(JSON.stringify(stats, null, 2));

  console.log("\nAll simulation scenarios complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

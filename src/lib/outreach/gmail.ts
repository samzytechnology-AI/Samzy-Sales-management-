export class GmailDeliveryError extends Error {
  constructor(message: string, readonly ambiguous: boolean) {
    super(message);
    this.name = "GmailDeliveryError";
  }
}

export async function sendEmailWithGmail(input: {
  accessToken: string;
  to: string;
  subject: string;
  text: string;
  threadId?: string;
}): Promise<{ messageId: string }> {
  const raw = [
    `To: ${input.to}`,
    `Subject: ${input.subject.replace(/[\r\n]/g, " ")}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    input.text,
  ].join("\r\n");
  let response: Response;
  try {
    response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        raw: Buffer.from(raw, "utf8").toString("base64url"),
        ...(input.threadId ? { threadId: input.threadId } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    throw new GmailDeliveryError("Gmail request outcome is uncertain.", true);
  }
  if (!response.ok) throw new GmailDeliveryError(`Gmail rejected the message with HTTP ${response.status}.`, false);
  const result = await response.json() as { id?: string };
  if (!result.id) throw new GmailDeliveryError("Gmail accepted the request but returned no message ID.", true);
  return { messageId: result.id };
}

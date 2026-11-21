export interface ResendEmailInput {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
  replyTo?: string;
  fetcher?: typeof fetch;
}

export async function sendEmailWithResend(input: ResendEmailInput): Promise<{ messageId: string }> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Email provider rejected the message with HTTP ${response.status}.`);
  }
  const messageId = payload && typeof payload === "object" && "id" in payload
    ? String((payload as { id: unknown }).id ?? "")
    : "";
  if (!messageId) throw new Error("Email provider returned no message identifier.");
  return { messageId };
}

export class WhatsAppDeliveryError extends Error {
  readonly status: number;
  readonly ambiguous: boolean;
  constructor(status: number) {
    super(`WhatsApp Cloud API returned HTTP ${status}.`);
    this.name = "WhatsAppDeliveryError";
    this.status = status;
    this.ambiguous = status >= 500 || status === 408;
  }
}
export interface WhatsAppTemplateInput {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  templateName: string;
  language: string;
  bodyText: string;
  idempotencyKey: string;
  fetcher?: typeof fetch;
}
/** Sends only an approved Meta template with exactly one body text parameter. */
export async function sendWhatsAppTemplate(input: WhatsAppTemplateInput): Promise<{ messageId: string }> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(`https://graph.facebook.com/v22.0/${encodeURIComponent(input.phoneNumberId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "template",
      template: {
        name: input.templateName,
        language: { code: input.language },
        components: [{ type: "body", parameters: [{ type: "text", text: input.bodyText.slice(0, 1024) }] }],
      },
    }),
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new WhatsAppDeliveryError(response.status);
  const messages = payload && typeof payload === "object" && "messages" in payload
    ? (payload as { messages?: Array<{ id?: string }> }).messages : undefined;
  const messageId = messages?.[0]?.id ?? "";
  if (!messageId) throw new Error("WhatsApp API returned no message identifier.");
  return { messageId };
}

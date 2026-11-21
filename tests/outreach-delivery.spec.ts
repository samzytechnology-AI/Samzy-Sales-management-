import { expect, test } from "@playwright/test";
import { sendEmailWithResend } from "../src/lib/outreach/resend";

test("Resend adapter sends one recipient with a stable idempotency key", async () => {
  let captured: RequestInit | undefined;
  const result = await sendEmailWithResend({
    apiKey: "test-key",
    from: "Samzy Technology <hello@example.com>",
    to: "client@example.com",
    subject: "A quick idea for Example Ltd",
    text: "A personalised message for this business.",
    idempotencyKey: "outreach-draft-123",
    replyTo: "hello@example.com",
    fetcher: async (_input, init) => {
      captured = init;
      return new Response(JSON.stringify({ id: "email-provider-id" }), { status: 200 });
    },
  });
  expect(result.messageId).toBe("email-provider-id");
  expect(captured?.method).toBe("POST");
  expect(new Headers(captured?.headers).get("Idempotency-Key")).toBe("outreach-draft-123");
  const body = JSON.parse(String(captured?.body));
  expect(body.to).toEqual(["client@example.com"]);
  expect(body.reply_to).toBe("hello@example.com");
});

test("Resend adapter does not report a rejected provider request as sent", async () => {
  await expect(sendEmailWithResend({
    apiKey: "test-key",
    from: "hello@example.com",
    to: "client@example.com",
    subject: "Test",
    text: "A test message.",
    idempotencyKey: "draft-456",
    fetcher: async () => new Response(JSON.stringify({ message: "rejected" }), { status: 422 }),
  })).rejects.toThrow("HTTP 422");
});

test("Resend adapter requires a provider message identifier", async () => {
  await expect(sendEmailWithResend({
    apiKey: "test-key",
    from: "hello@example.com",
    to: "client@example.com",
    subject: "Test",
    text: "A test message.",
    idempotencyKey: "draft-789",
    fetcher: async () => new Response(JSON.stringify({}), { status: 200 }),
  })).rejects.toThrow("no message identifier");
});

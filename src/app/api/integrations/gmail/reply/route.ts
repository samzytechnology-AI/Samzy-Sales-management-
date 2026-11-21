import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getGmailAccessToken } from "@/lib/gmail/tokens";

export const runtime = "nodejs";
const schema = z.object({
  messageId: z.string().trim().min(1).max(200),
  threadId: z.string().trim().min(1).max(200),
  body: z.string().trim().min(10).max(12_000),
  approved: z.literal(true),
}).strict();
const noStore = { "Cache-Control": "no-store" };

function header(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}
function addressFromHeader(value: string): string {
  const match = value.match(/<([^<>]+)>/) ?? value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const address = (match?.[1] ?? match?.[0] ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error("The original sender address could not be verified.");
  return address;
}

export async function POST(request: NextRequest) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const organizationId = request.headers.get("x-organization-id") ?? "";
  if (!token) return NextResponse.json({ error: "Sign in is required." }, { status: 401, headers: noStore });
  let input: z.infer<typeof schema>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 16_384) return NextResponse.json({ error: "Reply is too large." }, { status: 413, headers: noStore });
    input = schema.parse(JSON.parse(raw));
  } catch { return NextResponse.json({ error: "A valid approved reply is required." }, { status: 400, headers: noStore }); }

  try {
    const db = createServerSupabaseClient();
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return NextResponse.json({ error: "Your session is invalid or expired." }, { status: 401, headers: noStore });
    const { data: member, error: memberError } = await db.from("organization_members")
      .select("role").eq("organization_id", organizationId).eq("user_id", auth.user.id).maybeSingle();
    if (memberError || !member || !["owner", "admin"].includes(member.role)) {
      return NextResponse.json({ error: "Only the workspace owner or an administrator can send Gmail replies." }, { status: 403, headers: noStore });
    }
    const { accessToken, emailAddress } = await getGmailAccessToken(organizationId);
    const originalResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(input.messageId)}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store",
    });
    if (!originalResponse.ok) throw new Error("The original Gmail message could not be loaded.");
    const original = await originalResponse.json() as {
      threadId?: string;
      payload?: { headers?: Array<{ name: string; value: string }> };
    };
    if (original.threadId !== input.threadId) throw new Error("The selected message does not belong to the supplied Gmail thread.");
    const headers = original.payload?.headers ?? [];
    const recipient = addressFromHeader(header(headers, "Reply-To") || header(headers, "From"));
    if (recipient === emailAddress.toLowerCase()) throw new Error("The original sender is the connected Samzy mailbox; no reply was sent.");
    const originalSubject = header(headers, "Subject").replace(/\r|\n/g, " ").trim();
    const subject = /^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject || "(No subject)"}`;
    const messageId = header(headers, "Message-ID");
    const references = [header(headers, "References"), messageId].filter(Boolean).join(" ").trim();
    const rawMessage = [
      `To: ${recipient}`,
      `Subject: ${subject}`,
      ...(messageId ? [`In-Reply-To: ${messageId}`] : []),
      ...(references ? [`References: ${references}`] : []),
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      input.body.trim(),
    ].join("\r\n");
    const sendResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: Buffer.from(rawMessage, "utf8").toString("base64url"), threadId: input.threadId }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!sendResponse.ok) throw new Error("Gmail rejected the reply. Check the connected mailbox and sending permissions.");
    const sent = await sendResponse.json() as { id?: string };
    const now = new Date().toISOString();
    await db.from("outreach_events").insert({
      organization_id: organizationId, channel: "email", recipient, direction: "outbound",
      status: "sent", body: input.body.trim(), provider_message_id: sent.id ?? null, sent_at: now,
    });
    await db.from("audit_events").insert({
      organization_id: organizationId, actor_user_id: auth.user.id, actor_type: "user",
      action: "gmail_reply_sent", entity_type: "gmail_thread", metadata: { threadId: input.threadId, messageId: sent.id ?? null, recipient },
    });
    return NextResponse.json({ sent: true, messageId: sent.id ?? null, recipient }, { headers: noStore });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gmail reply failed." }, { status: 502, headers: noStore });
  }
}

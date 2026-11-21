import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getGmailAccessToken } from "@/lib/gmail/tokens";

export const runtime = "nodejs";
const uuid = z.string().uuid();
const noStore = { "Cache-Control": "no-store" };
type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };
function collectText(part: GmailPart, type: "text/plain" | "text/html", output: string[]) {
  if (part.mimeType === type && part.body?.data) output.push(Buffer.from(part.body.data, "base64url").toString("utf8"));
  for (const child of part.parts ?? []) collectText(child, type, output);
}
function extractBody(payload?: GmailPart): string {
  if (!payload) return "";
  const plain: string[] = [];
  collectText(payload, "text/plain", plain);
  let value = plain.join("\n\n");
  if (!value) {
    const html: string[] = [];
    collectText(payload, "text/html", html);
    value = html.join(" ").replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
  }
  return value.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 12_000);
}

export async function GET(request: NextRequest) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const organizationId = request.headers.get("x-organization-id") ?? "";
  if (!token) return NextResponse.json({ error: "Sign in is required." }, { status: 401, headers: noStore });
  if (!uuid.safeParse(organizationId).success) return NextResponse.json({ error: "A valid organisation ID is required." }, { status: 400, headers: noStore });
  try {
    const db = createServerSupabaseClient();
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return NextResponse.json({ error: "Your session is invalid or expired." }, { status: 401, headers: noStore });
    const { data: member, error: memberError } = await db.from("organization_members")
      .select("role").eq("organization_id", organizationId).eq("user_id", auth.user.id).maybeSingle();
    if (memberError || !member || !["owner", "admin", "manager"].includes(member.role)) {
      return NextResponse.json({ error: "You cannot read this company's Gmail inbox." }, { status: 403, headers: noStore });
    }
    const { accessToken, emailAddress } = await getGmailAccessToken(organizationId);
    const listResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&maxResults=20", {
      headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store",
    });
    if (!listResponse.ok) throw new Error("Gmail inbox listing failed.");
    const list = await listResponse.json() as { messages?: Array<{ id: string; threadId: string }> };
    const messages = await Promise.all((list.messages ?? []).map(async (item) => {
      const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`, {
        headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store",
      });
      if (!response.ok) return null;
      const message = await response.json() as {
        id: string; threadId: string; snippet?: string;
        payload?: { headers?: Array<{ name: string; value: string }>; mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };
      };
      const headers = message.payload?.headers ?? [];
      const header = (name: string) => headers.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value ?? "";
      return {
        id: message.id,
        threadId: message.threadId,
        from: header("From").slice(0, 300),
        subject: header("Subject").slice(0, 300),
        date: header("Date").slice(0, 100),
        snippet: (message.snippet ?? "").slice(0, 1_000),
        body: extractBody(message.payload),
      };
    }));
    return NextResponse.json({
      mailbox: emailAddress,
      messages: messages.filter(Boolean),
      capturedAt: new Date().toISOString(),
    }, { headers: noStore });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail inbox could not be loaded.";
    return NextResponse.json({ error: message }, { status: 502, headers: noStore });
  }
}

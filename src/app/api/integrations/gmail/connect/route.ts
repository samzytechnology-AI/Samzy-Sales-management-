import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
const uuid = z.string().uuid();
export async function POST(request: NextRequest) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "Sign in before connecting Gmail." }, { status: 401 });
  let organizationId = "";
  try {
    const body = await request.json() as { organizationId?: string };
    organizationId = body.organizationId ?? "";
  } catch { return NextResponse.json({ error: "Invalid connection request." }, { status: 400 }); }
  if (!uuid.safeParse(organizationId).success) return NextResponse.json({ error: "A valid organisation ID is required." }, { status: 400 });
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
    return NextResponse.json({ error: "Google OAuth credentials are not configured." }, { status: 503 });
  }
  try {
    const db = createServerSupabaseClient();
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return NextResponse.json({ error: "Your session is invalid or expired." }, { status: 401 });
    const { data: member, error: memberError } = await db.from("organization_members")
      .select("role").eq("organization_id", organizationId).eq("user_id", auth.user.id).maybeSingle();
    if (memberError || !member || !["owner", "admin"].includes(member.role)) {
      return NextResponse.json({ error: "Only a workspace owner or administrator can connect Gmail." }, { status: 403 });
    }
    const state = randomUUID();
    const redirectUri = new URL("/api/integrations/gmail/callback", request.nextUrl.origin).toString();
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", process.env.GMAIL_CLIENT_ID);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", [
      "openid", "email",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
    ].join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("state", state);
    const response = NextResponse.json({ authorizationUrl: url.toString(), redirectUri }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set("samzy_gmail_oauth", `${state}.${organizationId}.${auth.user.id}`, {
      httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge: 600,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Could not start Gmail authorization. Check the server configuration." }, { status: 503 });
  }
}

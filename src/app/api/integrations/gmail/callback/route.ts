import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { encryptGmailRefreshToken } from "@/lib/gmail/tokens";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const cookie = request.cookies.get("samzy_gmail_oauth")?.value ?? "";
  const [expectedState, organizationId] = cookie.split(".");
  const fail = (message: string, status = 400) => {
    const response = NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
    response.cookies.delete("samzy_gmail_oauth");
    return response;
  };
  if (request.nextUrl.searchParams.has("error")) return fail("Google Gmail authorization was cancelled or denied.");
  if (!state || !code || !expectedState || state !== expectedState || !organizationId) {
    return fail("Gmail authorization state is invalid or expired. Start the connection again.");
  }
  const clientId = process.env.GMAIL_CLIENT_ID ?? "";
  const clientSecret = process.env.GMAIL_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret || !process.env.GMAIL_TOKEN_ENCRYPTION_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return fail("Gmail storage is not ready. Configure the Google OAuth, token-encryption and Supabase server secrets.", 503);
  }
  const redirectUri = new URL("/api/integrations/gmail/callback", request.nextUrl.origin).toString();
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!tokenResponse.ok) return fail("Google did not exchange the authorization code. Check the OAuth redirect URI.", 502);
    const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string; scope?: string };
    if (!tokens.access_token || !tokens.refresh_token) {
      return fail("Google did not return an offline refresh token. Reconnect and approve access when prompted.", 502);
    }
    const profileResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      cache: "no-store",
    });
    if (!profileResponse.ok) return fail("Could not verify the connected Gmail mailbox.", 502);
    const profile = await profileResponse.json() as { emailAddress?: string };
    const emailAddress = (profile.emailAddress ?? "").toLowerCase();
    const expectedEmail = (process.env.GMAIL_EXPECTED_EMAIL ?? "").toLowerCase();
    if (!emailAddress || (expectedEmail && emailAddress !== expectedEmail)) {
      return fail("The authorized Google account does not match the configured Samzy mailbox.");
    }
    const db = createServerSupabaseClient();
    const { error } = await db.from("gmail_integrations").upsert({
      organization_id: organizationId,
      email_address: emailAddress,
      refresh_token_ciphertext: encryptGmailRefreshToken(tokens.refresh_token),
      scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id" });
    if (error) return fail("Gmail was authorized, but its encrypted connection could not be saved. Check the Gmail database migration.", 503);
    const response = NextResponse.redirect(new URL("/?gmail=connected", request.nextUrl.origin));
    response.cookies.delete("samzy_gmail_oauth");
    return response;
  } catch {
    return fail("Gmail connection failed. Check the server logs without exposing OAuth credentials.", 502);
  }
}

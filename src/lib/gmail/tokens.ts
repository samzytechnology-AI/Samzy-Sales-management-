import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function encryptionKey(): Buffer {
  const encoded = process.env.GMAIL_TOKEN_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("Gmail token encryption is not configured correctly.");
  return key;
}

export function encryptGmailRefreshToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

function decryptGmailRefreshToken(value: string): string {
  const packed = Buffer.from(value, "base64");
  if (packed.length < 29) throw new Error("Stored Gmail token is invalid.");
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export async function getGmailAccessToken(organizationId: string): Promise<{ accessToken: string; emailAddress: string }> {
  const db = createServerSupabaseClient();
  const { data, error } = await db.from("gmail_integrations")
    .select("email_address,refresh_token_ciphertext")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) throw new Error("Gmail is not connected to this company workspace.");
  const refreshToken = decryptGmailRefreshToken(data.refresh_token_ciphertext);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID ?? "",
      client_secret: process.env.GMAIL_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Google could not refresh the Gmail access token.");
  const token = await response.json() as { access_token?: string };
  if (!token.access_token) throw new Error("Google returned no Gmail access token.");
  return { accessToken: token.access_token, emailAddress: data.email_address };
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const runtime = "nodejs";
const inputSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(256),
}).strict();

export async function POST(request: NextRequest) {
  let input: z.infer<typeof inputSchema>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 2_048) {
      return NextResponse.json({ error: "Login request is too large." }, { status: 413 });
    }
    input = inputSchema.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "Enter a valid username and password." }, { status: 400 });
  }

  const expectedUsername = (process.env.DASHBOARD_LOGIN_USERNAME ?? "").trim().toUpperCase();
  const ownerEmail = (process.env.DASHBOARD_LOGIN_EMAIL ?? "").trim().toLowerCase();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!expectedUsername || !ownerEmail || !url || !anonKey) {
    return NextResponse.json({ error: "Secure dashboard login is not fully configured." }, { status: 503 });
  }
  if (input.username.trim().toUpperCase() !== expectedUsername) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: ownerEmail,
    password: input.password,
  });
  if (error || !data.session) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }
  return NextResponse.json({
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    },
    user: { id: data.user.id, email: data.user.email },
  }, { headers: { "Cache-Control": "no-store" } });
}

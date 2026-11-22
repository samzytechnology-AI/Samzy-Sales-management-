import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { z } from "zod";

export const runtime = "nodejs";
const ORGANIZATION_ID = "fde00435-b72a-4650-8a85-eb9baec33d33";
const inputSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(256),
}).strict();

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  let input: z.infer<typeof inputSchema>;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 2048) {
      return NextResponse.json({ error: "Login request is too large." }, { status: 413 });
    }
    input = inputSchema.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "Enter a valid username and password." }, { status: 400 });
  }

  const expectedUsername = (process.env.DASHBOARD_LOGIN_USERNAME ?? "").trim().toUpperCase();
  const expectedPassword = process.env.DASHBOARD_LOGIN_PASSWORD ?? "";
  const ownerEmail = (process.env.DASHBOARD_LOGIN_EMAIL ?? "").trim().toLowerCase();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!expectedUsername || !expectedPassword || !ownerEmail || !url || !anonKey) {
    return NextResponse.json({ error: "Secure dashboard login is not fully configured." }, { status: 503 });
  }
  if (
    input.username.trim().toUpperCase() !== expectedUsername ||
    !safeEqual(input.password, expectedPassword)
  ) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  try {
    // Create or synchronise the owner Auth identity only after checking the
    // server-side credentials. The secret password never reaches the browser.
    const admin = createServerSupabaseClient();
    const { data: usersData, error: listError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listError) throw listError;

    let owner = usersData.users.find((user) => user.email?.toLowerCase() === ownerEmail);
    if (!owner) {
      const { data, error } = await admin.auth.admin.createUser({
        email: ownerEmail,
        password: expectedPassword,
        email_confirm: true,
        user_metadata: { username: expectedUsername },
      });
      if (error) throw error;
      owner = data.user;
    } else {
      const { data, error } = await admin.auth.admin.updateUserById(owner.id, {
        password: expectedPassword,
        email_confirm: true,
        user_metadata: { ...owner.user_metadata, username: expectedUsername },
      });
      if (error) throw error;
      owner = data.user;
    }

    const { error: membershipError } = await admin
      .from("organization_members")
      .upsert(
        { organization_id: ORGANIZATION_ID, user_id: owner.id, role: "owner" },
        { onConflict: "organization_id,user_id" },
      );
    if (membershipError) throw membershipError;

    const publicClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await publicClient.auth.signInWithPassword({
      email: ownerEmail,
      password: expectedPassword,
    });
    if (error || !data.session) throw error ?? new Error("Supabase did not return a session.");

    return NextResponse.json({
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
      user: { id: data.user.id, email: data.user.email },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[auth/login] Owner sign-in provisioning failed:", error);
    return NextResponse.json(
      { error: "Sign-in setup failed. Please try again shortly." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

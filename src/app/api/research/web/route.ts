import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { searchBusinessWeb } from "@/lib/research/brave-search";

export const runtime = "nodejs";
const uuid = z.string().uuid();
const noStore = { "Cache-Control": "no-store" };
const bodySchema = z.object({
  query: z.string().trim().min(5).max(600),
  country: z.enum(["NG","GB","US","CA","AU","AE","ZA"]).optional(),
}).strict();

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const organizationId = request.headers.get("x-organization-id") ?? "";
  if (!token) return NextResponse.json({ error: "A valid sign-in session is required." }, { status: 401, headers: noStore });
  if (!uuid.safeParse(organizationId).success) return NextResponse.json({ error: "A valid organisation ID is required." }, { status: 400, headers: noStore });

  let input: z.infer<typeof bodySchema>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 4_096) return NextResponse.json({ error: "Search request is too large." }, { status: 413, headers: noStore });
    input = bodySchema.parse(JSON.parse(raw));
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof z.ZodError ? cause.issues[0]?.message ?? "Invalid search request." : "Invalid request body." }, { status: 400, headers: noStore });
  }

  const apiKey = process.env.BRAVE_SEARCH_API_KEY ?? "";
  if (!apiKey) return NextResponse.json({ error: "Live web research is not configured. Add BRAVE_SEARCH_API_KEY as a server-only environment variable." }, { status: 503, headers: noStore });

  try {
    const db = createServerSupabaseClient();
    const { data: authData, error: authError } = await db.auth.getUser(token);
    if (authError || !authData.user) return NextResponse.json({ error: "Your sign-in session is invalid or expired." }, { status: 401, headers: noStore });
    const { data: member, error: memberError } = await db.from("organization_members")
      .select("role").eq("organization_id", organizationId).eq("user_id", authData.user.id).maybeSingle();
    if (memberError) throw new Error("Could not verify organisation membership.");
    if (!member || !["owner","admin","manager"].includes(member.role)) {
      return NextResponse.json({ error: "You cannot research prospects for this organisation." }, { status: 403, headers: noStore });
    }
    const evidence = await searchBusinessWeb(input.query, apiKey, input.country);
    return NextResponse.json({ evidence, capturedAt: new Date().toISOString(), source: "Brave Search" }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Live web research failed. No search results were added to the AI context." }, { status: 502, headers: noStore });
  }
}

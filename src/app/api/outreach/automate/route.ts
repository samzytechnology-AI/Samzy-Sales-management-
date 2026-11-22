import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { searchBusinessWeb } from "@/lib/research/tavily-search";

export const runtime = "nodejs";
const uuid = z.string().uuid();
const noStore = { "Cache-Control": "no-store" };
const schema = z.object({
  query: z.string().trim().min(8).max(600),
  country: z.enum(["NG", "GB", "US", "CA", "AU", "AE", "ZA"]).optional(),
}).strict();

const countryNames: Record<string, string> = {
  NG: "Nigeria", GB: "United Kingdom", US: "United States", CA: "Canada",
  AU: "Australia", AE: "United Arab Emirates", ZA: "South Africa",
};

export async function POST(request: NextRequest) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const organizationId = request.headers.get("x-organization-id") ?? "";
  if (!token) return NextResponse.json({ error: "A valid sign-in session is required." }, { status: 401, headers: noStore });
  if (!uuid.safeParse(organizationId).success) return NextResponse.json({ error: "A valid organisation ID is required." }, { status: 400, headers: noStore });

  let input: z.infer<typeof schema>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 4_096) return NextResponse.json({ error: "Request is too large." }, { status: 413, headers: noStore });
    input = schema.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "Invalid prospect discovery request." }, { status: 400, headers: noStore });
  }

  const db = createServerSupabaseClient();
  const { data: authData, error: authError } = await db.auth.getUser(token);
  if (authError || !authData.user) return NextResponse.json({ error: "Your sign-in session is invalid or expired." }, { status: 401, headers: noStore });

  const { data: member, error: memberError } = await db.from("organization_members")
    .select("role").eq("organization_id", organizationId).eq("user_id", authData.user.id).maybeSingle();
  if (memberError) return NextResponse.json({ error: "Could not verify company membership." }, { status: 503, headers: noStore });
  if (!member || !["owner", "admin", "manager"].includes(member.role)) return NextResponse.json({ error: "You cannot discover prospects for this organisation." }, { status: 403, headers: noStore });

  const { data: allowed, error: limitError } = await db.rpc("consume_ai_rate_limit", {
    p_organization_id: organizationId, p_user_id: authData.user.id, p_limit: 30, p_window_seconds: 3600,
  });
  if (limitError) return NextResponse.json({ error: "Could not enforce the research usage limit." }, { status: 503, headers: noStore });
  if (!allowed) return NextResponse.json({ error: "The research limit of 30 requests per hour has been reached." }, { status: 429, headers: noStore });

  const apiKey = process.env.TAVILY_API_KEY ?? "";
  if (!apiKey) return NextResponse.json({ error: "Live web research is not configured." }, { status: 503, headers: noStore });

  try {
    const evidence = await searchBusinessWeb(input.query, apiKey, input.country);
    const created: Array<{ id: string; companyName: string; websiteUrl: string }> = [];
    const alreadyRecorded: string[] = [];
    for (const item of evidence) {
      const url = new URL(item.url);
      const canonicalUrl = url.origin + url.pathname.replace(/\/$/, "");
      const companyName = (item.title ?? url.hostname).replace(/\s*[|–—:-]\s*[^|–—:-]+$/, "").trim().slice(0, 180) || url.hostname;
      const { data: existing, error: lookupError } = await db.from("prospects")
        .select("id,company_name").eq("organization_id", organizationId).ilike("website_url", canonicalUrl).maybeSingle();
      if (lookupError) throw new Error("Could not check for an existing prospect.");
      if (existing) { alreadyRecorded.push(existing.company_name); continue; }

      // The Interest/prospect record is persisted before any contact or outreach action.
      const { data: prospect, error: insertError } = await db.from("prospects").insert({
        organization_id: organizationId,
        company_name: companyName,
        website_url: canonicalUrl,
        country: input.country ? countryNames[input.country] : null,
        status: "discovered",
        fit_score: null,
        discovered_by: "samzy_ai_web_research",
        research_summary: "Discovered from public web search. This is an unqualified lead: website status, contact details, decision-maker, and outreach eligibility still require verification.",
        evidence: [{ url: item.url, title: item.title ?? null, excerpt: item.excerpt ?? null, publishedAt: item.publishedAt ?? null, capturedAt: new Date().toISOString() }],
      }).select("id,company_name,website_url").single();
      if (insertError || !prospect) throw new Error("Could not save the discovered Interest record.");
      created.push({ id: prospect.id, companyName: prospect.company_name, websiteUrl: prospect.website_url ?? canonicalUrl });
      await db.from("audit_events").insert({
        organization_id: organizationId, actor_user_id: authData.user.id, actor_type: "user",
        action: "prospect.discovered", entity_type: "prospect", entity_id: prospect.id,
        metadata: { source: "Tavily", source_url: item.url, country: input.country ?? null },
      });
    }

    return NextResponse.json({
      status: "interests_created",
      created,
      alreadyRecorded,
      evidenceCount: evidence.length,
      message: "Interest records were created first. No email was sent: public search snippets do not establish a verified email address or a lawful contact basis. Add and verify an eligible contact in the CRM; the automatic sender can then send without per-email approval.",
    }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Prospect discovery failed. Any successfully created Interest records remain saved; no email was sent." }, { status: 502, headers: noStore });
  }
}

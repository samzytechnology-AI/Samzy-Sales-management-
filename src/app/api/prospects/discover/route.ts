import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { searchBusinessWeb } from "@/lib/research/tavily-search";
import { createConfiguredAdapters } from "@/lib/ai/provider-config";
import { ACTIVE_SAMZY_SERVICES, CONFIRMATION_REQUIRED_SERVICES } from "@/lib/business/service-catalog";
import type { ModelRequest } from "@/lib/ai/types";

export const runtime = "nodejs";
export const maxDuration = 60;
const uuid = z.string().uuid();
const noStore = { "Cache-Control": "no-store" };
const countries = [
  { code: "NG", name: "Nigeria" }, { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" }, { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" }, { code: "AE", name: "United Arab Emirates" },
  { code: "ZA", name: "South Africa" },
] as const;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: noStore });
}
function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^\x60{3}(?:json)?\s*/i, "").replace(/\s*\x60{3}$/i, "");
  try { return JSON.parse(cleaned); } catch { /* extract the first JSON array */ }
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  throw new Error("The available AI returned an unreadable prospect list.");
}
function normaliseWebsite(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol)) return null;
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
}
function phoneFromEvidence(value: unknown, evidence: Array<{url:string;title?:string;excerpt?:string}>) {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  const supported = evidence.some(item => (item.excerpt ?? "").replace(/\D/g, "").includes(digits));
  return supported ? digits : null;
}

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const organizationId = request.headers.get("x-organization-id") ?? "";
  if (!token) return jsonError("A valid sign-in session is required.", 401);
  if (!uuid.safeParse(organizationId).success) return jsonError("A valid organisation ID is required.", 400);

  try {
    const db = createServerSupabaseClient();
    const { data: authData, error: authError } = await db.auth.getUser(token);
    if (authError || !authData.user) return jsonError("Your sign-in session is invalid or expired.", 401);
    const { data: member, error: memberError } = await db.from("organization_members")
      .select("role").eq("organization_id", organizationId).eq("user_id", authData.user.id).maybeSingle();
    if (memberError) throw new Error("Could not verify company membership.");
    if (!member || !["owner", "admin", "manager"].includes(member.role)) return jsonError("You cannot discover prospects for this workspace.", 403);

    const tavilyKey = process.env.TAVILY_API_KEY ?? "";
    if (!tavilyKey) return jsonError("Tavily is not configured on the server. No prospects were saved.", 503);
    const { data: allowed, error: limitError } = await db.rpc("consume_ai_rate_limit", {
      p_organization_id: organizationId, p_user_id: authData.user.id, p_limit: 30, p_window_seconds: 3600,
    });
    if (limitError) throw new Error("Could not enforce the discovery usage limit.");
    if (!allowed) return jsonError("The shared research limit has been reached. Try again later.", 429);

    const serviceNames = ACTIVE_SAMZY_SERVICES.map(service => service.name).join(", ");
    const searchResults = await Promise.all(countries.map(async country => {
      const query = `Find real, currently operating small and medium businesses in ${country.name} that may need one of these services: ${serviceNames}. Prioritise businesses with no official website or a broken/outdated website, active social profiles, and publicly listed official contact details. Return business websites and credible business profile sources, not agencies selling these services.`;
      try { return { country, evidence: await searchBusinessWeb(query.slice(0, 590), tavilyKey, country.code) }; }
      catch { return { country, evidence: [] }; }
    }));
    const evidence = searchResults.flatMap(group => group.evidence.slice(0, 4).map(item => ({ ...item, country: group.country.name }))).slice(0, 28);
    if (!evidence.length) return jsonError("Tavily returned no usable business evidence. No prospects were saved.", 502);

    const adapters = createConfiguredAdapters();
    if (!adapters.length) return jsonError("No AI provider is configured. Add credits to at least one provider to analyse the search results.", 503);
    const requestForAI: ModelRequest = {
      task: "prospect_discovery",
      objective: [
        "Analyse the supplied live web search evidence and return ONLY a valid JSON array. Do not wrap it in markdown.",
        "Return at most 12 distinct real businesses. Use only evidence supplied. Do not invent names, websites, contact numbers, social accounts, operating status, or service problems.",
        "Prioritise businesses with no official website, or a broken/outdated website only when evidence proves it. If a search result is an agency, directory, job board, news article, inactive business, or unrelated page, exclude it.",
        "For every business return keys: companyName, websiteUrl (official website URL or null), industry, country, fitScore (0-100, conservative), matchedService (one active service name), readiness (active or requires_confirmation), observedNeed (specific evidence-backed need; otherwise say unconfirmed), researchSummary (concise with evidence URLs), evidenceUrls (array of exact supplied URLs), officialWhatsapp (international digits-only phone only when the exact number is visibly present in a supplied excerpt; otherwise null).",
        "Match only active Samzy services where possible. Expansion-only services must be marked requires_confirmation and never presented as an available offer.",
        "A company must be currently operating or have recent credible activity. Do not infer a WhatsApp number. Do not claim website absent merely because search did not return one; mark websiteUrl null and say website status needs manual verification.",
        "Use only source URLs included below. No markdown, no commentary, no extra keys."
      ].join(" "),
      context: {
        samzyActiveServices: ACTIVE_SAMZY_SERVICES.map(({id,name,idealCustomers,painSignals}) => ({id,name,idealCustomers,painSignals})),
        expansionServices: CONFIRMATION_REQUIRED_SERVICES.map(({id,name}) => ({id,name,readiness:"requires_confirmation"})),
        webEvidence: evidence.map(item => ({url:item.url,title:item.title,excerpt:item.excerpt?.slice(0,1100),country:item.country})),
        discoveryRules: "Website-first verification. Existing adequate websites are not priority unless a specific evidenced gap exists. No invented contact details. Save only qualified candidates and keep unknowns explicit."
      },
    };

    let aiText = "";
    let selectedProvider = "";
    const failures: string[] = [];
    // Use the first provider that actually answers. Broken/empty or unfunded providers
    // must not prevent the working provider from running this discovery batch.
    for (const adapter of adapters) {
      try {
        const result = await adapter.generate(requestForAI);
        aiText = result.content;
        selectedProvider = `${result.provider}/${result.model}`;
        break;
      } catch (cause) {
        failures.push(`${adapter.provider}: ${cause instanceof Error ? cause.message : "provider error"}`);
      }
    }
    if (!aiText) return jsonError("No configured AI provider could analyse the live search results. At least one provider needs working credits and quota. " + failures.slice(0,3).join("; "), 503);

    const parsed = extractJson(aiText);
    if (!Array.isArray(parsed)) return jsonError("The available AI did not return a valid prospect list. No records were saved.", 502);
    const saved: Array<{id:string;company_name:string;website_url:string|null;fit_score:number|null}> = [];
    let skipped = 0;
    for (const raw of parsed.slice(0, 12)) {
      if (!raw || typeof raw !== "object") { skipped++; continue; }
      const item = raw as Record<string, unknown>;
      const companyName = typeof item.companyName === "string" ? item.companyName.trim().slice(0,160) : "";
      if (companyName.length < 2) { skipped++; continue; }
      const website = normaliseWebsite(item.websiteUrl);
      const evidenceUrls = Array.isArray(item.evidenceUrls)
        ? item.evidenceUrls.filter((url): url is string => typeof url === "string" && evidence.some(source => source.url === url)).slice(0,8)
        : [];
      if (!evidenceUrls.length) { skipped++; continue; }
      const sourceEvidence = evidence.filter(source => evidenceUrls.includes(source.url));
      const researchSummary = [
        typeof item.matchedService === "string" ? `Service fit: ${item.matchedService.slice(0,120)}.` : "",
        typeof item.observedNeed === "string" ? `Observed need: ${item.observedNeed.slice(0,500)}.` : "",
        typeof item.researchSummary === "string" ? item.researchSummary.slice(0,1800) : "",
        website ? "Official website identified; review it before outreach." : "No official website was established from this search; manually verify before qualification.",
      ].filter(Boolean).join("\n");
      const fitScore = typeof item.fitScore === "number" && Number.isFinite(item.fitScore) ? Math.max(0,Math.min(100,Math.round(item.fitScore))) : null;
      const { data: existing, error: existingError } = await db.from("prospects").select("id")
        .eq("organization_id",organizationId).ilike("company_name",companyName).limit(1).maybeSingle();
      if (existingError) throw new Error("Could not check prospect duplicates.");
      if (existing) { skipped++; continue; }
      if (website) {
        const { data: duplicateWebsite, error: duplicateWebsiteError } = await db.from("prospects").select("id")
          .eq("organization_id",organizationId).eq("website_url",website).maybeSingle();
        if (duplicateWebsiteError) throw new Error("Could not check website duplicates.");
        if (duplicateWebsite) { skipped++; continue; }
      }
      const { data: prospect, error: insertError } = await db.from("prospects").insert({
        organization_id: organizationId, company_name: companyName, website_url: website,
        industry: typeof item.industry === "string" ? item.industry.slice(0,100) : null,
        country: typeof item.country === "string" ? item.country.slice(0,80) : null,
        fit_score: fitScore, status: "discovered", research_summary: researchSummary.slice(0,3000),
        evidence: sourceEvidence.map(source => ({url:source.url,title:source.title,excerpt:source.excerpt?.slice(0,1200)})),
        discovered_by: "samzy_ai_tavily",
      }).select("id,company_name,website_url,fit_score").single();
      if (insertError || !prospect) { skipped++; continue; }
      saved.push(prospect);
      const phone = phoneFromEvidence(item.officialWhatsapp, sourceEvidence);
      if (phone) {
        await db.from("contact_points").insert({
          organization_id: organizationId, prospect_id: prospect.id, channel: "whatsapp",
          address: phone, is_verified: false,
          consent_basis: "Public contact candidate from cited source; human verification required before outreach.",
        });
      }
    }
    await db.from("audit_events").insert({
      organization_id: organizationId, actor_user_id: authData.user.id, actor_type: "user",
      action: "crm.prospects.ai_discovered", entity_type: "prospect", entity_id: saved[0]?.id ?? null,
      metadata: { saved_count:saved.length, skipped_count:skipped, source:"Tavily", provider:selectedProvider, countries:countries.map(c=>c.code) },
    });
    return NextResponse.json({
      savedCount:saved.length, skippedCount:skipped, prospects:saved, provider:selectedProvider,
      searchedCountries:countries.map(country=>country.name), evidenceCount:evidence.length,
      note:"New records are saved as discovered, not contacted. Open each official website first, verify contact details, then approve any outreach."
    },{status:200,headers:noStore});
  } catch (cause) {
    console.error("[prospect-discovery] failed", { message:cause instanceof Error?cause.message:"Unknown error" });
    return jsonError(cause instanceof Error?cause.message:"Prospect discovery failed. No unverified outreach was sent.",503);
  }
}

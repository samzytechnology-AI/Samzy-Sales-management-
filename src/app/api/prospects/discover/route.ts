import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { searchBusinessWeb, type WebEvidence } from "@/lib/research/tavily-search";
import { createConfiguredAdapters } from "@/lib/ai/provider-config";
import { ACTIVE_SAMZY_SERVICES, CONFIRMATION_REQUIRED_SERVICES, SAMZY_SERVICE_CATALOG } from "@/lib/business/service-catalog";
import type { ModelRequest } from "@/lib/ai/types";

export const runtime = "nodejs";
export const maxDuration = 60;
const uuid = z.string().uuid();
const noStore = { "Cache-Control": "no-store" };
const BATCH_SIZE = 4;
const countries = [
  { code: "NG", name: "Nigeria" }, { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" }, { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" }, { code: "AE", name: "United Arab Emirates" },
  { code: "ZA", name: "South Africa" },
] as const;
const sectors = [
  "independent schools, colleges and training centres",
  "real estate agencies, property managers and developers",
  "hotels, restaurants, cafes and hospitality businesses",
  "professional services, consulting and accounting firms",
  "retail shops, electronics stores and wholesalers",
  "events companies, venues and creative businesses",
  "construction, logistics and facility service businesses",
  "clinics, wellness centres and private healthcare businesses",
] as const;

type Evidence = WebEvidence & { country: string; sector: string; service: string; serviceReadiness: string; query: string };
type Candidate = {
  companyName: string; country: string; industry: string; service: string;
  fitScore: number | null; summary: string; evidence: Evidence[]; profileUrl: string; readiness: string;
  whatsapp: string | null; phone: string | null; email: string | null;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: noStore });
}
function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^\x60{3}(?:json)?\s*/i, "").replace(/\s*\x60{3}$/i, "");
  try { return JSON.parse(cleaned); } catch { /* extract a JSON payload */ }
  const a = cleaned.indexOf("["); const b = cleaned.lastIndexOf("]");
  if (a >= 0 && b > a) { try { return JSON.parse(cleaned.slice(a, b + 1)); } catch { /* try object */ } }
  const x = cleaned.indexOf("{"); const y = cleaned.lastIndexOf("}");
  if (x >= 0 && y > x) return JSON.parse(cleaned.slice(x, y + 1));
  throw new Error("AI did not return structured prospect data.");
}
function hostOf(value: string): string {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}
const PROFILE_HOSTS = [
  "maps.google.com","yelp.com","yellowpages.com","tripadvisor.com","foursquare.com",
  "hotfrog.com","businesslist.com","chamberofcommerce.com","kompass.com",
];
function isProfileUrl(url: string): boolean {
  const host = hostOf(url);
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (host === "google.com" || host === "maps.google.com") {
      return path.includes("/maps/place/") || (path.startsWith("/maps") && parsed.searchParams.has("cid"));
    }
    if (host === "yelp.com") return path.startsWith("/biz/");
    if (host === "yellowpages.com") return path.includes("/mip/");
    if (host === "tripadvisor.com") return /\/(restaurant|hotel|attraction)_review/.test(path);
    if (host === "foursquare.com") return path.startsWith("/v/");
    if (host === "hotfrog.com") return path.includes("/company/") || path.includes("/business/");
    if (host === "businesslist.com") {
      const parts = path.split("/").filter(Boolean);
      return parts.length >= 2 && !parts.some(part => /^(category|categories|directory|search|tag|industry|city)$/i.test(part));
    }
    if (host === "chamberofcommerce.com") return path.includes("/business-directory/") && path.split("/").filter(Boolean).length >= 3;
    if (host === "kompass.com") return path.includes("/c/") || path.includes("/company/");
  } catch { return false; }
  return PROFILE_HOSTS.some(domain => host === domain || host.endsWith("." + domain));
}
function isNoiseTitle(value: string): boolean {
  return /^(home|about|contact|login|sign in|sign up|search results|business directory|directory|top \d+|best \d+|jobs|careers|products|services|companies|google maps|google ads|google business profile|local guides|google maps local guides|share your world as a local guide|yellow pages|businesslist|tripadvisor|foursquare|hotfrog|kompass|chamber of commerce|google|yelp)$/i.test(value.trim())
    || /\b(job openings|vacancies|website template|web design agency|digital marketing agency|seo agency|marketing agency|directory of|top \d+ businesses|facebook group|community group|discussion thread|classifieds)\b/i.test(value);
}
function nameFromTitle(title: string, url: string): string {
  let name = title
    .replace(/\s*(?:\||–|—|-)\s*(?:facebook|instagram|linkedin|tiktok|twitter|x|youtube|google maps|google ads|google business profile|tripadvisor|yellow pages|businesslist|foursquare|hotfrog|kompass|chamber of commerce|yelp).*$/i, "")
    .replace(/\s*(?:\||–|—|-)\s*(?:official website|official page|home page|homepage|contact us|about us).*$/i, "")
    .replace(/\s*·\s*\d+(?:\.\d+)?\s*\([^)]*\).*$/, "")
    .replace(/^\s*(?:home|welcome to)\s+/i, "").trim();
  if (isNoiseTitle(name) || name.length < 3) {
    const host = hostOf(url).split(".")[0] ?? "";
    name = host.replace(/[-_]/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
  }
  return name.slice(0, 160);
}
function normalizedName(value: string): string {
  return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}
function candidateKey(value: string): string {
  return normalizedName(value).replace(/\b(limited|ltd|inc|llc|plc|company|co)\b/g, "").trim();
}
function extractEmail(evidence: Evidence[]): string | null {
  for (const item of evidence) {
    const match = item.excerpt?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (match) return match[0].toLowerCase();
  }
  return null;
}
function extractPhone(evidence: Evidence[]): { phone: string | null; whatsapp: string | null } {
  for (const item of evidence) {
    const text = item.excerpt ?? "";
    const matches = text.match(/(?:\+\d{1,3}[\s().-]?)?(?:\d[\s().-]?){9,14}\d/g) ?? [];
    for (const match of matches) {
      const digits = match.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 15) continue;
      if (/whats\s?app/i.test(text)) return { phone: digits, whatsapp: digits };
      return { phone: digits, whatsapp: null };
    }
  }
  return { phone: null, whatsapp: null };
}
function hasActivityEvidence(item: Evidence): boolean {
  const text = (item.title ?? "") + " " + (item.excerpt ?? "");
  return /\b(address|directions|open now|opening hours|business hours|phone|call|website|reviews?|rating|established|admissions|enrolment|enrollment|school|academy|college|hotel|restaurant|clinic|shop|store|property|real estate|office|customers|students|patients)\b/i.test(text);
}
function taskAt(index: number) {
  const services = [...SAMZY_SERVICE_CATALOG];
  const total = countries.length * sectors.length * services.length;
  const normalized = ((index % total) + total) % total;
  const countryIndex = Math.floor(normalized / (sectors.length * services.length));
  const sectorIndex = Math.floor((normalized % (sectors.length * services.length)) / services.length);
  const serviceIndex = normalized % services.length;
  const cycle = Math.floor(index / total);
  const country = countries[countryIndex];
  const sector = sectors[sectorIndex];
  const service = services[serviceIndex];
  const searchTerm = service.searchTerms.slice(0, 3).join(" or ");
  const variation = cycle % 3 === 0 ? "currently operating"
    : cycle % 3 === 1 ? "established independent"
    : "locally recognised";
  const query = "Find named, real " + variation + " " + sector + " in " + country.name
    + " that may need " + searchTerm
    + ". Research Google Maps business profiles and individual establishment listings on Yelp, Yellow Pages, TripAdvisor, Foursquare, Hotfrog, BusinessList, Chamber of Commerce, or Kompass. Prefer businesses with no official standalone website. Return specific business profile pages with the establishment name and evidence such as address, opening hours, phone, reviews, admissions, products, or services. Exclude social-media-only pages, Facebook groups/posts, Instagram profiles, discussion threads, job pages, agencies selling Samzy services, and generic directory category pages. ";
  return { country, sector, service, query: query.slice(0, 590), cycle };
}
function evidenceForUrls(urls: unknown, all: Evidence[]): Evidence[] {
  if (!Array.isArray(urls)) return [];
  const exact = new Set(urls.filter((url): url is string => typeof url === "string"));
  return all.filter(item => exact.has(item.url)).slice(0, 6);
}
function nameMatchesEvidence(name: string, item: Evidence): boolean {
  const normalize = (value: string) => value.toLowerCase().normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const clean = normalize(name);
  const title = normalize(item.title ?? "");
  if (!clean || !title) return false;
  if (title.includes(clean)) return true;
  const ignored = new Set(["the","limited","ltd","plc","inc","incorporated","company","co","group","google","maps","profile"]);
  const tokens = clean.split(" ").filter(token => token.length > 1 && !ignored.has(token));
  return tokens.length > 0 && tokens.every(token => title.includes(token));
}

function toCandidate(companyName: string, evidence: Evidence[], extra?: Record<string, unknown>): Candidate | null {
  const cleanName = companyName.trim().replace(/\s+/g, " ").slice(0, 160);
  if (cleanName.length < 3 || isNoiseTitle(cleanName) || !evidence.length) return null;
  const orderedEvidence = [...evidence].sort((a,b) => Number(isProfileUrl(b.url)) - Number(isProfileUrl(a.url)));
  const profile = orderedEvidence.find(item => isProfileUrl(item.url));
  if (!profile || !hasActivityEvidence(profile) || !nameMatchesEvidence(cleanName, profile)) return null;
  const contact = extractPhone(orderedEvidence);
  const fit = typeof extra?.fitScore === "number" && Number.isFinite(extra.fitScore)
    ? Math.max(0, Math.min(100, Math.round(extra.fitScore))) : null;
  const matchedCatalogService = typeof extra?.matchedService === "string"
    ? SAMZY_SERVICE_CATALOG.find(item => normalizedName(item.name) === normalizedName(extra.matchedService as string))
    : undefined;
  const service = matchedCatalogService?.name ?? profile.service;
  const readiness = matchedCatalogService?.readiness ?? profile.serviceReadiness;
  const summary = typeof extra?.businessDescription === "string" ? extra.businessDescription.trim().slice(0, 220)
    : typeof extra?.researchSummary === "string" ? extra.researchSummary.trim().slice(0, 220)
    : profile.sector.replace(/\b(independent|local|and training centres|businesses)\b/gi, "").replace(/\s+/g, " ").trim().slice(0, 140);
  return {
    companyName: cleanName, country: profile.country, industry: profile.sector, service,
    fitScore: fit, summary, evidence:orderedEvidence, profileUrl: profile.url, readiness,
    whatsapp: contact.whatsapp, phone: contact.phone, email: extractEmail(orderedEvidence),
  };
}

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  const isCron = Boolean(cronSecret && bearer && bearer === cronSecret);
  const token = isCron ? "" : bearer;
  const organizationId = request.headers.get("x-organization-id") ?? "";
  if (!isCron && !token) return jsonError("A valid sign-in session is required.", 401);
  if (!uuid.safeParse(organizationId).success) return jsonError("A valid organisation ID is required.", 400);

  let lockClaimed = false;
  try {
    const db = createServerSupabaseClient();
    let actorUserId: string | null = null;
    if (isCron) {
      const { data: owner, error: ownerError } = await db.from("organization_members")
        .select("user_id").eq("organization_id", organizationId).in("role", ["owner", "admin"])
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (ownerError || !owner) return jsonError("No authorised company owner is available for scheduled prospect discovery.", 403);
      actorUserId = owner.user_id;
    } else {
      const { data: authData, error: authError } = await db.auth.getUser(token);
      if (authError || !authData.user) return jsonError("Your sign-in session is invalid or expired.", 401);
      const { data: member, error: memberError } = await db.from("organization_members")
        .select("role").eq("organization_id", organizationId).eq("user_id", authData.user.id).maybeSingle();
      if (memberError) throw new Error("Could not verify company membership.");
      if (!member || !["owner", "admin", "manager"].includes(member.role)) return jsonError("You cannot discover prospects for this workspace.", 403);
      actorUserId = authData.user.id;
    }

    const tavilyKey = process.env.TAVILY_API_KEY ?? "";
    if (!tavilyKey) return jsonError("Tavily is not configured on the server. No prospects were saved.", 503);
    const { data: allowed, error: limitError } = await db.rpc("consume_ai_rate_limit", {
      p_organization_id: organizationId, p_user_id: actorUserId, p_limit: 30, p_window_seconds: 3600,
    });
    if (limitError) throw new Error("Could not enforce the discovery usage limit.");
    if (!allowed) return jsonError("The shared research limit has been reached. Try again later.", 429);

    const { data: claimed, error: lockError } = await db.rpc("claim_prospect_discovery_lock", {
      p_organization_id: organizationId, p_lease_seconds: 240,
    });
    if (lockError) throw new Error("Could not acquire the prospect discovery lock.");
    if (!claimed) return NextResponse.json({ error: "A prospect search is already running. The saved queue will continue with the next scheduled run." }, { status: 409, headers: noStore });
    lockClaimed = true;

    const { error: stateInsertError } = await db.from("prospect_discovery_state")
      .upsert({ organization_id: organizationId }, { onConflict: "organization_id", ignoreDuplicates: true });
    if (stateInsertError) throw new Error("Could not initialise the saved prospect-search position.");
    const { data: state, error: stateError } = await db.from("prospect_discovery_state")
      .select("next_task_index,total_searches,total_saved").eq("organization_id", organizationId).single();
    if (stateError || !state) throw new Error("Could not read the saved prospect-search position.");

    const startIndex = Number(state.next_task_index ?? 0);
    const batch = Array.from({ length: BATCH_SIZE }, (_, offset) => taskAt(startIndex + offset));
    const settled = await Promise.allSettled(batch.map(async task => {
      const results = await searchBusinessWeb(task.query, tavilyKey, task.country.name);
      return results.map(item => ({
        ...item, country: task.country.name, sector: task.sector,
        service: task.service.name, serviceReadiness:task.service.readiness, query: task.query,
      } as Evidence));
    }));
    const successfulSearches = settled.filter(item => item.status === "fulfilled").length;
    const searchErrors = settled.filter(item => item.status === "rejected").length;
    if (successfulSearches === 0) {
      await db.from("prospect_discovery_state").update({ lease_until: null }).eq("organization_id", organizationId);
      lockClaimed = false;
      return jsonError("All four web searches failed. Your saved search position was not advanced; the scheduled worker will retry on its next run.", 502);
    }
    const evidence = settled.flatMap(item => item.status === "fulfilled" ? item.value : []);
    const uniqueEvidence = Array.from(new Map(evidence.map(item => [item.url, item])).values()).slice(0, 40);

    const adapters = createConfiguredAdapters();
    let provider = "deterministic evidence extraction";
    const aiCandidates: Candidate[] = [];
    const providerFailures: string[] = [];
    if (uniqueEvidence.length && adapters.length) {
      const aiRequest: ModelRequest = {
        task: "prospect_discovery",
        objective: [
          "Act as a strict B2B business-verification analyst. Extract only real, named, operating establishments from the supplied web evidence.",
          "Return ONLY JSON: {\"prospects\":[{\"companyName\":\"...\",\"businessDescription\":\"one short factual sentence describing what this business does\",\"evidenceUrls\":[\"exact supplied URL\"],\"matchedService\":\"...\",\"fitScore\":0}]}",
          "Do not invent names, websites, phone numbers, emails, photos, or facts. Every prospect must be supported by an exact supplied URL.",
          "A social-media page, Facebook group/post, Instagram profile, discussion, classified, or personal account is NEVER sufficient evidence and must NEVER be saved. Accept only a specific, named Google Maps place listing or an individual business profile on a reputable business directory. The evidence should indicate a real operating business through address, opening hours, phone, reviews, admissions, products, or services.",
          "Exclude agencies selling web design, graphics, marketing, or software; job listings; news; generic directory/category pages; and businesses with an official standalone website shown in the evidence.",
          "Do not require phone or email if a qualifying Google Maps or reputable directory business listing exists. Do not claim a business has no website; say no official website was surfaced and manual verification is still required.",
          "Match the most relevant Samzy service. Expansion services must remain marked as requiring capability confirmation. Return up to 20 distinct businesses."
        ].join(" "),
        context: {
          activeServices: ACTIVE_SAMZY_SERVICES.map(({id,name,searchTerms}) => ({id,name,searchTerms})),
          expansionServices: CONFIRMATION_REQUIRED_SERVICES.map(({id,name,searchTerms}) => ({id,name,searchTerms,readiness:"requires_confirmation"})),
          evidence: uniqueEvidence.map(item => ({
            url:item.url,title:item.title,excerpt:item.excerpt?.slice(0,900),
            country:item.country,sector:item.sector,service:item.service,publishedAt:item.publishedAt,
          })),
        },
      };
      for (const adapter of adapters) {
        try {
          const result = await adapter.generate(aiRequest);
          provider = result.provider + "/" + result.model;
          const parsed = parseJson(result.content) as any;
          const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.prospects) ? parsed.prospects : [];
          for (const row of rows.slice(0, 20)) {
            if (!row || typeof row !== "object" || typeof row.companyName !== "string") continue;
            const linkedEvidence = evidenceForUrls(row.evidenceUrls, uniqueEvidence);
            const candidate = toCandidate(row.companyName, linkedEvidence, row);
            if (candidate) aiCandidates.push(candidate);
          }
          break;
        } catch (cause) {
          providerFailures.push(adapter.provider + ": " + (cause instanceof Error ? cause.message : "provider error"));
        }
      }
    }

    // AI improves extraction and service matching, but it is not allowed to veto every lead.
    // When it returns an empty/invalid list, derive named candidates from cited public profiles.
    const deterministicCandidates = uniqueEvidence
      .filter(item => isProfileUrl(item.url))
      .map(item => toCandidate(nameFromTitle(item.title ?? "", item.url), [item], { matchedService:item.service }))
      .filter((item): item is Candidate => Boolean(item));
    const combined = [...aiCandidates, ...deterministicCandidates];
    const candidates = Array.from(new Map(combined.map(item => [candidateKey(item.companyName), item])).values()).slice(0, 24);

    const saved: Array<{id:string;company_name:string;website_url:string|null;fit_score:number|null}> = [];
    let duplicates = 0;
    let weak = 0;
    let failedSaves = 0;
    for (const candidate of candidates) {
      const officialSiteEvidence = uniqueEvidence.find(item => {
        if (isProfileUrl(item.url)) return false;
        const host = hostOf(item.url);
        if (!host || /(^|\.)(facebook|instagram|linkedin|tiktok|twitter|youtube|x)\./i.test(host) || host.endsWith("google.com")) return false;
        const hostLabel = host.split(".")[0] ?? "";
        const generic = new Set(["the","and","for","of","school","schools","academy","college","university","hospital","clinic","hotel","restaurant","shop","store","services","group","limited","ltd","plc","company"]);
        const bits = candidateKey(candidate.companyName).split(" ").filter(bit => bit.length >= 3 && !generic.has(bit));
        return bits.length > 0 && bits.some(bit => hostLabel.includes(bit));
      });
      if (officialSiteEvidence || !candidate.profileUrl) { weak++; continue; }

      const { data: existing, error: existingError } = await db.from("prospects").select("id")
        .eq("organization_id", organizationId).ilike("company_name", candidate.companyName).limit(1).maybeSingle();
      if (existingError) { failedSaves++; continue; }
      if (existing) { duplicates++; continue; }

      const evidenceRows = candidate.evidence.map(item => ({
        url:item.url,title:item.title,excerpt:item.excerpt?.slice(0,1200),
        publishedAt:item.publishedAt ?? null,sourceType:isProfileUrl(item.url)?"public_profile":"web_search",
      }));
      const researchSummary = candidate.summary.slice(0, 220) || candidate.industry.slice(0, 140);
      const { data: prospect, error: insertError } = await db.from("prospects").insert({
        organization_id:organizationId,company_name:candidate.companyName,website_url:null,
        industry:candidate.industry.slice(0,100),country:candidate.country.slice(0,80),
        fit_score:candidate.fitScore,status:"discovered",research_summary:researchSummary,
        evidence:evidenceRows,discovered_by:"samzy_ai_tavily_agent",
      }).select("id,company_name,website_url,fit_score").single();
      if (insertError || !prospect) {
        if (insertError?.code === "23505") duplicates++;
        else failedSaves++;
        continue;
      }
      saved.push(prospect);

      await db.from("contact_points").insert({
        organization_id:organizationId,prospect_id:prospect.id,channel:"other",
        address:candidate.profileUrl,is_verified:false,
        consent_basis:"Public business profile found in cited web search; verify business identity before outreach.",
      });
      if (candidate.whatsapp) {
        await db.from("contact_points").insert({
          organization_id:organizationId,prospect_id:prospect.id,channel:"whatsapp",
          address:candidate.whatsapp,is_verified:false,
          consent_basis:"Number appeared beside WhatsApp in cited public profile/search excerpt; verify before outreach.",
        });
      } else if (candidate.phone) {
        await db.from("contact_points").insert({
          organization_id:organizationId,prospect_id:prospect.id,channel:"voice",
          address:candidate.phone,is_verified:false,
          consent_basis:"Public phone candidate from cited search excerpt; verify before calling.",
        });
      }
      if (candidate.email) {
        await db.from("contact_points").insert({
          organization_id:organizationId,prospect_id:prospect.id,channel:"email",
          address:candidate.email,is_verified:false,
          consent_basis:"Public email candidate from cited search excerpt; verify before outreach.",
        });
      }
    }

    const nextIndex = startIndex + BATCH_SIZE;
    const { error: stateUpdateError } = await db.from("prospect_discovery_state").update({
      next_task_index:nextIndex,
      total_searches:Number(state.total_searches ?? 0)+successfulSearches,
      total_saved:Number(state.total_saved ?? 0)+saved.length,
      last_run_at:new Date().toISOString(),last_saved_count:saved.length,updated_at:new Date().toISOString(),
    }).eq("organization_id", organizationId);
    if (stateUpdateError) throw new Error("Prospects were processed, but the continuous-search cursor could not be saved.");

    await db.from("prospect_discovery_state").update({ lease_until: null }).eq("organization_id", organizationId);
    lockClaimed = false;

    await db.from("audit_events").insert({
      organization_id:organizationId,actor_user_id:isCron ? null : actorUserId,actor_type:isCron ? "system" : "user",
      action:"crm.prospects.ai_discovered",entity_type:"prospect",entity_id:saved[0]?.id ?? null,
      metadata:{
        saved_count:saved.length,duplicate_count:duplicates,weak_count:weak,failed_saves:failedSaves,
        source:"Tavily",provider,searches:successfulSearches,search_errors:searchErrors,
        cursor_start:startIndex,cursor_next:nextIndex,
        cycle:Math.floor(nextIndex/(countries.length*sectors.length*SAMZY_SERVICE_CATALOG.length)),
      },
    });

    return NextResponse.json({
      savedCount:saved.length,duplicateCount:duplicates,weakCount:weak,failedSaveCount:failedSaves,
      candidateCount:candidates.length,searchResultCount:uniqueEvidence.length,
      searchCount:successfulSearches,searchErrors,provider,
      searchedCountries:Array.from(new Set(batch.map(task=>task.country.name))),
      searchedServices:Array.from(new Set(batch.map(task=>task.service.name))),
      batchNumber:Math.floor(startIndex/BATCH_SIZE)+1,nextBatchReady:true,nextTaskIndex:nextIndex,
      totalSaved:Number(state.total_saved ?? 0)+saved.length,
      note:"The prospect queue is continuous. Each run searches the next saved country/industry/service tasks, deduplicates records, and appends new prospects. Official website absence is never assumed from a missing search result; review the cited profile and verify the website before outreach.",
      providerWarnings:providerFailures.slice(0,3),
    },{status:200,headers:noStore});
  } catch (cause) {
    if (lockClaimed) {
      try {
        const db = createServerSupabaseClient();
        await db.from("prospect_discovery_state").update({ lease_until: null })
          .eq("organization_id", request.headers.get("x-organization-id") ?? "");
      } catch { /* the lease expires automatically if release fails */ }
    }
    console.error("[prospect-discovery] failed",{message:cause instanceof Error?cause.message:"Unknown error"});
    return jsonError(cause instanceof Error?cause.message:"Prospect discovery failed. No unverified outreach was sent.",503);
  }
}

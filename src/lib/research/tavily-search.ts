export interface WebEvidence {
  url: string;
  title?: string;
  excerpt?: string;
  publishedAt?: string;
}

interface TavilyResult {
  url?: string;
  title?: string;
  content?: string;
  published_date?: string;
}
interface TavilyResponse { results?: TavilyResult[]; }

function safeProviderMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; detail?: unknown; error?: unknown };
    const value = [parsed.message, parsed.detail, parsed.error]
      .find((item) => typeof item === "string" && item.trim());
    if (typeof value === "string") return value.replace(/tvly-[A-Za-z0-9_-]+/g, "[redacted-key]").slice(0, 300);
  } catch { /* non-JSON provider error */ }
  return body.replace(/tvly-[A-Za-z0-9_-]+/g, "[redacted-key]").replace(/\s+/g, " ").trim().slice(0, 300);
}

export async function searchBusinessWeb(
  query: string,
  apiKey: string,
  country?: string,
  fetcher: typeof fetch = fetch,
): Promise<WebEvidence[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length > 600) throw new Error("Search query must contain 1–600 characters.");
  if (!apiKey.trim()) throw new Error("Tavily API key is missing.");
  const response = await fetcher("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: trimmed,
      ...(country ? { country } : {}),
      // Basic search uses fewer credits than advanced; keep the continuous agent economical.
      search_depth: "basic",
      topic: "general",
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
    }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = safeProviderMessage(await response.text());
    console.error("[tavily-search] provider rejected request", { status: response.status, detail });
    throw new Error(`Tavily HTTP ${response.status}: ${detail || "provider returned no error detail"}`);
  }
  const payload = await response.json() as TavilyResponse;
  return (payload.results ?? []).flatMap((item) => {
    if (!item.url || !item.title) return [];
    try {
      const parsed = new URL(item.url);
      if (!["https:", "http:"].includes(parsed.protocol)) return [];
      return [{
        url: parsed.toString(),
        title: item.title.slice(0, 300),
        ...(item.content ? { excerpt: item.content.slice(0, 2_000) } : {}),
        ...(item.published_date ? { publishedAt: item.published_date.slice(0, 80) } : {}),
      }];
    } catch { return []; }
  }).slice(0, 5);
}

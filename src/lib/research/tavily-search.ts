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
      query: trimmed,\n      ...(country ? { country } : {}),
      search_depth: "advanced",
      topic: "general",
      max_results: 10,
      include_answer: false,
      include_raw_content: false,
    }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Tavily search provider returned HTTP ${response.status}.`);
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
  }).slice(0, 8);
}

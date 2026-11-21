export interface WebEvidence {
  url: string;
  title?: string;
  excerpt?: string;
  publishedAt?: string;
}

interface BraveSearchResponse {
  web?: {
    results?: Array<{
      url?: string;
      title?: string;
      description?: string;
      page_age?: string;
      extra_snippets?: string[];
    }>;
  };
}

export async function searchBusinessWeb(
  query: string,
  apiKey: string,
  country?: string,
  fetcher: typeof fetch = fetch,
): Promise<WebEvidence[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length > 600) throw new Error("Search query must contain 1–600 characters.");
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", trimmed);
  url.searchParams.set("count", "8");
  url.searchParams.set("safesearch", "moderate");
  url.searchParams.set("search_lang", "en");
  url.searchParams.set("text_decorations", "false");
  if (country) url.searchParams.set("country", country);

  const response = await fetcher(url, {
    method: "GET",
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Web research provider returned HTTP ${response.status}.`);
  const payload = await response.json() as BraveSearchResponse;
  return (payload.web?.results ?? []).flatMap((item) => {
    if (!item.url || !item.title) return [];
    try {
      const parsed = new URL(item.url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return [];
      const excerpt = [item.description, ...(item.extra_snippets ?? [])]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" ")
        .slice(0, 2_000);
      return [{
        url: parsed.toString(),
        title: item.title.slice(0, 300),
        ...(excerpt ? { excerpt } : {}),
        ...(item.page_age ? { publishedAt: item.page_age.slice(0, 80) } : {}),
      }];
    } catch {
      return [];
    }
  }).slice(0, 8);
}
